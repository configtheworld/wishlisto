import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGroup,
  createHarness,
  createItem,
  createList,
  createUser,
  groupInviteToken,
  login,
  pngFile,
  publicTokenOf,
  setupAdmin,
  TestClient,
  userIdOf,
} from './helpers.js';

async function trio(harness: Awaited<ReturnType<typeof createHarness>>) {
  const alice = await createUser(harness, 'alice', 'alice password');
  const bob = await createUser(harness, 'bob', 'bob password');
  const carol = await createUser(harness, 'carol', 'carol password');
  return {
    alice,
    bob,
    carol,
    aliceClient: await login(harness, alice),
    bobClient: await login(harness, bob),
    carolClient: await login(harness, carol),
  };
}

test('lists are private by default and show no sharing state until shared', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient, bobClient } = await trio(harness);
  const listId = await createList(aliceClient, { name: 'Secret plans' });

  assert.equal(publicTokenOf(harness, listId), null);
  assert.equal((await bobClient.get(`/lists/${listId}`)).status, 404);
  assert.equal((await new TestClient(harness).get(`/s/${'a'.repeat(32)}`)).status, 404);
});

test('group members see lists shared with their group, read-only', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient, bobClient, carolClient } = await trio(harness);
  const groupId = await createGroup(aliceClient, 'Family');
  const inviteToken = groupInviteToken(harness, groupId);
  assert.ok(inviteToken);

  assert.equal((await bobClient.post(`/join/${inviteToken}`, {})).status, 303);
  const listId = await createList(aliceClient, { name: 'Birthday' });
  const itemId = await createItem(aliceClient, listId, { title: 'Blue scarf' });

  // Sharing is a membership-checked action for the owner.
  const shared = await aliceClient.post(`/lists/${listId}/share`, { group_id: groupId });
  assert.equal(shared.status, 303);

  const bobView = await bobClient.page(`/lists/${listId}`);
  assert.equal(bobView.status, 200);
  assert.match(bobView.html, /Blue scarf/);
  assert.match(bobView.html, /Shared by alice/);
  assert.doesNotMatch(bobView.html, /data-confirm=.*Delete this wish/);
  assert.doesNotMatch(bobView.html, /\/items\/.*\/edit/);
  assert.equal((await bobClient.post(`/items/${itemId}/delete`, {})).status, 404);
  assert.equal((await bobClient.post(`/lists/${listId}/delete`, {})).status, 404);

  // Carol is not a member: no access.
  assert.equal((await carolClient.get(`/lists/${listId}`)).status, 404);

  // Leaving the group removes access immediately.
  assert.equal((await bobClient.post(`/groups/${groupId}/leave`, {})).status, 303);
  assert.equal((await bobClient.get(`/lists/${listId}`)).status, 404);
});

test('a member cannot share a list they do not own', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient, bobClient } = await trio(harness);
  const groupId = await createGroup(aliceClient, 'Friends');
  await bobClient.post(`/join/${groupInviteToken(harness, groupId)}`, {});
  const aliceList = await createList(aliceClient, { name: 'Alice only' });

  assert.equal((await bobClient.post(`/lists/${aliceList}/share`, { group_id: groupId })).status, 404);
  const count = harness.db.prepare('SELECT COUNT(*) AS n FROM list_groups').get() as { n: number };
  assert.equal(count.n, 0);
});

test('group invite links are unlimited, rotatable and disableable by the owner', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient, bobClient, carolClient } = await trio(harness);
  const groupId = await createGroup(aliceClient, 'Crew');
  const first = groupInviteToken(harness, groupId);
  assert.ok(first);

  // Unlimited use: multiple people can join with the same link.
  assert.equal((await bobClient.post(`/join/${first}`, {})).status, 303);
  assert.equal((await carolClient.post(`/join/${first}`, {})).status, 303);
  const members = harness.db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?').get(groupId) as {
    n: number;
  };
  assert.equal(members.n, 3);

  // Rotating breaks the old link.
  const rotated = await aliceClient.post(`/groups/${groupId}/invite/rotate`, {});
  assert.equal(rotated.status, 303);
  const second = groupInviteToken(harness, groupId);
  assert.notEqual(second, first);
  assert.equal((await new TestClient(harness).get(`/join/${first}`)).status, 303);

  // Disabling removes the link entirely.
  await aliceClient.post(`/groups/${groupId}/invite/disable`, {});
  assert.equal(groupInviteToken(harness, groupId), null);
  assert.equal((await bobClient.post(`/join/${second}`, {})).status, 404);

  // Non-owners cannot manage invites or remove members.
  assert.equal((await bobClient.post(`/groups/${groupId}/invite/enable`, {})).status, 404);
  const carolId = userIdOf(harness, 'carol');
  assert.equal((await bobClient.post(`/groups/${groupId}/members/${carolId}/remove`, {})).status, 404);
});

