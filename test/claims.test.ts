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
  publicTokenOf,
  TestClient,
} from './helpers.js';

async function setup(harness: Awaited<ReturnType<typeof createHarness>>) {
  const alice = await createUser(harness, 'alice', 'alice password');
  const bob = await createUser(harness, 'bob', 'bob password');
  const carol = await createUser(harness, 'carol', 'carol password');
  const aliceClient = await login(harness, alice);
  const bobClient = await login(harness, bob);
  const carolClient = await login(harness, carol);
  const groupId = await createGroup(aliceClient, 'Family');
  await bobClient.post(`/join/${groupInviteToken(harness, groupId)}`, {});
  await carolClient.post(`/join/${groupInviteToken(harness, groupId)}`, {});
  const listId = await createList(aliceClient, { name: 'Gifts' });
  await aliceClient.post(`/lists/${listId}/share`, { group_id: groupId });
  const itemId = await createItem(aliceClient, listId, { title: 'Desk lamp' });
  return { alice, bob, aliceClient, bobClient, carolClient, groupId, listId, itemId };
}

test('a surprise claim is hidden from the owner and shows only as taken to others', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient, bobClient, carolClient, listId, itemId } = await setup(harness);

  const claimed = await bobClient.post(`/items/${itemId}/claim`, { visibility: '0' });
  assert.equal(claimed.status, 303);
  assert.equal(claimed.headers.get('location'), `/lists/${listId}?notice=claimSaved#item-${itemId}`);

  const ownerView = await aliceClient.page(`/lists/${listId}`);
  assert.equal(ownerView.status, 200);
  assert.doesNotMatch(ownerView.html, /bob/i);
  assert.doesNotMatch(ownerView.html, /Claimed by/);

  const carolView = await carolClient.page(`/lists/${listId}`);
  assert.match(carolView.html, /Claimed/);
  assert.doesNotMatch(carolView.html, /bob/i);

  const bobView = await bobClient.page(`/lists/${listId}`);
  assert.match(bobView.html, /You claimed this/);
  assert.match(bobView.html, /Keep it a surprise/);
});

test('status-only claims tell the owner it is claimed, but never by whom', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient, bobClient, carolClient, listId, itemId } = await setup(harness);

  await bobClient.post(`/items/${itemId}/claim`, { visibility: '1' });

  const ownerView = await aliceClient.page(`/lists/${listId}`);
  assert.match(ownerView.html, /Claimed/);
  assert.doesNotMatch(ownerView.html, /Claimed by/);
  assert.doesNotMatch(ownerView.html, /bob/i);

  const carolView = await carolClient.page(`/lists/${listId}`);
  assert.doesNotMatch(carolView.html, /bob/i);

  const bobView = await bobClient.page(`/lists/${listId}`);
  assert.match(bobView.html, /The owner sees that it&#39;s claimed|owner sees that it's claimed/);

  assert.equal((await bobClient.post(`/items/${itemId}/claim`, { visibility: '7' })).status, 400);
});

test('a visible claim lets the owner see who claimed, while others still do not', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient, bobClient, carolClient, listId, itemId } = await setup(harness);

  await bobClient.post(`/items/${itemId}/claim`, { visibility: '2' });

  const ownerView = await aliceClient.page(`/lists/${listId}`);
  assert.match(ownerView.html, /Claimed by bob/);

  const carolView = await carolClient.page(`/lists/${listId}`);
  assert.doesNotMatch(carolView.html, /bob/i);
  assert.match(carolView.html, /Claimed/);
});

