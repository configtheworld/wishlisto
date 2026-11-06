import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAvatar } from '../src/lib/avatar.js';
import { createHarness, createUser, login, TestClient } from './helpers.js';

test('avatars are drawn server-side, sanitised, and differ per username', () => {
  const alice = renderAvatar('alice', 96);
  assert.match(alice, /^<svg/);
  assert.ok((alice.match(/<(path|rect|circle)\b/g) ?? []).length > 0);
  assert.doesNotMatch(alice, /<script|onload=|https?:\/\/(?!www\.w3\.org)/i);
  assert.equal(renderAvatar('alice', 96), alice, 'same username gives the same avatar');
  assert.notEqual(renderAvatar('bob', 96), alice);
});

test('the avatar route serves the identicon and settings has no style picker or credit block', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const user = await createUser(harness, 'alice', 'alice password');
  const client = await login(harness, user);

  const avatar = await new TestClient(harness).get('/avatar?seed=alice&size=64');
  assert.equal(avatar.status, 200);
  assert.match(avatar.headers.get('cache-control') ?? '', /immutable/);

  const settings = await client.page('/settings');
  assert.doesNotMatch(settings.html, /id="credits"|Identicon|DiceBear|CC0/);
});
