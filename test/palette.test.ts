import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadSiteConfig, SiteConfigError } from '../src/lib/site.js';
import { paletteCss, themeColor } from '../src/lib/palette.js';
import { createHarness, setupAdmin, TestClient } from './helpers.js';

async function siteFileWith(dir: string, name: string, colors: unknown): Promise<string> {
  const base = JSON.parse(await fs.readFile('site.json', 'utf8'));
  base.colors = colors;
  const file = path.join(dir, name);
  await fs.writeFile(file, JSON.stringify(base));
  return file;
}

test('colour tokens from site.json become CSS overrides, light and dark', () => {
  const css = paletteCss({ light: { accent: '#123456' }, dark: { accent: '#abcdef', background: '#000' } });
  assert.match(css, /:root \{\n  --accent: #123456;\n\}/);
  assert.match(css, /:root\[data-theme="dark"\] \{\n  --bg: #000;\n  --accent: #abcdef;\n\}/);
  assert.equal(paletteCss({}), '');
  assert.equal(themeColor({ dark: { background: '#101010' } }, 'dark'), '#101010');
  assert.equal(themeColor({}, 'light'), '#faf7fc');
});

test('invalid colours stop startup, so nothing unsafe reaches the stylesheet', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wishlisto-palette-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const bad of [
    { light: { accent: 'red' } },
    { light: { accent: '#12345' } },
    { light: { accent: 'url(https://evil.example/x)' } },
    { light: { accent: '#123456; background: url(x)' } },
    { light: { notAToken: '#123456' } },
  ]) {
    const file = await siteFileWith(dir, `bad-${Math.random()}.json`, bad);
    assert.throws(() => loadSiteConfig(file), SiteConfigError, JSON.stringify(bad));
  }
});

test('the palette stylesheet is served and the browser colour follows the config', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wishlisto-palette-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = await siteFileWith(dir, 'site.json', { light: { accent: '#0a0a0a', background: '#fefefe' } });
  const harness = await createHarness({ SITE_CONFIG: file });
  t.after(harness.close);
  await setupAdmin(harness);

  const client = new TestClient(harness);
  const css = await client.get('/theme-tokens.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') ?? '', /text\/css/);
  const body = await css.text();
  assert.match(body, /--accent: #0a0a0a;/);
  assert.doesNotMatch(body, /<|url\(|javascript/i);

  const page = await client.page('/login');
  assert.match(page.html, /href="\/theme-tokens.css"/);
  assert.match(page.html, /name="theme-color" content="#fefefe"/);
  assert.doesNotMatch(page.html, /<style/);
});