test('the claimer can change visibility and unclaim; nobody else can release the claim', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient, bobClient, carolClient, listId, itemId } = await setup(harness);

  await bobClient.post(`/items/${itemId}/claim`, { visibility: '0' });
  await bobClient.post(`/items/${itemId}/claim`, { visibility: '2' });
  let row = harness.db.prepare('SELECT visibility FROM claims WHERE item_id = ?').get(itemId) as {
    visibility: number;
  };
  assert.equal(row.visibility, 2);
  assert.match((await aliceClient.page(`/lists/${listId}`)).html, /Claimed by bob/);

  // Carol cannot unclaim Bob's claim, and cannot take it over.
  await carolClient.post(`/items/${itemId}/unclaim`, {});
  const taken = await carolClient.post(`/items/${itemId}/claim`, { visibility: '2' });
  assert.equal(taken.headers.get('location'), `/lists/${listId}?notice=claimTaken#item-${itemId}`);
  assert.ok(harness.db.prepare('SELECT 1 AS ok FROM claims WHERE item_id = ?').get(itemId));

  const released = await bobClient.post(`/items/${itemId}/unclaim`, {});
  assert.equal(released.headers.get('location'), `/lists/${listId}?notice=claimRemoved#item-${itemId}`);
  assert.equal(harness.db.prepare('SELECT 1 AS ok FROM claims WHERE item_id = ?').get(itemId), undefined);
  assert.doesNotMatch((await aliceClient.page(`/lists/${listId}`)).html, /Claimed by/);
});

test('owners cannot claim their own wishes, and non-members cannot claim at all', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient, itemId } = await setup(harness);
  const outsider = await createUser(harness, 'dave', 'dave password');
  const daveClient = await login(harness, outsider);

  assert.equal((await aliceClient.post(`/items/${itemId}/claim`, { visibility: '2' })).status, 403);
  assert.equal((await daveClient.post(`/items/${itemId}/claim`, { visibility: '0' })).status, 404);
  const count = harness.db.prepare('SELECT COUNT(*) AS n FROM claims').get() as { n: number };
  assert.equal(count.n, 0);
  const anonymous = new TestClient(harness);
  await anonymous.get('/');
  assert.equal((await anonymous.post(`/items/${itemId}/claim`, { visibility: '0' })).status, 303);
});

test('archived wishes cannot be claimed', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient, bobClient, itemId } = await setup(harness);
  await aliceClient.post(`/items/${itemId}/archive`, {});
  assert.equal((await bobClient.post(`/items/${itemId}/claim`, { visibility: '0' })).status, 400);
});

test('public links ask visitors to log in, and logged-in visitors can claim with their own choice', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { aliceClient, listId, itemId } = await setup(harness);
  await aliceClient.post(`/lists/${listId}/public/enable`, {});
  const token = publicTokenOf(harness, listId) as string;

  const anonymous = new TestClient(harness);
  await anonymous.get(`/s/${token}`);
  const anonymousClaim = await anonymous.post(`/s/${token}/items/${itemId}/claim`, { visibility: '0' });
  assert.equal(anonymousClaim.status, 303);
  assert.match(anonymousClaim.headers.get('location') ?? '', /^\/login/);

  const eve = await createUser(harness, 'eve', 'eve password');
  const eveClient = await login(harness, eve);
  const claimed = await eveClient.post(`/s/${token}/items/${itemId}/claim`, { visibility: '2' });
  assert.equal(claimed.headers.get('location'), `/s/${token}?notice=claimSaved#item-${itemId}`);

  const ownerView = await aliceClient.page(`/lists/${listId}`);
  assert.match(ownerView.html, /Claimed by eve/);
  const publicView = await anonymous.page(`/s/${token}`);
  assert.doesNotMatch(publicView.html, /eve/i);
  assert.match(publicView.html, /Claimed/);

  // A claim submitted with a token that is not this list's token is refused.
  assert.equal((await eveClient.post(`/s/${'x'.repeat(32)}/items/${itemId}/unclaim`, {})).status, 404);
});

test('deleting a wish removes its claim', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { bob, bobClient, aliceClient, itemId } = await setup(harness);
  await bobClient.post(`/items/${itemId}/claim`, { visibility: '0' });
  assert.ok(harness.db.prepare('SELECT 1 AS ok FROM claims WHERE claimer_id = ?').get(bob.id));

  await aliceClient.post(`/items/${itemId}/delete`, {});
  const remaining = harness.db.prepare('SELECT COUNT(*) AS n FROM claims').get() as { n: number };
  assert.equal(remaining.n, 0);
});

test('deleting a claimer account removes their claims', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { bob, bobClient, itemId } = await setup(harness);
  await bobClient.post(`/items/${itemId}/claim`, { visibility: '0' });
  await bobClient.post('/settings/delete', { confirmUsername: 'bob', password: 'bob password' });
  assert.equal(harness.db.prepare('SELECT 1 AS ok FROM claims WHERE claimer_id = ?').get(bob.id), undefined);
});
