import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createHarness,
  createUser,
  createList,
  createItem,
  login,
  pngFile,
  TestClient,
} from './helpers.js';

async function twoUsers(harness: Awaited<ReturnType<typeof createHarness>>) {
  const alice = await createUser(harness, 'alice', 'alice password');
  const bob = await createUser(harness, 'bob', 'bob password');
  return {
    alice,
    bob,
    aliceClient: await login(harness, alice),
    bobClient: await login(harness, bob),
  };
}

test('lists can be created, edited and deleted, and are private to their owner', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient, bobClient } = await twoUsers(harness);

  const listId = await createList(aliceClient, {
    name: 'Birthday wishes',
    emoji: '🎂',
    color: '3',
    note: 'All the cosy things',
  });
  const row = harness.db.prepare('SELECT * FROM lists WHERE id = ?').get(listId) as {
    name: string;
    emoji: string;
    color: number;
    note: string;
    user_id: string;
  };
  assert.equal(row.name, 'Birthday wishes');
  assert.equal(row.emoji, '🎂');
  assert.equal(row.color, 3);
  assert.equal(row.note, 'All the cosy things');

  const index = await aliceClient.page('/lists');
  assert.equal(index.status, 200);
  assert.match(index.html, /Birthday wishes/);
  assert.match(index.html, /Private/);

  const detail = await aliceClient.page(`/lists/${listId}`);
  assert.equal(detail.status, 200);
  assert.match(detail.html, /Add a wish/);
  assert.match(detail.html, /data-confirm=/);

  // The other user cannot read or mutate Alice's list.
  assert.equal((await bobClient.get(`/lists/${listId}`)).status, 404);
  assert.equal((await bobClient.get(`/lists/${listId}/edit`)).status, 404);
  assert.equal(
    (await bobClient.post(`/lists/${listId}`, { name: 'Stolen', emoji: '', color: '0', note: '' })).status,
    404,
  );
  assert.equal((await bobClient.post(`/lists/${listId}/delete`, {})).status, 404);
  assert.equal((await aliceClient.get(`/lists/${listId}`)).status, 200);

  const edit = await aliceClient.post(`/lists/${listId}`, {
    name: 'Birthday wishes 2026',
    emoji: '🎁',
    color: '5',
    note: 'Updated',
  });
  assert.equal(edit.status, 303);
  assert.match(edit.headers.get('location') ?? '', new RegExp(`^/lists/${listId}\\?notice=listUpdated$`));
  const updated = harness.db.prepare('SELECT * FROM lists WHERE id = ?').get(listId) as {
    name: string;
    emoji: string;
    color: number;
  };
  assert.equal(updated.name, 'Birthday wishes 2026');
  assert.equal(updated.emoji, '🎁');
  assert.equal(updated.color, 5);

  const invalid = await aliceClient.post(`/lists/${listId}`, { name: '', emoji: '', color: '0', note: '' });
  assert.equal(invalid.status, 400);

  const deleted = await aliceClient.post(`/lists/${listId}/delete`, {});
  assert.equal(deleted.status, 303);
  assert.equal(deleted.headers.get('location'), '/lists?notice=listDeleted');
  const listCount = harness.db.prepare('SELECT COUNT(*) AS n FROM lists').get() as { n: number };
  assert.equal(listCount.n, 0);
});

