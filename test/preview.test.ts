import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMetadata, fetchLinkMetadata, isPublicAddress } from '../src/lib/preview.js';
import { createHarness, createList, createUser, login } from './helpers.js';

test('only public addresses are allowed for link previews', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::7f00:1',
    'not-an-ip',
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress('93.184.216.34'), true);
  assert.equal(isPublicAddress('::ffff:93.184.216.34'), true);
  assert.equal(isPublicAddress('2606:2800:220:1:248:1893:25c8:1946'), true);
});

test('preview fetches refuse private targets, odd schemes and non-default ports without any network request', async () => {
  const refused = [
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://10.0.0.5/admin',
    'http://192.168.0.1:80/',
    'file:///etc/passwd',
    'ftp://example.com/file',
    'javascript:alert(1)',
    'https://user:secret@example.com/',
    'http://example.com:8080/',
    'not a url',
  ];
  for (const url of refused) {
    assert.equal(await fetchLinkMetadata(url), null, url);
  }
});

test('a hostname that resolves to a private address is refused even if it looks public', async () => {
  const internal = async () => [{ address: '10.0.0.7', family: 4 }];
  assert.equal(await fetchLinkMetadata('https://shop.example/item', internal), null);
  const mixed = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ];
  assert.equal(await fetchLinkMetadata('https://shop.example/item', mixed), null);
  const nothing = async () => [];
  assert.equal(await fetchLinkMetadata('https://shop.example/item', nothing), null);
});

test('metadata extraction reads SEO tags only and decodes entities', () => {
  const html = `<!doctype html><html><head>
    <title>Fallback title</title>
    <meta name="description" content="Plain description &amp; more">
    <meta property="og:title" content="Cosy &quot;blue&quot; scarf &#8211; 30% off">
    <meta property="og:description" content="Soft &lt;wool&gt;&#x21;">
    <script>var secret = "<meta name=description content=evil>";</script>
    </head><body><img src="/x.png"></body></html>`;
  const metadata = extractMetadata(html);
  assert.equal(metadata.title, 'Cosy "blue" scarf – 30% off');
  assert.equal(metadata.description, 'Soft <wool>!');
  assert.doesNotMatch(metadata.title + metadata.description, /evil|secret/);
});

test('metadata falls back to Twitter and <title>, and clamps length and control characters', () => {
  const fallback = extractMetadata('<head><title>  Plain\u0007  title  </title></head>');
  assert.equal(fallback.title, 'Plain title');
  assert.equal(fallback.description, '');

  const twitter = extractMetadata(
    `<meta name="twitter:title" content="Tw title"><meta name="twitter:description" content="Tw desc">`,
  );
  assert.equal(twitter.title, 'Tw title');
  assert.equal(twitter.description, 'Tw desc');

  const long = extractMetadata(`<meta property="og:title" content="${'a'.repeat(500)}">`);
  assert.equal(long.title.length, 120);
});

test('quick-add still renders the form when the preview target is blocked', async (t) => {
  const harness = await createHarness({ LINK_PREVIEW_ENABLED: 'true' });
  t.after(harness.close);
  const owner = await createUser(harness, 'alice', 'alice password');
  const client = await login(harness, owner);
  const listId = await createList(client, { name: 'Quick' });

  const page = await client.page(
    `/lists/${listId}/items/new?url=${encodeURIComponent('http://127.0.0.1:9/private')}`,
  );
  assert.equal(page.status, 200);
  assert.match(page.html, /value="http:\/\/127\.0\.0\.1:9\/private"/);
});
