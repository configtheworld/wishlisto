import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAvatar } from '../src/lib/avatar.js';
import {
  createGroup,
  createHarness,
  createItem,
  createList,
  createUser,
  groupInviteToken,
  login,
  pngFile,
} from './helpers.js';

test('avatars draw their artwork instead of rendering blank', () => {
  const svg = renderAvatar('alice', 96, 'initials');
  assert.ok((svg.match(/<(path|text|circle|rect)\b/g) ?? []).length >= 1);
});

test('sharing and link settings live on their own page, owner only', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const alice = await createUser(harness, 'alice', 'alice password');
  const bob = await createUser(harness, 'bob', 'bob password');
  const aliceClient = await login(harness, alice);
  const bobClient = await login(harness, bob);
  const listId = await createList(aliceClient, { name: 'Shelf' });

  const list = await aliceClient.page(`/lists/${listId}`);
  assert.doesNotMatch(list.html, /Create public link/);
  assert.match(list.html, new RegExp(`href="/lists/${listId}/share"`));
  assert.match(list.html, /Delete this list/);

  assert.equal((await aliceClient.get(`/lists/${listId}/share`)).status, 200);
  assert.equal((await bobClient.get(`/lists/${listId}/share`)).status, 404);
});

test('the home feed shows wishes from lists shared with my groups, not my own', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const alice = await createUser(harness, 'alice', 'alice password');
  const bob = await createUser(harness, 'bob', 'bob password');
  const carol = await createUser(harness, 'carol', 'carol password');
  const aliceClient = await login(harness, alice);
  const bobClient = await login(harness, bob);
  const carolClient = await login(harness, carol);

  const groupId = await createGroup(aliceClient, 'Family');
  await bobClient.post(`/join/${groupInviteToken(harness, groupId)}`, {});

  const listId = await createList(aliceClient, { name: 'Birthday' });
  await createItem(aliceClient, listId, { title: 'Cosy blanket', image: await pngFile() });
  await aliceClient.post(`/lists/${listId}/share`, { group_id: groupId });

  const privateList = await createList(aliceClient, { name: 'Secret' });
  await createItem(aliceClient, privateList, { title: 'Hidden gift' });

  const bobHome = await bobClient.page('/lists');
  assert.equal(bobHome.status, 200);
  assert.match(bobHome.html, /From your groups/);
  assert.match(bobHome.html, /Cosy blanket/);
  assert.match(bobHome.html, /from alice/);
  assert.doesNotMatch(bobHome.html, /Hidden gift/);

  // Carol is in no group, so her feed is empty and she never sees the list.
  const carolHome = await carolClient.page('/lists');
  assert.doesNotMatch(carolHome.html, /Cosy blanket/);
  assert.doesNotMatch(carolHome.html, /From your groups/);

  // Alice does not see her own wishes in her feed.
  const aliceHome = await aliceClient.page('/lists');
  assert.doesNotMatch(aliceHome.html, /From your groups/);
});

test('group pages preview each shared list with its owner and first wishes', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const alice = await createUser(harness, 'alice', 'alice password');
  const bob = await createUser(harness, 'bob', 'bob password');
  const aliceClient = await login(harness, alice);
  const bobClient = await login(harness, bob);

  const groupId = await createGroup(aliceClient, 'Friends');
  await bobClient.post(`/join/${groupInviteToken(harness, groupId)}`, {});
  const listId = await createList(aliceClient, { name: 'Summer wishes' });
  for (const title of ['One', 'Two', 'Three', 'Four', 'Five']) {
    await createItem(aliceClient, listId, { title: `Wish ${title}` });
  }
  await aliceClient.post(`/lists/${listId}/share`, { group_id: groupId });

  const page = await bobClient.page(`/groups/${groupId}`);
  assert.equal(page.status, 200);
  assert.match(page.html, /Summer wishes/);
  assert.match(page.html, /Shared by alice/);
  assert.match(page.html, /Wish One/);
  assert.match(page.html, /Wish Four/);
  assert.doesNotMatch(page.html, /Wish Five/, 'only four previews per list');
  assert.match(page.html, /Manage group/);
  assert.match(page.html, /Invite link|invite/i);
});