test('items store every manual field, links, and validated prices', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient } = await twoUsers(harness);
  const listId = await createList(aliceClient, { name: 'Wishes' });

  const itemId = await createItem(aliceClient, listId, {
    title: 'Soft wool blanket',
    url: 'https://shop.example/blanket',
    price: '12,50',
    currency: 'eur',
    quantity: '2',
    priority: '3',
    notes: 'Sand colour, please',
    size: '150 × 200 cm',
    color: 'Sand',
    linkLabels: ['Gift shop', 'Second shop'],
    linkUrls: ['https://shop.example/blanket', 'https://other.example/item?id=1'],
  });

  const item = harness.db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as Record<string, unknown>;
  assert.equal(item.title, 'Soft wool blanket');
  assert.equal(item.url, 'https://shop.example/blanket');
  assert.equal(item.price_minor, 1250);
  assert.equal(item.currency, 'EUR');
  assert.equal(item.quantity, 2);
  assert.equal(item.priority, 3);
  assert.equal(item.notes, 'Sand colour, please');
  assert.equal(item.size, '150 × 200 cm');
  assert.equal(item.color, 'Sand');
  assert.equal(item.is_archived, 0);

  const links = harness.db.prepare('SELECT * FROM item_links WHERE item_id = ? ORDER BY position').all(itemId) as Array<{
    label: string;
    url: string;
  }>;
  assert.deepEqual(
    links.map((link) => ({ label: link.label, url: link.url })),
    [
      { label: 'Gift shop', url: 'https://shop.example/blanket' },
      { label: 'Second shop', url: 'https://other.example/item?id=1' },
    ],
  );

  const detail = await aliceClient.page(`/lists/${listId}`);
  assert.match(detail.html, /Soft wool blanket/);
  assert.match(detail.html, /12\.50/);
  assert.match(detail.html, /rel="noopener noreferrer nofollow"/);
  assert.match(detail.html, /Gift shop/);
  assert.match(detail.html, new RegExp(`id="item-${itemId}"`));

  // Quick-add from a URL prefills the item form but never fetches the page.
  const quick = await aliceClient.page(`/lists/${listId}/items/new?url=${encodeURIComponent('https://shop.example/x')}`);
  assert.equal(quick.status, 200);
  assert.match(quick.html, /value="https:\/\/shop\.example\/x"/);
  const unsafeQuick = await aliceClient.page(`/lists/${listId}/items/new?url=${encodeURIComponent('javascript:alert(1)')}`);
  assert.doesNotMatch(unsafeQuick.html, /javascript:alert/);

  // Edit all fields and replace links.
  const edited = await aliceClient.post(`/items/${itemId}/edit`, {
    title: 'Even softer wool blanket',
    url: '',
    price: '99.99',
    currency: 'USD',
    quantity: '1',
    priority: '0',
    notes: 'Changed my mind',
    size: '',
    color: 'Moss',
    linkLabels: ['Only link'],
    linkUrls: ['https://shop.example/new'],
  });
  assert.equal(edited.status, 303);
  const updated = harness.db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as {
    title: string;
    price_minor: number;
    currency: string;
    priority: number;
    size: string;
  };
  assert.equal(updated.title, 'Even softer wool blanket');
  assert.equal(updated.price_minor, 9999);
  assert.equal(updated.currency, 'USD');
  assert.equal(updated.priority, 0);
  assert.equal(updated.size, '');
  const newLinks = harness.db.prepare('SELECT * FROM item_links WHERE item_id = ?').all(itemId) as unknown[];
  assert.equal(newLinks.length, 1);
});