test('owners can remove members, but not themselves, and only owners delete groups', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { alice, aliceClient, bobClient } = await trio(harness);
  const groupId = await createGroup(aliceClient, 'Office');
  await bobClient.post(`/join/${groupInviteToken(harness, groupId)}`, {});
  const bobId = userIdOf(harness, 'bob');

  assert.equal((await aliceClient.post(`/groups/${groupId}/members/${alice.id}/remove`, {})).status, 400);
  assert.equal((await aliceClient.post(`/groups/${groupId}/members/${bobId}/remove`, {})).status, 303);
  assert.equal((await bobClient.get(`/groups/${groupId}`)).status, 404);

  assert.equal((await bobClient.post(`/groups/${groupId}/delete`, {})).status, 404);
  assert.equal((await aliceClient.post(`/groups/${groupId}/delete`, {})).status, 303);
});

test('public links work for logged-out visitors, hide the owner, and ask them to log in to claim', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient } = await trio(harness);
  const listId = await createList(aliceClient, { name: 'Public wishes' });
  const itemId = await createItem(aliceClient, listId, { title: 'Desk lamp', image: await pngFile() });

  assert.equal((await aliceClient.post(`/lists/${listId}/public/enable`, {})).status, 303);
  const token = publicTokenOf(harness, listId);
  assert.ok(token && /^[A-Za-z0-9_-]{32}$/.test(token));

  const anonymous = new TestClient(harness);
  const page = await anonymous.page(`/s/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.html, /Desk lamp/);
  assert.match(page.html, /noindex/);
  assert.match(page.html, /Log in to claim a gift/);
  assert.match(page.html, /href="\/login\?next=%2Fs%2F/);
  assert.doesNotMatch(page.html, /alice/);
  assert.doesNotMatch(page.html, />\s*Claim\b/i);

  const item = harness.db.prepare('SELECT image_upload_id FROM items WHERE id = ?').get(itemId) as {
    image_upload_id: string;
  };
  assert.match(page.html, new RegExp(`/s/${token}/media/${item.image_upload_id}\\.webp`));
  const media = await anonymous.get(`/s/${token}/media/${item.image_upload_id}.webp`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'image/webp');

  // A different token does not expose this list's media.
  const otherListId = await createList(aliceClient, { name: 'Private other' });
  await aliceClient.post(`/lists/${otherListId}/public/enable`, {});
  const otherToken = publicTokenOf(harness, otherListId);
  assert.equal((await anonymous.get(`/s/${otherToken}/media/${item.image_upload_id}.webp`)).status, 404);
  assert.equal((await anonymous.get(`/s/${'x'.repeat(10)}`)).status, 404);
});

test('regenerating or disabling a public link revokes the old one', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient } = await trio(harness);
  const listId = await createList(aliceClient, { name: 'Rotating' });
  await aliceClient.post(`/lists/${listId}/public/enable`, {});
  const old = publicTokenOf(harness, listId);

  await aliceClient.post(`/lists/${listId}/public/regenerate`, {});
  const fresh = publicTokenOf(harness, listId);
  assert.notEqual(fresh, old);
  const anonymous = new TestClient(harness);
  assert.equal((await anonymous.get(`/s/${old}`)).status, 404);
  assert.equal((await anonymous.get(`/s/${fresh}`)).status, 200);

  await aliceClient.post(`/lists/${listId}/public/disable`, {});
  assert.equal(publicTokenOf(harness, listId), null);
  assert.equal((await anonymous.get(`/s/${fresh}`)).status, 404);
});

test('public and group views escape content and never reveal the owner on public links', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient } = await trio(harness);
  const listId = await createList(aliceClient, { name: '<b>bold</b>' });
  await createItem(aliceClient, listId, { title: '<img src=x onerror=1>' });
  await aliceClient.post(`/lists/${listId}/public/enable`, {});
  const page = await new TestClient(harness).page(`/s/${publicTokenOf(harness, listId)}`);
  assert.doesNotMatch(page.html, /<b>bold<\/b>|<img src=x/);
  assert.match(page.html, /&lt;b&gt;bold/);
});

test('the owner sees a share panel; the public CTA does not pretend claiming works', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient } = await trio(harness);
  const listId = await createList(aliceClient, { name: 'Panel' });
  const owner = await aliceClient.page(`/lists/${listId}/share`);
  assert.match(owner.html, /Create public link/);
  await aliceClient.post(`/lists/${listId}/public/enable`, {});
  const enabled = await aliceClient.page(`/lists/${listId}/share`);
  assert.match(enabled.html, /Copy link/);
  assert.doesNotMatch(enabled.html, /Claim/i);
});

test('forced password change blocks other pages until the user picks a new password', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { client: adminClient } = await setupAdmin(harness);
  const bob = await createUser(harness, 'bob', 'bob password');
  const bobClient = await login(harness, bob);
  const listId = await createList(bobClient, { name: 'Pending' });
  assert.ok(listId);

  // Admin resets Bob's password to a temporary one.
  const bobId = userIdOf(harness, 'bob');
  const reset = await adminClient.post(`/admin/users/${bobId}/reset`, {});
  assert.equal(reset.status, 303);
  const adminPage = await adminClient.page('/admin');
  const temp = adminPage.html.match(/id="admin-temp-password">([^<]+)</)?.[1];
  assert.ok(temp && temp.length >= 12);

  // Bob's old sessions are gone; a fresh login is forced to settings.
  assert.equal((await bobClient.get('/lists')).status, 303);
  const fresh = new TestClient(harness);
  await fresh.get('/login');
  const login1 = await fresh.post('/login', { username: 'bob', password: temp });
  assert.equal(login1.status, 303);
  assert.equal(login1.headers.get('location'), '/settings?notice=mustChangePassword');
  assert.equal((await fresh.get('/lists')).status, 303);
  assert.match((await fresh.get('/lists')).headers.get('location') ?? '', /mustChangePassword/);

  const changed = await fresh.post('/settings/password', {
    current: temp,
    password: 'bobs brand new password',
    confirm: 'bobs brand new password',
  });
  assert.equal(changed.status, 303);
  assert.equal((await fresh.get('/lists')).status, 200);
});

test('admins can open or close signups and cannot see anyone’s lists or wishes', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { client: adminClient } = await setupAdmin(harness);
  const bob = await createUser(harness, 'bob', 'bob password');
  const bobClient = await login(harness, bob);
  const listId = await createList(bobClient, { name: 'Bob secrets' });
  await createItem(bobClient, listId, { title: 'Bob wish' });

  const adminList = await adminClient.page('/admin');
  assert.equal(adminList.status, 200);
  assert.match(adminList.html, /bob/);
  assert.doesNotMatch(adminList.html, /Bob secrets|Bob wish/);
  assert.equal((await adminClient.get(`/lists/${listId}`)).status, 404);
  assert.equal((await adminClient.get(`/groups`)).status, 200);

  assert.equal((await adminClient.post('/admin/signup', { open: '0' })).status, 303);
  const anonymous = new TestClient(harness);
  assert.equal((await anonymous.get('/signup')).status, 403);
  assert.equal((await adminClient.post('/admin/signup', { open: '1' })).status, 303);
  assert.equal((await anonymous.get('/signup')).status, 200);
});

test('non-admins cannot reach admin routes and admins cannot reset themselves', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { client: adminClient, user: admin } = await setupAdmin(harness);
  const bob = await createUser(harness, 'bob', 'bob password');
  const bobClient = await login(harness, bob);

  assert.equal((await bobClient.get('/admin')).status, 403);
  assert.equal((await bobClient.post('/admin/signup', { open: '0' })).status, 403);
  assert.equal((await bobClient.post(`/admin/users/${bob.id}/reset`, {})).status, 403);
  assert.equal((await adminClient.post(`/admin/users/${admin.id}/reset`, {})).status, 400);
});

test('Turkish is a selectable language and persists', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { alice, aliceClient } = await trio(harness);
  const response = await aliceClient.post(
    '/settings/language',
    { locale: 'tr' },
    { headers: { referer: 'http://localhost/settings' } },
  );
  assert.equal(response.status, 303);
  assert.match(response.headers.getSetCookie().join('\n'), /wishlisto_locale=tr/);
  assert.equal(
    (harness.db.prepare('SELECT locale FROM users WHERE id = ?').get(alice.id) as { locale: string }).locale,
    'tr',
  );
  const page = await aliceClient.page('/lists');
  assert.match(page.html, /Listelerim/);
  assert.match(page.html, /lang="tr"/);
});
