import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadSiteConfig, SiteConfigError } from '../src/lib/site.js';
import { createHarness, createList, createUser, login, setupAdmin, TestClient } from './helpers.js';

test('site.json sets the app name and landing copy, and invalid files stop startup', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wishlisto-site-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const good = JSON.parse(await fs.readFile('site.json', 'utf8'));
  good.appName = 'Giftbox';
  good.landing.title.en = 'Custom landing headline';
  const goodPath = path.join(dir, 'site.json');
  await fs.writeFile(goodPath, JSON.stringify(good));

  const harness = await createHarness({ SITE_CONFIG: goodPath });
  t.after(harness.close);
  await setupAdmin(harness);
  const landing = await new TestClient(harness).page('/');
  assert.equal(landing.status, 200);
  assert.match(landing.html, /Giftbox/);
  assert.match(landing.html, /Custom landing headline/);
  assert.match(landing.html, /Private by default/);

  const bad = JSON.parse(JSON.stringify(good));
  delete bad.landing.title.en;
  const badPath = path.join(dir, 'bad.json');
  await fs.writeFile(badPath, JSON.stringify(bad));
  assert.throws(() => loadSiteConfig(badPath), SiteConfigError);
  assert.throws(() => loadSiteConfig(path.join(dir, 'missing.json')), SiteConfigError);
});

test('the campaign bar is admin-controlled and only shows on home pages', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const admin = await createUser(harness, 'admin', 'admin password', true);
  const member = await createUser(harness, 'member', 'member password');
  const adminClient = await login(harness, admin);
  const memberClient = await login(harness, member);
  await createList(memberClient, { name: 'Lists' });

  assert.equal((await memberClient.post('/admin/campaign', { enabled: '1', text: 'Hi' })).status, 403);
  assert.equal((await adminClient.post('/admin/campaign', { enabled: '1', text: '   ' })).status, 400);
  assert.equal((await adminClient.post('/admin/campaign', { enabled: '1', text: 'x'.repeat(201) })).status, 400);

  const saved = await adminClient.post('/admin/campaign', { enabled: '1', text: 'Only 4 days left to Christmas!' });
  assert.equal(saved.status, 303);
  assert.match(saved.headers.get('location') ?? '', /campaignSaved/);

  assert.match((await memberClient.page('/lists')).html, /Only 4 days left to Christmas!/);
  assert.doesNotMatch((await memberClient.page('/groups')).html, /Only 4 days left/);

  await adminClient.post('/admin/campaign', { text: 'Only 4 days left to Christmas!' });
  assert.doesNotMatch((await memberClient.page('/lists')).html, /Only 4 days left/);
  assert.match((await adminClient.page('/admin')).html, /id="campaign-text"/);
});

test('the account menu holds theme and language, and settings no longer repeats the language picker', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const member = await createUser(harness, 'member', 'member password');
  const memberClient = await login(harness, member);

  const anonymous = await new TestClient(harness).page('/');
  assert.match(anonymous.html, /class="menu-panel header-menu-panel"/);
  assert.match(anonymous.html, /data-theme-toggle/);
  assert.match(anonymous.html, /id="header-locale"/);

  const home = await memberClient.page('/lists');
  assert.match(home.html, /href="\/settings"/);
  assert.doesNotMatch(home.html, /<footer/);

  const settings = await memberClient.page('/settings');
  assert.doesNotMatch(settings.html, /id="language"/);
});

test('item forms offer "Fill from link" only when adding a wish', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const member = await createUser(harness, 'member', 'member password');
  const client = await login(harness, member);
  const listId = await createList(client, { name: 'Form' });

  const add = await client.page(`/lists/${listId}/items/new`);
  assert.match(add.html, /Fill from link/);
  assert.match(add.html, new RegExp(`formaction="/lists/${listId}/items/new"`));
});