test('price and URL validation reject bad input without creating items', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient } = await twoUsers(harness);
  const listId = await createList(aliceClient, { name: 'Validation' });

  const cases: Array<Record<string, string>> = [
    { price: '12.555', currency: 'EUR' },
    { price: '1.2', currency: 'JPY' },
    { price: '1.2345', currency: 'KWD' },
    { price: '1.2.3', currency: 'EUR' },
    { price: '12', currency: 'EURO' },
    { url: 'javascript:alert(1)' },
    { url: 'not a url' },
    { quantity: '0' },
    { quantity: '1000' },
    { priority: '4' },
  ];
  for (const overrides of cases) {
    const response = await aliceClient.post(`/lists/${listId}/items`, {
      title: 'Invalid item',
      url: '',
      price: '',
      currency: 'EUR',
      quantity: '1',
      priority: '1',
      notes: '',
      size: '',
      color: '',
      linkLabels: [],
      linkUrls: [],
      ...overrides,
    });
    assert.equal(response.status, 400, JSON.stringify(overrides));
  }

  const badLink = await aliceClient.post(`/lists/${listId}/items`, {
    title: 'Bad link',
    url: '',
    price: '',
    currency: 'EUR',
    quantity: '1',
    priority: '1',
    notes: '',
    size: '',
    color: '',
    linkLabels: ['Label without URL'],
    linkUrls: [''],
  });
  assert.equal(badLink.status, 400);
  assert.equal((harness.db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n, 0);

  // Zero-decimal and three-decimal currencies store exact integers.
  const yenId = await createItem(aliceClient, listId, { title: 'Yen item', price: '1200', currency: 'JPY' });
  const dinarId = await createItem(aliceClient, listId, { title: 'Dinar item', price: '1.234', currency: 'KWD' });
  const yen = harness.db.prepare('SELECT price_minor FROM items WHERE id = ?').get(yenId) as { price_minor: number };
  const dinar = harness.db.prepare('SELECT price_minor FROM items WHERE id = ?').get(dinarId) as { price_minor: number };
  assert.equal(yen.price_minor, 1200);
  assert.equal(dinar.price_minor, 1234);
});

test('item titles and notes are escaped in HTML', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient } = await twoUsers(harness);
  const listId = await createList(aliceClient, { name: '<script>alert("list")</script>' });
  const itemId = await createItem(aliceClient, listId, {
    title: '<script>alert("item")</script>',
    notes: '<img src=x onerror=alert(1)>',
  });

  const detail = await aliceClient.page(`/lists/${listId}`);
  assert.equal(detail.status, 200);
  assert.doesNotMatch(detail.html, /<script>alert\("item"\)<\/script>/);
  assert.doesNotMatch(detail.html, /<script>alert\("list"\)<\/script>/);
  assert.doesNotMatch(detail.html, /<img src=x onerror=alert\(1\)>/);
  assert.match(detail.html, /&lt;script&gt;alert\(&quot;item&quot;\)&lt;\/script&gt;/);
  assert.match(detail.html, new RegExp(`id="item-${itemId}"`));
});

