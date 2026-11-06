import type { Context, Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { requireUser } from '../middleware/auth.js';
import { formString } from '../lib/forms.js';
import { groupInputSchema, zodErrorKeys } from '../lib/validation.js';
import { randomId, randomToken } from '../lib/ids.js';
import {
  groupByInviteToken,
  groupLists,
  groupMembers,
  groupWithCounts,
  isGroupMember,
  userGroups,
} from '../lib/access.js';
import type { GroupWithCounts } from '../lib/access.js';
import { listPreviewItems } from '../lib/access.js';
import { renderPage, redirectWithNotice } from '../views/layout.js';
import { GroupDetail, GroupFormPage, GroupsIndex, JoinGroupPage } from '../views/groups.js';
import type { GroupFormValues } from '../views/groups.js';
import { badRequest, forbidden, notFound } from '../views/errors.js';
import { translate } from '../lib/i18n.js';

function ownedGroup(db: AppEnv['Variables']['db'], userId: string, groupId: string): GroupWithCounts | null {
  const group = groupWithCounts(db, groupId);
  if (!group || group.owner_id !== userId) return null;
  return group;
}

function visibleGroup(db: AppEnv['Variables']['db'], userId: string, groupId: string): GroupWithCounts | null {
  const group = groupWithCounts(db, groupId);
  if (!group || !isGroupMember(db, group.id, userId)) return null;
  return group;
}

function usernameOf(db: AppEnv['Variables']['db'], userId: string): string {
  const row = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string } | undefined;
  return row?.username ?? '';
}

function ownerListsForGroup(
  db: AppEnv['Variables']['db'],
  userId: string,
  groupId: string,
): Array<{ id: string; name: string }> {
  return db
    .prepare(
      `SELECT l.id, l.name
         FROM lists l
        WHERE l.user_id = ?
          AND NOT EXISTS (SELECT 1 FROM list_groups lg WHERE lg.list_id = l.id AND lg.group_id = ?)
        ORDER BY l.name COLLATE NOCASE ASC`,
    )
    .all(userId, groupId) as Array<{ id: string; name: string }>;
}

function inviteUrl(c: Context<AppEnv>, token: string | null): string | null {
  if (!token) return null;
  return `${c.get('config').baseUrl.replace(/\/+$/, '')}/join/${token}`;
}

function groupPage(c: Context<AppEnv>, group: GroupWithCounts, status: 200 | 400 = 200) {
  const user = c.get('user');
  if (!user) return c.redirect('/login', 303);
  const db = c.get('db');
  const lists = groupLists(db, group.id);
  return renderPage(
    c,
    { title: group.name, active: 'groups', status },
    <GroupDetail
      locale={c.get('locale')}
      csrfToken={c.get('csrfToken')}
      group={group}
      members={groupMembers(db, group.id)}
      lists={lists}
      previews={listPreviewItems(db, lists.map((list) => list.id))}
      ownerUsername={usernameOf(db, group.owner_id)}
      currentUserId={user.id}
      inviteUrl={inviteUrl(c, group.invite_token)}
      ownerLists={ownerListsForGroup(db, user.id, group.id)}
    />,
  );
}

