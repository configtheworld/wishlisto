import test from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_STYLE_IDS, avatarStyleInfo, renderAvatar } from '../src/lib/avatar.js';
import { loadConfig } from '../src/config.js';
import { createHarness, createUser, login, TestClient } from './helpers.js';

test('every selectable avatar style declares its artist, licence and source', () => {
  for (const id of AVATAR_STYLE_IDS) {
    const info = avatarStyleInfo(id);
    assert.ok(info.title, id);
    assert.ok(info.creator, id);
    assert.notEqual(info.license, 'See DiceBear', `${id} has no declared licence`);
    assert.match(info.licenseUrl, /^https:\/\//, id);
    assert.match(info.source, /^https:\/\//, id);
  }
});

test('every selectable style renders a non-empty, sanitised SVG', () => {
  for (const id of AVATAR_STYLE_IDS) {
    const svg = renderAvatar('alice', 96, id);
    assert.match(svg, /^<svg/, id);
    assert.ok((svg.match(/<(path|circle|rect|text|ellipse)\b/g) ?? []).length > 0, `${id} drew nothing`);
    assert.doesNotMatch(svg, /<script|onload=|https?:\/\/(?!www\.w3\.org)/i, id);
  }
});

test('AVATAR_STYLE picks the style, defaults to Initials, and rejects unknown values', () => {
  assert.equal(loadConfig({}).avatarStyle, 'initials');
  assert.equal(loadConfig({ AVATAR_STYLE: 'thumbs' }).avatarStyle, 'thumbs');
  assert.throws(() => loadConfig({ AVATAR_STYLE: 'not-a-style' }));
  assert.throws(() => loadConfig({ AVATAR_STYLE: '<svg>' }));
});

test('the chosen style is served and credited on the settings page', async (t) => {
  const harness = await createHarness({ AVATAR_STYLE: 'adventurer' });
  t.after(harness.close);
  const user = await createUser(harness, 'alice', 'alice password');
  const client = await login(harness, user);

  const avatar = await new TestClient(harness).get('/avatar?seed=alice&size=64');
  assert.equal(avatar.status, 200);

  const settings = await client.page('/settings');
  assert.match(settings.html, /Adventurer/);
  assert.match(settings.html, /Lisa Wischofsky/);
  assert.match(settings.html, /CC BY 4\.0/);
  assert.match(settings.html, /figma\.com/);
  assert.match(settings.html, /creativecommons\.org\/licenses\/by\/4\.0/);
  assert.match(settings.html, /licensed under CC BY 4\.0/);
});