test('image uploads are validated, re-encoded, served privately and cleaned up', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient, bobClient } = await twoUsers(harness);
  const listId = await createList(aliceClient, { name: 'Photos' });

  const itemId = await createItem(aliceClient, listId, { title: 'With a photo', image: await pngFile() });
  const item = harness.db.prepare('SELECT image_upload_id FROM items WHERE id = ?').get(itemId) as {
    image_upload_id: string;
  };
  assert.ok(item.image_upload_id);
  const upload = harness.db.prepare('SELECT * FROM uploads WHERE id = ?').get(item.image_upload_id) as {
    filename: string;
    mime: string;
    width: number;
    height: number;
  };
  assert.equal(upload.mime, 'image/webp');
  assert.equal(upload.width, 8);
  assert.equal(upload.height, 8);
  const filePath = path.join(harness.config.uploadsDir, upload.filename);
  await fs.access(filePath);

  const media = await aliceClient.get(`/media/${upload.filename}`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'image/webp');
  assert.match(media.headers.get('cache-control') ?? '', /private/);
  assert.equal(media.headers.get('content-disposition'), 'inline');

  assert.equal((await bobClient.get(`/media/${upload.filename}`)).status, 403);
  assert.equal((await new TestClient(harness).get(`/media/${upload.filename}`)).status, 401);
  assert.equal((await aliceClient.get('/media/not-a-real-file.webp')).status, 404);

  // SVG is refused by declared MIME type and, disguised as PNG, by magic bytes.
  const svg = new File([new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))], 'x.svg', {
    type: 'image/svg+xml',
  });
  const svgResponse = await aliceClient.post(`/lists/${listId}/items`, {
    title: 'SVG item',
    url: '',
    price: '',
    currency: 'EUR',
    quantity: '1',
    priority: '1',
    notes: '',
    size: '',
    color: '',
    linkLabels: [],
    linkUrls: [],
    image: svg,
  });
  assert.equal(svgResponse.status, 400);

  const disguised = new File([new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))], 'x.png', {
    type: 'image/png',
  });
  const disguisedResponse = await aliceClient.post(`/lists/${listId}/items`, {
    title: 'Disguised SVG',
    url: '',
    price: '',
    currency: 'EUR',
    quantity: '1',
    priority: '1',
    notes: '',
    size: '',
    color: '',
    linkLabels: [],
    linkUrls: [],
    image: disguised,
  });
  assert.equal(disguisedResponse.status, 400);

  // Oversized uploads are rejected before processing (limit is 1 MB for tests).
  const large = new File([new Uint8Array(1_100_000)], 'large.png', { type: 'image/png' });
  const largeResponse = await aliceClient.post(`/lists/${listId}/items`, {
    title: 'Too large',
    url: '',
    price: '',
    currency: 'EUR',
    quantity: '1',
    priority: '1',
    notes: '',
    size: '',
    color: '',
    linkLabels: [],
    linkUrls: [],
    image: large,
  });
  assert.equal(largeResponse.status, 400);

  // Removing the image deletes the upload row and file.
  const removed = await aliceClient.post(`/items/${itemId}/edit`, {
    title: 'Without a photo',
    url: '',
    price: '',
    currency: 'EUR',
    quantity: '1',
    priority: '1',
    notes: '',
    size: '',
    color: '',
    linkLabels: [],
    linkUrls: [],
    remove_image: '1',
  });
  assert.equal(removed.status, 303);
  const afterRemove = harness.db.prepare('SELECT image_upload_id FROM items WHERE id = ?').get(itemId) as {
    image_upload_id: string | null;
  };
  assert.equal(afterRemove.image_upload_id, null);
  const uploadCount = harness.db.prepare('SELECT COUNT(*) AS n FROM uploads WHERE id = ?').get(item.image_upload_id) as {
    n: number;
  };
  assert.equal(uploadCount.n, 0);
  await assert.rejects(fs.access(filePath));
});

