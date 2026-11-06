import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, createUser, login, setupAdmin, TestClient } from './helpers.js';
import { setSetting } from '../src/db/index.js';

test('security headers and strict CSP are applied to every HTML response', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);

  for (const pathName of ['/', '/login', '/setup', '/healthz']) {
    const response = await new TestClient(harness).get(pathName);
    const csp = response.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /style-src 'self'/);
    assert.match(csp, /img-src 'self' data:/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.match(csp, /form-action 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'same-origin');
    assert.match(response.headers.get('permissions-policy') ?? '', /camera=\(\)/);
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(response.headers.get('strict-transport-security'), null);
  }

  // HSTS only when cookies are marked secure.
  const secureHarness = await createHarness({ COOKIE_SECURE: 'true' });
  t.after(secureHarness.close);
  const secure = await new TestClient(secureHarness).get('/healthz');
  assert.match(secure.headers.get('strict-transport-security') ?? '', /max-age=31536000/);
});

test('health check works without auth and reports no-cache', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const response = await new TestClient(harness).get('/healthz');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { status: 'ok', version: '0.1.0' });
});

test('static assets are same-origin and served with sane caching', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  for (const [asset, typePattern] of [
    ['/app.css', /text\/css/],
    ['/app.js', /javascript/],
    ['/theme.js', /javascript/],
    ['/favicon.svg', /image\/svg\+xml/],
  ] as const) {
    const response = await new TestClient(harness).get(asset);
    assert.equal(response.status, 200, asset);
    assert.match(response.headers.get('content-type') ?? '', typePattern, asset);
    assert.match(response.headers.get('cache-control') ?? '', /max-age=300/, asset);
    assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'none'/, asset);
  }
  // No directory traversal out of the public folder.
  const traversal = await new TestClient(harness).get('/..%2Fpackage.json');
  assert.notEqual(traversal.status, 200);
});

test('avatars are rendered locally, allowlisted and sandboxed', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const client = new TestClient(harness);

  const response = await client.get('/avatar?seed=test-seed&size=64');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /image\/svg\+xml/);
  assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'none'.*sandbox/);
  assert.match(response.headers.get('cache-control') ?? '', /immutable/);
  const svg = await response.text();
  assert.match(svg, /^<svg/);
  assert.match(svg, /width="64"/);
  assert.doesNotMatch(svg, /<script|onload=|javascript:/i);
  assert.doesNotMatch(svg, /https?:\/\/(?!www\.w3\.org)/, 'avatars must not reference external resources');

  assert.equal((await client.get('/avatar?seed=%3Cscript%3E')).status, 400);
  assert.equal((await client.get('/avatar?seed=')).status, 400);

  // Unknown sizes fall back to 96 rather than being reflected.
  const fallback = await client.get('/avatar?seed=test&size=9999');
  assert.match(await fallback.text(), /width="96"/);

  // The SVG endpoint cannot be used as a script or document surface.
  assert.match(response.headers.get('content-disposition') ?? '', /inline/);
});

test('open signup defaults on and can be disabled', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  await setupAdmin(harness);
  const client = new TestClient(harness);

  const openPage = await client.get('/signup');
  assert.equal(openPage.status, 200);

  setSetting(harness.db, 'open_signup', 'false');
  const closedPage = await client.get('/signup');
  assert.equal(closedPage.status, 403);
  const closedPost = await client.post('/signup', {
    username: 'sneaky',
    password: 'correct horse battery',
    confirm: 'correct horse battery',
  });
  assert.equal(closedPost.status, 403);
  assert.equal((harness.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, 1);

  setSetting(harness.db, 'open_signup', 'true');
  const reopened = await client.get('/signup');
  assert.equal(reopened.status, 200);
});

test('unexpected errors return a generic 500 page without internals', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const user = await createUser(harness, 'errorella', 'error password');
  const client = await login(harness, user);

  harness.db.exec('DROP TABLE lists');
  const response = await client.get('/lists');
  assert.equal(response.status, 500);
  const html = await response.text();
  assert.match(html, /Something went wrong|schiefgelaufen/i);
  assert.doesNotMatch(html, /SQLITE|no such table|stack|at .*src\//i);
});

test('oversized request bodies are rejected with 413', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const client = new TestClient(harness);
  await client.get('/');
  const response = await client.request('/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `username=${'a'.repeat(2_200_000)}`,
  });
  assert.equal(response.status, 413);
});

test('session cookies are Secure and SameSite when HTTPS is configured', async (t) => {
  const harness = await createHarness({ COOKIE_SECURE: 'true', BASE_URL: 'https://wishes.example' });
  t.after(harness.close);
  await createUser(harness, 'secure-user', 'secure password');
  const client = new TestClient(harness);
  await client.get('/login');
  const response = await client.post('/login', { username: 'secure-user', password: 'secure password' });
  assert.equal(response.status, 303);
  const cookies = response.headers.getSetCookie().join('\n');
  assert.match(cookies, /wishlisto_session=/);
  assert.match(cookies, /Secure/i);
  assert.match(cookies, /HttpOnly/i);
  assert.match(cookies, /SameSite=Lax/i);
});