export function registerGroupRoutes(app: Hono<AppEnv>): void {
  app.get('/groups', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    return renderPage(
      c,
      { title: translate(c.get('locale'), 'groups.title'), active: 'groups' },
      <GroupsIndex locale={c.get('locale')} groups={userGroups(c.get('db'), user.id)} />,
    );
  });

  app.get('/groups/new', requireUser, (c) => {
    return renderPage(
      c,
      { title: translate(c.get('locale'), 'groups.createTitle'), active: 'groups' },
      <GroupFormPage locale={c.get('locale')} csrfToken={c.get('csrfToken')} values={{ name: '', note: '' }} errors={[]} />,
    );
  });

  app.post('/groups', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const parsed = groupInputSchema.safeParse({
      name: formString(c.get('form'), 'name'),
      note: formString(c.get('form'), 'note'),
    });
    const values: GroupFormValues = {
      name: formString(c.get('form'), 'name'),
      note: formString(c.get('form'), 'note'),
    };
    if (!parsed.success) {
      return renderPage(
        c,
        { title: translate(c.get('locale'), 'groups.createTitle'), active: 'groups', status: 400 },
        <GroupFormPage
          locale={c.get('locale')}
          csrfToken={c.get('csrfToken')}
          values={values}
          errors={zodErrorKeys(parsed.error)}
        />,
      );
    }

    const db = c.get('db');
    const id = randomId();
    const now = Date.now();
    db.transaction(() => {
      db.prepare(
        'INSERT INTO groups (id, owner_id, name, note, invite_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, user.id, parsed.data.name, parsed.data.note, randomToken(24), now, now);
      db.prepare('INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)').run(id, user.id, now);
    })();
    c.get('logger').info('group.created', { userId: user.id, groupId: id });
    return redirectWithNotice(c, `/groups/${id}`, 'groupCreated');
  });

  app.get('/groups/:id', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const group = visibleGroup(c.get('db'), user.id, c.req.param('id'));
    if (!group) return notFound(c);
    return groupPage(c, group);
  });

  app.post('/groups/:id/share', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const group = visibleGroup(db, user.id, c.req.param('id'));
    if (!group) return notFound(c);
    const listId = formString(c.get('form'), 'list_id');
    const list = db.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?').get(listId, user.id) as
      | { id: string }
      | undefined;
    if (!list) return badRequest(c);
    db.prepare(
      'INSERT OR IGNORE INTO list_groups (list_id, group_id, shared_by, created_at) VALUES (?, ?, ?, ?)',
    ).run(list.id, group.id, user.id, Date.now());
    c.get('logger').info('list.shared', { userId: user.id, listId: list.id, groupId: group.id });
    return redirectWithNotice(c, `/groups/${group.id}`, 'listShared');
  });

  app.post('/groups/:id/unshare', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const group = visibleGroup(db, user.id, c.req.param('id'));
    if (!group) return notFound(c);
    const listId = formString(c.get('form'), 'list_id');
    const list = db.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?').get(listId, user.id) as
      | { id: string }
      | undefined;
    if (!list) return badRequest(c);
    db.prepare('DELETE FROM list_groups WHERE list_id = ? AND group_id = ?').run(list.id, group.id);
    return redirectWithNotice(c, `/groups/${group.id}`, 'listUnshared');
  });

  app.post('/groups/:id/invite/rotate', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const group = ownedGroup(c.get('db'), user.id, c.req.param('id'));
    if (!group) return notFound(c);
    c.get('db')
      .prepare('UPDATE groups SET invite_token = ?, updated_at = ? WHERE id = ?')
      .run(randomToken(24), Date.now(), group.id);
    return redirectWithNotice(c, `/groups/${group.id}`, 'inviteRotated');
  });

  app.post('/groups/:id/invite/disable', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const group = ownedGroup(c.get('db'), user.id, c.req.param('id'));
    if (!group) return notFound(c);
    c.get('db').prepare('UPDATE groups SET invite_token = NULL, updated_at = ? WHERE id = ?').run(Date.now(), group.id);
    return redirectWithNotice(c, `/groups/${group.id}`, 'inviteDisabled');
  });

  app.post('/groups/:id/invite/enable', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const group = ownedGroup(c.get('db'), user.id, c.req.param('id'));
    if (!group) return notFound(c);
    c.get('db')
      .prepare('UPDATE groups SET invite_token = ?, updated_at = ? WHERE id = ?')
      .run(randomToken(24), Date.now(), group.id);
    return redirectWithNotice(c, `/groups/${group.id}`, 'inviteEnabled');
  });

  app.post('/groups/:id/leave', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const group = visibleGroup(db, user.id, c.req.param('id'));
    if (!group) return notFound(c);
    if (group.owner_id === user.id) return forbidden(c);
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(group.id, user.id);
    return redirectWithNotice(c, '/groups', 'groupLeft');
  });

  app.post('/groups/:id/members/:userId/remove', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const group = ownedGroup(db, user.id, c.req.param('id'));
    if (!group) return notFound(c);
    const targetId = c.req.param('userId');
    if (targetId === group.owner_id) return badRequest(c);
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(group.id, targetId);
    return redirectWithNotice(c, `/groups/${group.id}`, 'memberRemoved');
  });

  app.post('/groups/:id/delete', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const group = ownedGroup(c.get('db'), user.id, c.req.param('id'));
    if (!group) return notFound(c);
    c.get('db').prepare('DELETE FROM groups WHERE id = ? AND owner_id = ?').run(group.id, user.id);
    c.get('logger').info('group.deleted', { userId: user.id, groupId: group.id });
    return redirectWithNotice(c, '/groups', 'groupDeleted');
  });

  app.get('/join/:token', (c) => {
    const user = c.get('user');
    const token = c.req.param('token');
    if (!user) return c.redirect(`/login?next=${encodeURIComponent(`/join/${token}`)}`, 303);
    const db = c.get('db');
    const group = groupByInviteToken(db, token);
    if (!group || !group.invite_token) return notFound(c);
    if (isGroupMember(db, group.id, user.id)) return c.redirect(`/groups/${group.id}`, 303);
    return renderPage(
      c,
      { title: translate(c.get('locale'), 'groups.joinTitle', { group: group.name }), noindex: true },
      <JoinGroupPage
        locale={c.get('locale')}
        csrfToken={c.get('csrfToken')}
        group={group}
        alreadyMember={false}
      />,
    );
  });

  app.post('/join/:token', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const group = groupByInviteToken(db, c.req.param('token'));
    if (!group || !group.invite_token) return notFound(c);
    db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)').run(
      group.id,
      user.id,
      Date.now(),
    );
    c.get('logger').info('group.joined', { userId: user.id, groupId: group.id });
    return redirectWithNotice(c, `/groups/${group.id}`, 'groupJoined');
  });
}