test('items can be reordered, duplicated, moved, archived and deleted', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient } = await twoUsers(harness);
  const listId = await createList(aliceClient, { name: 'Ordering' });
  const otherListId = await createList(aliceClient, { name: 'Elsewhere' });

  const first = await createItem(aliceClient, listId, { title: 'First' });
  const second = await createItem(aliceClient, listId, { title: 'Second', linkLabels: ['Shop'], linkUrls: ['https://shop.example'] });
  const third = await createItem(aliceClient, listId, { title: 'Third' });

  const positions = () =>
    harness.db.prepare('SELECT id, position FROM items WHERE list_id = ? AND is_archived = 0 ORDER BY position').all(listId) as Array<{
      id: string;
      position: number;
    }>;
  assert.deepEqual(positions().map((row) => row.id), [first, second, third]);

  // Move the middle item up, then the last item down (no-op at the edge).
  assert.equal((await aliceClient.post(`/items/${second}/move`, { dir: 'up' })).status, 303);
  assert.deepEqual(positions().map((row) => row.id), [second, first, third]);
  assert.deepEqual(positions().map((row) => row.position), [0, 1, 2]);
  await aliceClient.post(`/items/${third}/move`, { dir: 'down' });
  assert.deepEqual(positions().map((row) => row.id), [second, first, third]);
  await aliceClient.post(`/items/${second}/move`, { dir: 'up' });
  assert.deepEqual(positions().map((row) => row.id), [second, first, third]);
  const badDirection = await aliceClient.post(`/items/${first}/move`, { dir: 'sideways' });
  assert.equal(badDirection.status, 400);

  // Duplicate copies fields and links into a new item at the end.
  const duplicate = await aliceClient.post(`/items/${second}/duplicate`, {});
  assert.equal(duplicate.status, 303);
  const location = duplicate.headers.get('location') ?? '';
  const duplicateId = location.match(/#item-([a-f0-9]{32})/)?.[1];
  assert.ok(duplicateId);
  assert.notEqual(duplicateId, second);
  const duplicateLinks = harness.db.prepare('SELECT * FROM item_links WHERE item_id = ?').all(duplicateId) as Array<{
    url: string;
  }>;
  assert.deepEqual(duplicateLinks.map((link) => link.url), ['https://shop.example']);
  assert.deepEqual(positions().map((row) => row.id), [second, first, third, duplicateId]);

  // Move to another list.
  const moved = await aliceClient.post(`/items/${third}/move-to`, { list_id: otherListId });
  assert.equal(moved.status, 303);
  assert.equal(moved.headers.get('location'), `/lists/${otherListId}?notice=itemMoved#item-${third}`);
  const movedItem = harness.db.prepare('SELECT list_id, position FROM items WHERE id = ?').get(third) as {
    list_id: string;
    position: number;
  };
  assert.equal(movedItem.list_id, otherListId);
  assert.equal(movedItem.position, 0);
  assert.equal((await aliceClient.post(`/items/${first}/move-to`, { list_id: 'missing' })).status, 400);

  // Archive hides an item, unarchive appends it to the end of the active list.
  const archived = await aliceClient.post(`/items/${first}/archive`, {});
  assert.equal(archived.status, 303);
  assert.equal(archived.headers.get('location'), `/lists/${listId}?archived=1&notice=itemArchived`);
  const archivedRow = harness.db.prepare('SELECT is_archived FROM items WHERE id = ?').get(first) as { is_archived: number };
  assert.equal(archivedRow.is_archived, 1);
  const activePage = await aliceClient.page(`/lists/${listId}`);
  assert.doesNotMatch(activePage.html, new RegExp(`id="item-${first}"`));
  const archivedPage = await aliceClient.page(`/lists/${listId}?archived=1`);
  assert.match(archivedPage.html, new RegExp(`id="item-${first}"`));

  const unarchived = await aliceClient.post(`/items/${first}/unarchive`, {});
  assert.equal(unarchived.status, 303);
  assert.match(positions().map((row) => row.id).join(','), new RegExp(`${first}$`));
  assert.equal((await aliceClient.post(`/items/${first}/move`, { dir: 'up' })).status, 303);

  // Delete removes the item.
  const deleted = await aliceClient.post(`/items/${first}/delete`, {});
  assert.equal(deleted.status, 303);
  const itemCount = harness.db.prepare('SELECT COUNT(*) AS n FROM items WHERE id = ?').get(first) as { n: number };
  assert.equal(itemCount.n, 0);
});

