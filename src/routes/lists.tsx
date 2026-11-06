import type { Context, Hono } from 'hono';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppEnv } from '../types.js';
import { requireUser } from '../middleware/auth.js';
import { formFile, formString, formStrings } from '../lib/forms.js';
import {
  isHttpUrl,
  itemInputSchema,
  itemPrice,
  listInputSchema,
  priceForInput,
  zodErrorKeys,
} from '../lib/validation.js';
import type { ItemLinkRow, ItemRow, ItemWithLinks, ListRow, ListWithCount } from '../lib/models.js';
import { randomId, randomToken } from '../lib/ids.js';
import {
  ImageError,
  storeImage,
  deleteUploadIfUnused,
  getUpload,
  canViewUploadForToken,
} from '../lib/images.js';
import { groupFeed, listAccess, listSharedGroups, isGroupMember, userGroups } from '../lib/access.js';
import { claimViews } from '../lib/claims.js';
import { fetchLinkMetadata } from '../lib/preview.js';
import { countRateEvents, recordRateEvent } from '../lib/ratelimit.js';

const PREVIEW_LIMIT = 20;
const PREVIEW_WINDOW_MS = 10 * 60 * 1000;
import { renderPage, redirectWithNotice } from '../views/layout.js';
import { ListDetail, ListFormPage, ListSharePage, ListsIndex, ItemFormPage } from '../views/lists.js';
import type { ItemFormValues, ListFormValues } from '../views/lists.js';
import { badRequest, notFound } from '../views/errors.js';
import { translate } from '../lib/i18n.js';

const PUBLIC_TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;

function publicUrl(c: Context<AppEnv>, token: string | null | undefined): string | null {
  if (!token) return null;
  return `${c.get('config').baseUrl.replace(/\/+$/, '')}/s/${token}`;
}