test('item routes enforce ownership (IDOR)', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient, bobClient } = await twoUsers(harness);
  const aliceList = await createList(aliceClient, { name: 'Alice private' });
  const bobList = await createList(bobClient, { name: 'Bob private' });
  const aliceItem = await createItem(aliceClient, aliceList, { title: 'Alice item' });
  const bobItem = await createItem(bobClient, bobList, { title: 'Bob item' });

  assert.equal((await bobClient.get(`/items/${aliceItem}/edit`)).status, 404);
  for (const pathName of [
    `/items/${aliceItem}/edit`,
    `/items/${aliceItem}/move`,
    `/items/${aliceItem}/duplicate`,
    `/items/${aliceItem}/archive`,
    `/items/${aliceItem}/unarchive`,
    `/items/${aliceItem}/move-to`,
    `/items/${aliceItem}/delete`,
  ]) {
    const response = await bobClient.post(pathName, {
      title: 'hijacked',
      list_id: bobList,
      dir: 'up',
    });
    assert.equal(response.status, 404, pathName);
  }
  // Bob cannot insert into Alice's list either.
  const insert = await bobClient.post(`/lists/${aliceList}/items`, {
    title: 'Injected',
    url: '',
    price: '',
    currency: 'EUR',
    quantity: '1',
    priority: '1',
    notes: '',
    size: '',
    color: '',
    linkLabels: [],
    linkUrls: [],
  });
  assert.equal(insert.status, 404);

  // Alice's item is untouched and Bob's own item still belongs to his list.
  const aliceRow = harness.db.prepare('SELECT title, list_id, user_id FROM items WHERE id = ?').get(aliceItem) as {
    title: string;
    list_id: string;
    user_id: string;
  };
  assert.equal(aliceRow.title, 'Alice item');
  assert.equal(aliceRow.list_id, aliceList);
  const bobRow = harness.db.prepare('SELECT list_id FROM items WHERE id = ?').get(bobItem) as { list_id: string };
  assert.equal(bobRow.list_id, bobList);

  // Unauthenticated access is redirected to login, with a safe next target.
  const anonymous = new TestClient(harness);
  const redirect = await anonymous.get(`/lists/${aliceList}`);
  assert.equal(redirect.status, 303);
  assert.equal(redirect.headers.get('location'), `/login?next=${encodeURIComponent(`/lists/${aliceList}`)}`);
});

test('account deletion requires confirmation and removes private data, but the last admin stays', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { alice, aliceClient } = await twoUsers(harness);
  const listId = await createList(aliceClient, { name: 'Will be deleted' });
  const itemId = await createItem(aliceClient, listId, { title: 'With photo', image: await pngFile() });
  const item = harness.db.prepare('SELECT image_upload_id FROM items WHERE id = ?').get(itemId) as {
    image_upload_id: string;
  };
  const upload = harness.db.prepare('SELECT filename FROM uploads WHERE id = ?').get(item.image_upload_id) as {
    filename: string;
  };
  const uploadPath = path.join(harness.config.uploadsDir, upload.filename);
  await fs.access(uploadPath);

  assert.equal(
    (await aliceClient.post('/settings/delete', {
      confirmUsername: 'wrong-name',
      password: 'alice password',
    })).status,
    400,
  );
  assert.equal(
    (await aliceClient.post('/settings/delete', {
      confirmUsername: 'alice',
      password: 'wrong password',
    })).status,
    400,
  );
  assert.ok(harness.db.prepare('SELECT 1 AS found FROM users WHERE id = ?').get(alice.id));

  const deleted = await aliceClient.post('/settings/delete', {
    confirmUsername: 'alice',
    password: 'alice password',
  });
  assert.equal(deleted.status, 303);
  assert.equal(deleted.headers.get('location'), '/login?notice=accountDeleted');
  assert.equal(harness.db.prepare('SELECT 1 AS found FROM users WHERE id = ?').get(alice.id), undefined);
  const listsLeft = harness.db.prepare('SELECT COUNT(*) AS n FROM lists').get() as { n: number };
  assert.equal(listsLeft.n, 0);
  const sessionsLeft = harness.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(alice.id) as {
    n: number;
  };
  assert.equal(sessionsLeft.n, 0);
  await assert.rejects(fs.access(uploadPath));
  assert.equal(aliceClient.cookie('wishlisto_session'), undefined);
  assert.equal((await aliceClient.get('/settings')).status, 303);

  // The one remaining admin cannot delete their own account.
  const secondHarness = await createHarness();
  t.after(secondHarness.close);
  const soloAdmin = await createUser(secondHarness, 'solo-admin', 'admin password', true);
  const soloClient = await login(secondHarness, soloAdmin);
  const lastAdmin = await soloClient.post('/settings/delete', {
    confirmUsername: 'solo-admin',
    password: 'admin password',
  });
  assert.equal(lastAdmin.status, 400);
  assert.ok(secondHarness.db.prepare('SELECT 1 AS found FROM users WHERE id = ?').get(soloAdmin.id));
});

test('settings show the fixed avatar, password, recovery code, language and delete accounts', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { alice, aliceClient, bobClient } = await twoUsers(harness);

  const settings = await aliceClient.page('/settings');
  assert.equal(settings.status, 200);
  assert.doesNotMatch(settings.html, /data-avatar-preview|avatar-editor/);
  assert.equal((await aliceClient.post('/settings/avatar', { style: 'bottts', seed: 'x' })).status, 404);
  assert.equal(
    (harness.db.prepare('SELECT avatar_seed FROM users WHERE id = ?').get(alice.id) as { avatar_seed: string })
      .avatar_seed,
    'alice',
  );

  // Password change requires the current password and invalidates other sessions.
  const other = await login(harness, alice);
  assert.equal(
    (await aliceClient.post('/settings/password', {
      current: 'wrong password',
      password: 'a new password',
      confirm: 'a new password',
    })).status,
    400,
  );
  assert.equal(
    (await aliceClient.post('/settings/password', {
      current: 'alice password',
      password: 'short',
      confirm: 'short',
    })).status,
    400,
  );
  const changed = await aliceClient.post('/settings/password', {
    current: 'alice password',
    password: 'a new password',
    confirm: 'a new password',
  });
  assert.equal(changed.status, 303);
  assert.equal(changed.headers.get('location'), '/settings?notice=passwordChanged');
  assert.equal((await other.get('/settings')).status, 303, 'other sessions must be destroyed');
  assert.equal((await aliceClient.get('/settings')).status, 200, 'current session must survive');

  // Recovery code regeneration is password-gated and shown once.
  assert.equal((await aliceClient.post('/settings/recovery', { password: 'wrong password' })).status, 400);
  const regeneration = await aliceClient.post('/settings/recovery', { password: 'a new password' });
  assert.equal(regeneration.status, 303);
  assert.equal(regeneration.headers.get('location'), '/welcome/recovery?from=settings');
  const recoveryPage = await aliceClient.page('/welcome/recovery?from=settings');
  assert.match(recoveryPage.html, /[0-9A-Z]{5}(?:-[0-9A-Z]{5}){3}/);
  const ack = await aliceClient.post('/welcome/recovery/ack', { from: 'settings' });
  assert.equal(ack.headers.get('location'), '/settings?notice=recoveryGenerated');

  // Language switches the UI and persists to the user and cookie.
  const language = await aliceClient.post('/settings/language', { locale: 'de' }, { headers: { referer: 'http://localhost/settings' } });
  assert.equal(language.status, 303);
  const german = await aliceClient.page('/settings');
  assert.match(german.html, /Einstellungen/);
  assert.match(language.headers.getSetCookie().join('\n'), /wishlisto_locale=de/);
  assert.equal(
    (harness.db.prepare('SELECT locale FROM users WHERE id = ?').get(alice.id) as { locale: string }).locale,
    'de',
  );
  // Invalid languages are ignored rather than crashing.
  const badLanguage = await aliceClient.post('/settings/language', { locale: 'fr' }, { headers: { referer: 'http://localhost/settings' } });
  assert.equal(badLanguage.status, 303);

  // Bob's session only ever changes Bob's own account, never Alice's.
  assert.equal(
    (await bobClient.post('/settings/password', { current: 'bob password', password: 'bob new pass', confirm: 'bob new pass' }))
      .status,
    303,
  );
  assert.equal((await new TestClient(harness).get('/lists')).status, 303);
  const aliceStill = new TestClient(harness);
  await aliceStill.get('/login');
  assert.equal((await aliceStill.post('/login', { username: 'alice', password: 'a new password' })).status, 303);
  assert.equal(
    (harness.db.prepare('SELECT avatar_seed FROM users WHERE id = ?').get(alice.id) as { avatar_seed: string }).avatar_seed,
    'alice',
  );
});