function ownedList(db: AppEnv['Variables']['db'], userId: string, listId: string): ListRow | null {
  return (
    (db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?').get(listId, userId) as ListRow | undefined) ??
    null
  );
}

function ownedItem(db: AppEnv['Variables']['db'], userId: string, itemId: string): ItemRow | null {
  return (
    (db
      .prepare(
        `SELECT i.* FROM items i JOIN lists l ON l.id = i.list_id
          WHERE i.id = ? AND i.user_id = ? AND l.user_id = ?`,
      )
      .get(itemId, userId, userId) as ItemRow | undefined) ?? null
  );
}

function linksByItem(db: AppEnv['Variables']['db'], itemIds: string[]): Map<string, ItemLinkRow[]> {
  const map = new Map<string, ItemLinkRow[]>();
  if (itemIds.length === 0) return map;
  const placeholders = itemIds.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT * FROM item_links WHERE item_id IN (${placeholders}) ORDER BY position ASC, rowid ASC`)
    .all(...itemIds) as ItemLinkRow[];
  for (const row of rows) {
    const list = map.get(row.item_id) ?? [];
    list.push(row);
    map.set(row.item_id, list);
  }
  return map;
}

function hydrateItems(db: AppEnv['Variables']['db'], rows: ItemRow[]): ItemWithLinks[] {
  const links = linksByItem(db, rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, links: links.get(row.id) ?? [] }));
}

function formValuesFromList(list?: ListRow): ListFormValues {
  return {
    name: list?.name ?? '',
    emoji: list?.emoji ?? '',
    color: list?.color ?? 0,
    note: list?.note ?? '',
  };
}

function valuesFromForm(form: AppEnv['Variables']['form']): ListFormValues {
  const color = Number(formString(form, 'color'));
  return {
    name: formString(form, 'name'),
    emoji: formString(form, 'emoji'),
    color: Number.isInteger(color) && color >= 0 && color <= 7 ? color : 0,
    note: formString(form, 'note'),
  };
}

function itemFormValuesFromItem(item?: ItemRow, links: ItemLinkRow[] = [], queryUrl = ''): ItemFormValues {
  return {
    title: item?.title ?? '',
    url: item?.url ?? queryUrl,
    price: item ? priceForInput(item.price_minor, item.currency) : '',
    currency: item?.currency ?? 'EUR',
    quantity: item?.quantity ?? 1,
    priority: item?.priority ?? 1,
    notes: item?.notes ?? '',
    size: item?.size ?? '',
    color: item?.color ?? '',
    links: links.map((link) => ({ label: link.label, url: link.url })),
  };
}

function valuesFromItemForm(form: AppEnv['Variables']['form'], queryUrl = ''): ItemFormValues {
  const rawPrice = formString(form, 'price');
  const quantity = Number(formString(form, 'quantity', '1'));
  const priority = Number(formString(form, 'priority', '1'));
  return {
    title: formString(form, 'title'),
    url: formString(form, 'url') || queryUrl,
    price: rawPrice,
    currency: formString(form, 'currency', 'EUR').toUpperCase(),
    quantity: Number.isInteger(quantity) ? quantity : 1,
    priority: Number.isInteger(priority) ? priority : 1,
    notes: formString(form, 'notes'),
    size: formString(form, 'size'),
    color: formString(form, 'color'),
    links: formStrings(form, 'linkLabels').map((label, index) => ({
      label,
      url: formStrings(form, 'linkUrls')[index] ?? '',
    })),
  };
}

function itemInputFromForm(form: AppEnv['Variables']['form']) {
  return {
    title: formString(form, 'title'),
    url: formString(form, 'url'),
    price: formString(form, 'price'),
    currency: formString(form, 'currency', 'EUR'),
    quantity: formString(form, 'quantity', '1'),
    priority: formString(form, 'priority', '1'),
    notes: formString(form, 'notes'),
    size: formString(form, 'size'),
    color: formString(form, 'color'),
    linkLabels: formStrings(form, 'linkLabels'),
    linkUrls: formStrings(form, 'linkUrls'),
  };
}

function cleanedLinks(input: { linkLabels: string[]; linkUrls: string[] }): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  for (let index = 0; index < Math.min(5, input.linkUrls.length); index += 1) {
    const label = (input.linkLabels[index] ?? '').trim();
    const url = (input.linkUrls[index] ?? '').trim();
    if (url === '') continue;
    links.push({ label, url });
  }
  return links;
}

function nextPosition(db: AppEnv['Variables']['db'], listId: string): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM items WHERE list_id = ? AND is_archived = 0')
    .get(listId) as { next: number };
  return row.next;
}

async function readUpload(c: Context<AppEnv>): Promise<{ file: File | null; error: string | null }> {
  const file = formFile(c.get('form'), 'image');
  if (!file || file.size === 0) return { file: null, error: null };
  if (file.size > c.get('config').maxUploadBytes) return { file: null, error: 'validation.imageTooLarge' };
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) {
    return { file: null, error: 'validation.imageUnsupported' };
  }
  return { file, error: null };
}

function itemPage(
  c: Context<AppEnv>,
  list: ListRow,
  mode: 'create' | 'edit',
  values: ItemFormValues,
  errors: string[] = [],
  imageId: string | null = null,
  status: 200 | 400 = 200,
  itemId: string | null = null,
) {
  const action = mode === 'create' ? `/lists/${list.id}/items` : `/items/${itemId ?? ''}/edit`;
  return renderPage(
    c,
    { title: translate(c.get('locale'), mode === 'create' ? 'itemForm.addTitle' : 'itemForm.editTitle'), status },
    <ItemFormPage
      locale={c.get('locale')}
      csrfToken={c.get('csrfToken')}
      action={action}
      mode={mode}
      values={values}
      errors={errors}
      cancelHref={`/lists/${list.id}`}
      imageId={imageId}
      maxUploadMb={Math.floor(c.get('config').maxUploadBytes / (1024 * 1024))}
      previewAction={mode === 'create' ? `/lists/${list.id}/items/new` : undefined}
    />,
  );
}

function insertLinks(db: AppEnv['Variables']['db'], itemId: string, links: Array<{ label: string; url: string }>): void {
  const insert = db.prepare('INSERT INTO item_links (id, item_id, label, url, position) VALUES (?, ?, ?, ?, ?)');
  links.forEach((link, index) => insert.run(randomId(), itemId, link.label, link.url, index));
}

function parseItemInput(c: Context<AppEnv>) {
  return itemInputSchema.safeParse(itemInputFromForm(c.get('form')));
}

export function registerListRoutes(app: Hono<AppEnv>): void {
  app.get('/lists', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const rows = c
      .get('db')
      .prepare(
        `SELECT l.*, COUNT(i.id) AS item_count,
                (SELECT COUNT(*) FROM list_groups lg WHERE lg.list_id = l.id) AS share_count
           FROM lists l
           LEFT JOIN items i ON i.list_id = l.id AND i.is_archived = 0
          WHERE l.user_id = ?
          GROUP BY l.id
          ORDER BY l.created_at DESC`,
      )
      .all(user.id) as ListWithCount[];
    const feedRows = groupFeed(c.get('db'), user.id);
    const feedClaims = claimViews(c.get('db'), feedRows.map((row) => row.id), { userId: user.id, ownerId: '' });
    const feed = feedRows.map((row) => ({ ...row, claim: feedClaims.get(row.id) }));
    return renderPage(
      c,
      { title: translate(c.get('locale'), 'lists.title'), active: 'lists', campaign: true },
      <ListsIndex locale={c.get('locale')} lists={rows} feed={feed} />,
    );
  });

  app.get('/lists/new', requireUser, (c) => {
    return renderPage(
      c,
      { title: translate(c.get('locale'), 'listForm.createTitle'), active: 'lists' },
      <ListFormPage
        locale={c.get('locale')}
        csrfToken={c.get('csrfToken')}
        action="/lists"
        mode="create"
        values={formValuesFromList()}
        errors={[]}
      />,
    );
  });

  app.post('/lists', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const parsed = listInputSchema.safeParse({
      name: formString(c.get('form'), 'name'),
      emoji: formString(c.get('form'), 'emoji'),
      color: formString(c.get('form'), 'color', '0'),
      note: formString(c.get('form'), 'note'),
    });
    if (!parsed.success) {
      return renderPage(
        c,
        { title: translate(c.get('locale'), 'listForm.createTitle'), active: 'lists', status: 400 },
        <ListFormPage
          locale={c.get('locale')}
          csrfToken={c.get('csrfToken')}
          action="/lists"
          mode="create"
          values={valuesFromForm(c.get('form'))}
          errors={zodErrorKeys(parsed.error)}
        />,
      );
    }
    const now = Date.now();
    const id = randomId();
    c.get('db')
      .prepare('INSERT INTO lists (id, user_id, name, emoji, color, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, user.id, parsed.data.name, parsed.data.emoji ?? '', parsed.data.color, parsed.data.note, now, now);
    c.get('logger').info('list.created', { userId: user.id });
    return redirectWithNotice(c, `/lists/${id}`, 'listCreated');
  });

  app.get('/lists/:id', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(c.req.param('id')) as ListRow | undefined;
    if (!list) return notFound(c);
    const access = listAccess(db, list.id, user.id);
    if (!access) return notFound(c);
    const isOwner = access === 'owner';

    const itemRows = db
      .prepare('SELECT * FROM items WHERE list_id = ? AND is_archived = 0 ORDER BY position ASC, created_at ASC')
      .all(list.id) as ItemRow[];
    const items = hydrateItems(db, itemRows);
    const claims = claimViews(db, items.map((item) => item.id), { userId: user.id, ownerId: list.user_id });
    const archivedCount = isOwner
      ? (
          db.prepare('SELECT COUNT(*) AS count FROM items WHERE list_id = ? AND is_archived = 1').get(list.id) as {
            count: number;
          }
        ).count
      : 0;
    const showArchived = isOwner && c.req.query('archived') === '1';
    const archivedRows = showArchived
      ? (db
          .prepare('SELECT * FROM items WHERE list_id = ? AND is_archived = 1 ORDER BY updated_at DESC')
          .all(list.id) as ItemRow[])
      : [];
    const otherLists = isOwner
      ? (db
          .prepare('SELECT id, name FROM lists WHERE user_id = ? AND id <> ? ORDER BY name COLLATE NOCASE ASC')
          .all(user.id, list.id) as Array<{ id: string; name: string }>)
      : [];

    const sharedGroups = isOwner ? listSharedGroups(db, list.id) : [];
    const ownerName = isOwner
      ? undefined
      : (db.prepare('SELECT username FROM users WHERE id = ?').get(list.user_id) as { username: string } | undefined)
          ?.username;

    return renderPage(
      c,
      { title: list.name, active: 'lists' },
      <ListDetail
        locale={c.get('locale')}
        csrfToken={c.get('csrfToken')}
        list={list}
        items={items}
        archivedItems={archivedRows}
        archivedCount={archivedCount}
        showArchived={showArchived}
        otherLists={otherLists}
        mode={access}
        ownerName={ownerName}
        sharedGroups={sharedGroups}
        publicUrl={isOwner ? publicUrl(c, list.public_token) : null}
        claims={claims}
        viewerId={user.id}
      />,
    );
  });

  app.get('/lists/:id/share', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const list = ownedList(db, user.id, c.req.param('id'));
    if (!list) return notFound(c);
    const sharedGroups = listSharedGroups(db, list.id);
    const sharedIds = new Set(sharedGroups.map((group) => group.id));
    const availableGroups = userGroups(db, user.id)
      .filter((group) => !sharedIds.has(group.id))
      .map((group) => ({ id: group.id, name: group.name }));
    return renderPage(
      c,
      { title: translate(c.get('locale'), 'listPage.shareTitle'), active: 'lists' },
      <ListSharePage
        locale={c.get('locale')}
        csrfToken={c.get('csrfToken')}
        list={list}
        sharedGroups={sharedGroups}
        availableGroups={availableGroups}
        publicUrl={publicUrl(c, list.public_token)}
      />,
    );
  });

  app.post('/lists/:id/share', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const list = ownedList(db, user.id, c.req.param('id'));
    if (!list) return notFound(c);
    const groupId = formString(c.get('form'), 'group_id');
    if (!groupId || !isGroupMember(db, groupId, user.id)) return badRequest(c);
    db.prepare(
      'INSERT OR IGNORE INTO list_groups (list_id, group_id, shared_by, created_at) VALUES (?, ?, ?, ?)',
    ).run(list.id, groupId, user.id, Date.now());
    c.get('logger').info('list.shared', { userId: user.id, listId: list.id, groupId });
    return redirectWithNotice(c, `/lists/${list.id}/share`, 'listShared');
  });

  app.post('/lists/:id/unshare', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const list = ownedList(db, user.id, c.req.param('id'));
    if (!list) return notFound(c);
    const groupId = formString(c.get('form'), 'group_id');
    if (!groupId) return badRequest(c);
    db.prepare('DELETE FROM list_groups WHERE list_id = ? AND group_id = ?').run(list.id, groupId);
    return redirectWithNotice(c, `/lists/${list.id}/share`, 'listUnshared');
  });

  app.post('/lists/:id/public/enable', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const list = ownedList(db, user.id, c.req.param('id'));
    if (!list) return notFound(c);
    if (!list.public_token) {
      db.prepare('UPDATE lists SET public_token = ?, updated_at = ? WHERE id = ?').run(
        randomToken(24),
        Date.now(),
        list.id,
      );
    }
    return redirectWithNotice(c, `/lists/${list.id}/share`, 'publicLinkCreated');
  });

  app.post('/lists/:id/public/disable', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const list = ownedList(c.get('db'), user.id, c.req.param('id'));
    if (!list) return notFound(c);
    list.public_token = null;
    c.get('db').prepare('UPDATE lists SET public_token = NULL, updated_at = ? WHERE id = ?').run(Date.now(), list.id);
    return redirectWithNotice(c, `/lists/${list.id}/share`, 'publicLinkDisabled');
  });

  app.post('/lists/:id/public/regenerate', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const list = ownedList(c.get('db'), user.id, c.req.param('id'));
    if (!list) return notFound(c);
    c.get('db')
      .prepare('UPDATE lists SET public_token = ?, updated_at = ? WHERE id = ?')
      .run(randomToken(24), Date.now(), list.id);
    return redirectWithNotice(c, `/lists/${list.id}/share`, 'publicLinkRegenerated');
  });

  app.get('/s/:token', (c) => {
    const token = c.req.param('token');
    if (!PUBLIC_TOKEN_RE.test(token)) return notFound(c);
    const db = c.get('db');
    const list = db.prepare('SELECT * FROM lists WHERE public_token = ?').get(token) as ListRow | undefined;
    if (!list) return notFound(c);
    const itemRows = db
      .prepare('SELECT * FROM items WHERE list_id = ? AND is_archived = 0 ORDER BY position ASC, created_at ASC')
      .all(list.id) as ItemRow[];
    const items = hydrateItems(db, itemRows);
    const viewer = c.get('user');
    const claims = claimViews(db, items.map((item) => item.id), { userId: viewer?.id ?? null, ownerId: list.user_id });
    return renderPage(
      c,
      { title: list.name, noindex: true },
      <ListDetail
        locale={c.get('locale')}
        csrfToken={c.get('csrfToken')}
        list={list}
        items={items}
        archivedItems={[]}
        archivedCount={0}
        showArchived={false}
        otherLists={[]}
        mode="public"
        token={token}
        claims={claims}
        viewerId={viewer?.id ?? null}
      />,
    );
  });

  app.get('/s/:token/media/:file', async (c) => {
    const token = c.req.param('token');
    if (!PUBLIC_TOKEN_RE.test(token)) return notFound(c);
    const match = /^([a-f0-9]{32})\.webp$/.exec(c.req.param('file'));
    if (!match) return notFound(c);
    const upload = getUpload(c.get('db'), match[1] as string);
    if (!upload) return notFound(c);
    if (!canViewUploadForToken(c.get('db'), token, upload)) return notFound(c);
    try {
      const data = await fs.readFile(path.join(c.get('config').uploadsDir, upload.filename));
      c.header('Content-Type', upload.mime);
      c.header('Content-Length', String(upload.bytes));
      c.header('Cache-Control', 'private, max-age=31536000, immutable');
      c.header('Content-Disposition', 'inline');
      c.header('Referrer-Policy', 'no-referrer');
      return c.body(new Uint8Array(data));
    } catch {
      return notFound(c);
    }
  });

  app.get('/lists/:id/edit', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const list = ownedList(c.get('db'), user.id, c.req.param('id'));
    if (!list) return notFound(c);
    return renderPage(
      c,
      { title: translate(c.get('locale'), 'listForm.editTitle'), active: 'lists' },
      <ListFormPage
        locale={c.get('locale')}
        csrfToken={c.get('csrfToken')}
        action={`/lists/${list.id}`}
        mode="edit"
        values={formValuesFromList(list)}
        errors={[]}
      />,
    );
  });

  app.post('/lists/:id', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const list = ownedList(db, user.id, c.req.param('id'));
    if (!list) return notFound(c);
    const parsed = listInputSchema.safeParse({
      name: formString(c.get('form'), 'name'),
      emoji: formString(c.get('form'), 'emoji'),
      color: formString(c.get('form'), 'color', '0'),
      note: formString(c.get('form'), 'note'),
    });
    if (!parsed.success) {
      return renderPage(
        c,
        { title: translate(c.get('locale'), 'listForm.editTitle'), active: 'lists', status: 400 },
        <ListFormPage
          locale={c.get('locale')}
          csrfToken={c.get('csrfToken')}
          action={`/lists/${list.id}`}
          mode="edit"
          values={valuesFromForm(c.get('form'))}
          errors={zodErrorKeys(parsed.error)}
        />,
      );
    }
    db.prepare('UPDATE lists SET name = ?, emoji = ?, color = ?, note = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
      parsed.data.name,
      parsed.data.emoji ?? '',
      parsed.data.color,
      parsed.data.note,
      Date.now(),
      list.id,
      user.id,
    );
    return redirectWithNotice(c, `/lists/${list.id}`, 'listUpdated');
  });

  app.post('/lists/:id/delete', requireUser, async (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const list = ownedList(db, user.id, c.req.param('id'));
    if (!list) return notFound(c);
    const uploads = db
      .prepare(
        `SELECT DISTINCT image_upload_id AS id FROM items
          WHERE list_id = ? AND image_upload_id IS NOT NULL`,
      )
      .all(list.id) as Array<{ id: string }>;
    db.prepare('DELETE FROM lists WHERE id = ? AND user_id = ?').run(list.id, user.id);
    for (const upload of uploads) {
      await deleteUploadIfUnused(db, c.get('config'), upload.id);
    }
    return redirectWithNotice(c, '/lists', 'listDeleted');
  });

  app.get('/lists/:id/items/new', requireUser, async (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const list = ownedList(db, user.id, c.req.param('id'));
    if (!list) return notFound(c);
    const rawUrl = c.req.query('url') ?? '';
    const queryUrl = isHttpUrl(rawUrl) ? rawUrl : '';
    let values = itemFormValuesFromItem(undefined, [], queryUrl);
    const now = Date.now();
    const bucket = `preview:user:${user.id}`;
    if (queryUrl && c.get('config').linkPreviewEnabled && countRateEvents(db, bucket, now - PREVIEW_WINDOW_MS) < PREVIEW_LIMIT) {
      recordRateEvent(db, bucket, now);
      const metadata = await fetchLinkMetadata(queryUrl);
      if (metadata) {
        values = {
          ...values,
          title: metadata.title || values.title,
          notes: metadata.description || values.notes,
        };
      }
    }
    return itemPage(c, list, 'create', values);
  });

  app.post('/lists/:id/items', requireUser, async (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const list = ownedList(db, user.id, c.req.param('id'));
    if (!list) return notFound(c);
    const parsed = parseItemInput(c);
    if (!parsed.success) {
      return itemPage(c, list, 'create', valuesFromItemForm(c.get('form')), zodErrorKeys(parsed.error), null, 400);
    }

    const upload = await readUpload(c);
    if (upload.error) {
      return itemPage(c, list, 'create', valuesFromItemForm(c.get('form')), [upload.error], null, 400);
    }

    let storedId: string | null = null;
    try {
      if (upload.file) {
        const stored = await storeImage(db, c.get('config'), user.id, upload.file);
        storedId = stored.id;
      }
      const itemId = randomId();
      const now = Date.now();
      const position = nextPosition(db, list.id);
      const links = cleanedLinks(parsed.data);
      db.transaction(() => {
        db.prepare(
          `INSERT INTO items (id, list_id, user_id, title, url, image_upload_id, price_minor, currency, quantity, priority,
                              notes, size, color, is_archived, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        ).run(
          itemId,
          list.id,
          user.id,
          parsed.data.title,
          parsed.data.url,
          storedId,
          itemPrice(parsed.data),
          parsed.data.currency,
          parsed.data.quantity,
          parsed.data.priority,
          parsed.data.notes,
          parsed.data.size,
          parsed.data.color,
          position,
          now,
          now,
        );
        insertLinks(db, itemId, links);
      })();
      c.get('logger').info('item.created', { userId: user.id });
      return redirectWithNotice(c, `/lists/${list.id}#item-${itemId}`, 'itemCreated');
    } catch (error) {
      if (storedId) await deleteUploadIfUnused(db, c.get('config'), storedId);
      if (error instanceof ImageError) {
        return itemPage(c, list, 'create', valuesFromItemForm(c.get('form')), [`validation.${imageErrorKey(error.code)}`], null, 400);
      }
      throw error;
    }
  });

  app.get('/items/:id/edit', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const item = ownedItem(db, user.id, c.req.param('id'));
    if (!item) return notFound(c);
    const list = ownedList(db, user.id, item.list_id);
    if (!list) return notFound(c);
    const links = linksByItem(db, [item.id]).get(item.id) ?? [];
    return itemPage(c, list, 'edit', itemFormValuesFromItem(item, links), [], item.image_upload_id, 200, item.id);
  });

  app.post('/items/:id/edit', requireUser, async (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const item = ownedItem(db, user.id, c.req.param('id'));
    if (!item) return notFound(c);
    const list = ownedList(db, user.id, item.list_id);
    if (!list) return notFound(c);
    const parsed = parseItemInput(c);
    if (!parsed.success) {
      return itemPage(
        c,
        list,
        'edit',
        valuesFromItemForm(c.get('form')),
        zodErrorKeys(parsed.error),
        item.image_upload_id,
        400,
        item.id,
      );
    }

    const upload = await readUpload(c);
    if (upload.error) {
      return itemPage(c, list, 'edit', valuesFromItemForm(c.get('form')), [upload.error], item.image_upload_id, 400, item.id);
    }
    const removeImage = formString(c.get('form'), 'remove_image') === '1';
    let storedId: string | null = item.image_upload_id;
    let newlyStored: string | null = null;
    try {
      if (upload.file) {
        const stored = await storeImage(db, c.get('config'), user.id, upload.file);
        newlyStored = stored.id;
        storedId = stored.id;
      } else if (removeImage) {
        storedId = null;
      }
      const links = cleanedLinks(parsed.data);
      db.transaction(() => {
        db.prepare(
          `UPDATE items SET title = ?, url = ?, image_upload_id = ?, price_minor = ?, currency = ?, quantity = ?,
                            priority = ?, notes = ?, size = ?, color = ?, updated_at = ?
            WHERE id = ? AND user_id = ?`,
        ).run(
          parsed.data.title,
          parsed.data.url,
          storedId,
          itemPrice(parsed.data),
          parsed.data.currency,
          parsed.data.quantity,
          parsed.data.priority,
          parsed.data.notes,
          parsed.data.size,
          parsed.data.color,
          Date.now(),
          item.id,
          user.id,
        );
        db.prepare('DELETE FROM item_links WHERE item_id = ?').run(item.id);
        insertLinks(db, item.id, links);
      })();
      if (item.image_upload_id && item.image_upload_id !== storedId) {
        await deleteUploadIfUnused(db, c.get('config'), item.image_upload_id);
      }
      return redirectWithNotice(c, `/lists/${list.id}#item-${item.id}`, 'itemUpdated');
    } catch (error) {
      if (newlyStored) await deleteUploadIfUnused(db, c.get('config'), newlyStored);
      if (error instanceof ImageError) {
        return itemPage(c, list, 'edit', valuesFromItemForm(c.get('form')), [`validation.${imageErrorKey(error.code)}`], item.image_upload_id, 400, item.id);
      }
      throw error;
    }
  });

  app.post('/items/:id/move', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const item = ownedItem(db, user.id, c.req.param('id'));
    if (!item) return notFound(c);
    if (item.is_archived === 1) return badRequest(c);
    const direction = formString(c.get('form'), 'dir');
    if (direction !== 'up' && direction !== 'down') return badRequest(c);

    const rows = db
      .prepare('SELECT id FROM items WHERE list_id = ? AND is_archived = 0 ORDER BY position ASC, created_at ASC')
      .all(item.list_id) as Array<{ id: string }>;
    const index = rows.findIndex((row) => row.id === item.id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index >= 0 && target >= 0 && target < rows.length) {
      db.transaction(() => {
        const update = db.prepare('UPDATE items SET position = ?, updated_at = ? WHERE id = ?');
        const now = Date.now();
        [rows[index], rows[target]] = [rows[target] as { id: string }, rows[index] as { id: string }];
        rows.forEach((row, position) => update.run(position, now, row.id));
      })();
    }
    return c.redirect(`/lists/${item.list_id}#item-${item.id}`, 303);
  });

  app.post('/items/:id/duplicate', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const item = ownedItem(db, user.id, c.req.param('id'));
    if (!item) return notFound(c);
    const links = linksByItem(db, [item.id]).get(item.id) ?? [];
    const newId = randomId();
    const now = Date.now();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO items (id, list_id, user_id, title, url, image_upload_id, price_minor, currency, quantity, priority,
                            notes, size, color, is_archived, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      ).run(
        newId,
        item.list_id,
        user.id,
        item.title,
        item.url,
        item.image_upload_id,
        item.price_minor,
        item.currency,
        item.quantity,
        item.priority,
        item.notes,
        item.size,
        item.color,
        nextPosition(db, item.list_id),
        now,
        now,
      );
      insertLinks(
        db,
        newId,
        links.map((link) => ({ label: link.label, url: link.url })),
      );
    })();
    return redirectWithNotice(c, `/lists/${item.list_id}#item-${newId}`, 'itemDuplicated');
  });

  app.post('/items/:id/archive', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const item = ownedItem(c.get('db'), user.id, c.req.param('id'));
    if (!item) return notFound(c);
    c.get('db').prepare('UPDATE items SET is_archived = 1, updated_at = ? WHERE id = ? AND user_id = ?').run(Date.now(), item.id, user.id);
    return redirectWithNotice(c, `/lists/${item.list_id}?archived=1`, 'itemArchived');
  });

  app.post('/items/:id/unarchive', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const item = ownedItem(db, user.id, c.req.param('id'));
    if (!item) return notFound(c);
    db.prepare('UPDATE items SET is_archived = 0, position = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
      nextPosition(db, item.list_id),
      Date.now(),
      item.id,
      user.id,
    );
    return redirectWithNotice(c, `/lists/${item.list_id}#item-${item.id}`, 'itemUnarchived');
  });

  app.post('/items/:id/move-to', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const item = ownedItem(db, user.id, c.req.param('id'));
    if (!item) return notFound(c);
    const target = ownedList(db, user.id, formString(c.get('form'), 'list_id'));
    if (!target) return badRequest(c);
    if (target.id === item.list_id) return c.redirect(`/lists/${item.list_id}#item-${item.id}`, 303);
    db.prepare('UPDATE items SET list_id = ?, position = ?, is_archived = 0, updated_at = ? WHERE id = ? AND user_id = ?').run(
      target.id,
      nextPosition(db, target.id),
      Date.now(),
      item.id,
      user.id,
    );
    return redirectWithNotice(c, `/lists/${target.id}#item-${item.id}`, 'itemMoved');
  });

  app.post('/items/:id/delete', requireUser, async (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const item = ownedItem(db, user.id, c.req.param('id'));
    if (!item) return notFound(c);
    db.prepare('DELETE FROM items WHERE id = ? AND user_id = ?').run(item.id, user.id);
    if (item.image_upload_id) {
      await deleteUploadIfUnused(db, c.get('config'), item.image_upload_id);
    }
    return redirectWithNotice(c, `/lists/${item.list_id}`, 'itemDeleted');
  });
}

function imageErrorKey(code: ImageError['code']): string {
  if (code === 'too_large') return 'imageTooLarge';
  if (code === 'unsupported_type') return 'imageUnsupported';
  return 'imageInvalid';
}
