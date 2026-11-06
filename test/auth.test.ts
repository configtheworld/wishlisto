import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, createUser, login, setupAdmin, TestClient } from './helpers.js';
import { hashSessionToken, SESSION_COOKIE } from '../src/lib/session.js';
import { ensureEnvAdmin } from '../src/lib/bootstrap.js';
import { ConfigError } from '../src/config.js';
import { createLogger } from '../src/lib/logger.js';
import { verifyPassword } from '../src/lib/password.js';
import { getSetting, openSignupEnabled } from '../src/db/index.js';

test('first-run setup creates exactly one admin and shows a one-time recovery code', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);

  const anonymous = new TestClient(harness);
  const home = await anonymous.get('/');
  assert.equal(home.status, 303);
  assert.equal(home.headers.get('location'), '/setup');

  const setupPage = await anonymous.page('/setup');
  assert.equal(setupPage.status, 200);
  assert.match(setupPage.html, /name="csrf-token"/);
  assert.match(setupPage.html, /type="password"/);

  // A POST without a CSRF token is rejected before it can create the account.
  const noCsrf = await anonymous.post('/setup', {
    username: 'admin',
    password: 'correct horse battery',
    confirm: 'correct horse battery',
  }, { csrf: null });
  assert.equal(noCsrf.status, 403);
  assert.equal((harness.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, 0);

  // Passwords are length-only, but the length policy is enforced.
  const shortPassword = await anonymous.post('/setup', {
    username: 'admin',
    password: 'short',
    confirm: 'short',
  });
  assert.equal(shortPassword.status, 400);

  const wrongConfirmation = await anonymous.post('/setup', {
    username: 'admin',
    password: 'correct horse battery',
    confirm: 'different password',
  });
  assert.equal(wrongConfirmation.status, 400);

  const response = await anonymous.post('/setup', {
    username: 'Admin',
    password: 'correct horse battery',
    confirm: 'correct horse battery',
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/welcome/recovery?from=setup');
  const setCookie = response.headers.getSetCookie().join('\n');
  assert.match(setCookie, /wishlisto_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\//i);
  assert.match(setCookie, /Max-Age=/i);

  const admin = harness.db.prepare('SELECT * FROM users').get() as {
    id: string;
    username: string;
    username_ci: string;
    is_admin: number;
    recovery_hash: string | null;
  };
  assert.equal(admin.username, 'Admin');
  assert.equal(admin.username_ci, 'admin');
  assert.equal(admin.is_admin, 1);
  assert.ok(admin.recovery_hash);
  assert.notEqual(admin.recovery_hash, 'correct horse battery');

  // The database itself enforces exactly one admin.
  assert.throws(() => {
    harness.db
      .prepare(
        `INSERT INTO users (id, username, username_ci, username_skel, password_hash, avatar_seed, is_admin, created_at, updated_at)
         VALUES ('second-admin', 'other', 'other', 'other', 'x', 'x', 1, 0, 0)`,
      )
      .run();
  }, /UNIQUE constraint failed/);

  const recoveryPage = await anonymous.page('/welcome/recovery?from=setup');
  assert.equal(recoveryPage.status, 200);
  const codeMatch = recoveryPage.html.match(/[0-9A-Z]{5}(?:-[0-9A-Z]{5}){3}/);
  assert.ok(codeMatch, 'recovery code must be displayed once');
  assert.match(recoveryPage.html, /class="recovery-code/);
  assert.doesNotMatch(recoveryPage.html, /<script(?![^>]*src=)/i);

  const ack = await anonymous.post('/welcome/recovery/ack', { from: 'setup' });
  assert.equal(ack.status, 303);
  assert.equal(ack.headers.get('location'), '/lists?notice=setupDone');

  // The plaintext code is gone from the session flash after acknowledgement.
  const again = await anonymous.get('/welcome/recovery?from=setup');
  assert.equal(again.status, 303);
  assert.equal(again.headers.get('location'), '/lists');

  // Setup is closed forever once a user exists.
  const setupAgain = await anonymous.get('/setup');
  assert.equal(setupAgain.status, 303);
  assert.equal(setupAgain.headers.get('location'), '/');
  const setupPost = await anonymous.post('/setup', {
    username: 'intruder',
    password: 'correct horse battery',
    confirm: 'correct horse battery',
  });
  assert.equal(setupPost.status, 403);
  assert.equal((harness.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, 1);
});

test('login, session cookie and logout behave correctly', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { client: admin } = await setupAdmin(harness);

  const logout = await admin.post('/logout');
  assert.equal(logout.status, 303);
  assert.equal(logout.headers.get('location'), '/?notice=loggedOut');
  assert.equal((harness.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n, 0);

  const protectedPage = await admin.get('/lists');
  assert.equal(protectedPage.status, 303);
  assert.equal(protectedPage.headers.get('location'), '/login?next=%2Flists');

  const wrong = await admin.post('/login', { username: 'admin', password: 'wrong password' });
  assert.equal(wrong.status, 401);
  assert.match(await wrong.text(), /Wrong username or password|auth\.invalidCredentials/i);

  const ok = await admin.post('/login', { username: 'ADMIN', password: 'correct horse battery' });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/lists');
  const token = admin.cookie(SESSION_COOKIE);
  assert.ok(token);
  const stored = harness.db.prepare('SELECT * FROM sessions WHERE id = ?').get(hashSessionToken(token as string)) as
    | { id: string; csrf_token: string }
    | undefined;
  assert.ok(stored, 'session must be stored hashed, not as the raw cookie');
  assert.notEqual(stored?.id, token);

  const lists = await admin.page('/lists');
  assert.equal(lists.status, 200);
  assert.match(lists.html, /Wishlist/);
  assert.match(lists.html, /name="csrf-token"/);
});

test('signup enforces username uniqueness, confusables and password length', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  await setupAdmin(harness);

  const client = new TestClient(harness);
  await client.get('/signup');

  const short = await client.post('/signup', {
    username: 'ab',
    password: 'correct horse battery',
    confirm: 'correct horse battery',
  });
  assert.equal(short.status, 400);

  const shortPassword = await client.post('/signup', {
    username: 'friend',
    password: '1234567',
    confirm: '1234567',
  });
  assert.equal(shortPassword.status, 400);

  const longPassword = await client.post('/signup', {
    username: 'friend',
    password: 'x'.repeat(129),
    confirm: 'x'.repeat(129),
  });
  assert.equal(longPassword.status, 400);

  const created = await client.post('/signup', {
    username: 'friend',
    password: 'correct horse battery',
    confirm: 'correct horse battery',
  });
  assert.equal(created.status, 303);
  assert.equal(created.headers.get('location'), '/welcome/recovery');
  const friend = harness.db.prepare('SELECT * FROM users WHERE username_ci = ?').get('friend') as {
    id: string;
    is_admin: number;
    recovery_hash: string;
  };
  assert.equal(friend.is_admin, 0);
  assert.ok(friend.recovery_hash);

  // Case-insensitive collision.
  const second = new TestClient(harness);
  await second.get('/signup');
  const caseClash = await second.post('/signup', {
    username: 'Admin',
    password: 'correct horse battery',
    confirm: 'correct horse battery',
  });
  assert.equal(caseClash.status, 409);
  assert.match(await caseClash.text(), /already|taken|vergeben/i);

  // Cyrillic "а" vs Latin "a" collision.
  const third = new TestClient(harness);
  await third.get('/signup');
  const confusableClash = await third.post('/signup', {
    username: 'аdmin',
    password: 'correct horse battery',
    confirm: 'correct horse battery',
  });
  assert.equal(confusableClash.status, 409);

  // Signup can be closed by an administrator and is enforced on GET and POST.
  harness.db.prepare("UPDATE settings SET value = 'false' WHERE key = 'open_signup'").run();
  assert.equal(openSignupEnabled(harness.db), false);
  const closedPage = await third.get('/signup');
  assert.equal(closedPage.status, 403);
  const closedPost = await third.post('/signup', {
    username: 'newfriend',
    password: 'correct horse battery',
    confirm: 'correct horse battery',
  });
  assert.equal(closedPost.status, 403);
  assert.equal(getSetting(harness.db, 'open_signup'), 'false');
});

test('CSRF protection rejects missing, wrong and cross-site tokens', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { client } = await setupAdmin(harness);
  await client.get('/lists');

  const missing = await client.post('/lists', { name: 'No token', emoji: '', color: '0', note: '' }, { csrf: null });
  assert.equal(missing.status, 403);
  assert.match(await missing.text(), /csrf|form.*expired|Sicherheits/i);

  const wrong = await client.post('/lists', { name: 'Wrong token', emoji: '', color: '0', note: '' }, { csrf: 'not-the-token' });
  assert.equal(wrong.status, 403);

  const crossOrigin = await client.post(
    '/lists',
    { name: 'Cross origin', emoji: '', color: '0', note: '' },
    { headers: { origin: 'https://evil.example' } },
  );
  assert.equal(crossOrigin.status, 403);

  const crossSite = await client.post(
    '/lists',
    { name: 'Cross site', emoji: '', color: '0', note: '' },
    { headers: { 'sec-fetch-site': 'cross-site' } },
  );
  assert.equal(crossSite.status, 403);

  const sameOrigin = await client.post(
    '/lists',
    { name: 'Allowed', emoji: '', color: '0', note: '' },
    { headers: { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' } },
  );
  assert.equal(sameOrigin.status, 303);

  const header = await client.post(
    '/lists',
    { name: 'Header token', emoji: '', color: '0', note: '' },
    { csrf: null, headers: { 'x-csrf-token': client.csrfToken() } },
  );
  assert.equal(header.status, 303);

  // GET requests do not require CSRF.
  const get = await client.get('/lists');
  assert.equal(get.status, 200);
});

test('recovery code resets the password once and invalidates sessions', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const { client: admin, recoveryCode } = await setupAdmin(harness);
  assert.ok(recoveryCode);

  await admin.post('/logout');
  const otherSession = await login(harness, { id: '', username: 'admin', password: 'correct horse battery' });
  assert.equal((harness.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n, 1);

  const recovery = new TestClient(harness);
  await recovery.get('/recover');

  const wrong = await recovery.post('/recover', {
    username: 'admin',
    code: 'AAAAA-AAAAA-AAAAA-AAAAA',
    password: 'new correct horse',
    confirm: 'new correct horse',
  });
  assert.equal(wrong.status, 400);

  const reset = await recovery.post('/recover', {
    username: 'admin',
    code: recoveryCode,
    password: 'new correct horse',
    confirm: 'new correct horse',
  });
  assert.equal(reset.status, 303);
  assert.equal(reset.headers.get('location'), '/login?notice=recoveryUsed');

  const row = harness.db.prepare('SELECT recovery_hash FROM users WHERE username_ci = ?').get('admin') as {
    recovery_hash: string | null;
  };
  assert.equal(row.recovery_hash, null);
  assert.equal((harness.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n, 0);

  // The old session no longer works, the old password no longer works, the new one does.
  const stale = await otherSession.get('/lists');
  assert.equal(stale.status, 303);
  const oldLogin = await otherSession.post('/login', { username: 'admin', password: 'correct horse battery' });
  assert.equal(oldLogin.status, 401);
  const newLogin = await otherSession.post('/login', { username: 'admin', password: 'new correct horse' });
  assert.equal(newLogin.status, 303);

  // The recovery code cannot be replayed.
  const replayClient = new TestClient(harness);
  await replayClient.get('/recover');
  const replay = await replayClient.post('/recover', {
    username: 'admin',
    code: recoveryCode,
    password: 'another password',
    confirm: 'another password',
  });
  assert.equal(replay.status, 400);
});

test('repeated failed logins are rate limited per user and IP', async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  await createUser(harness, 'admin', 'correct horse battery');
  const client = new TestClient(harness);
  await client.get('/login');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await client.post('/login', { username: 'admin', password: 'wrong password' });
    assert.equal(response.status, 401, `attempt ${attempt + 1}`);
  }
  const blocked = await client.post('/login', { username: 'admin', password: 'wrong password' });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);

  // Even the correct password is blocked while the bucket is in cooldown.
  const stillBlocked = await client.post('/login', { username: 'admin', password: 'correct horse battery' });
  assert.equal(stillBlocked.status, 429);

  // A different username from the same IP is blocked by the IP bucket (20/15 min).
  for (let attempt = 0; attempt < 16; attempt += 1) {
    await client.post('/login', { username: `nobody${attempt}`, password: 'wrong password' });
  }
  const ipBlocked = await client.post('/login', { username: 'someone-else', password: 'wrong password' });
  assert.equal(ipBlocked.status, 429);
});

test('ADMIN_USERNAME bootstrap is one-shot, never overwrites users, and validates input', async (t) => {
  const harness = await createHarness({
    ADMIN_USERNAME: 'bootstrap-admin',
    ADMIN_PASSWORD: 'bootstrap password',
  });
  t.after(harness.close);
  const logger = createLogger('error');

  await ensureEnvAdmin(harness.db, harness.config, logger);
  const first = harness.db.prepare('SELECT * FROM users').get() as {
    id: string;
    password_hash: string;
    is_admin: number;
  };
  assert.equal(first.is_admin, 1);
  assert.equal(await verifyPassword(first.password_hash, 'bootstrap password'), true);

  // A later boot with different env credentials must not touch the existing admin.
  const changed = await createHarness({
    ADMIN_USERNAME: 'different-admin',
    ADMIN_PASSWORD: 'different password',
  });
  t.after(changed.close);
  await ensureEnvAdmin(changed.db, changed.config, logger);
  await ensureEnvAdmin(harness.db, { ...harness.config, adminUsername: 'other', adminPassword: 'other password' }, logger);
  const after = harness.db.prepare('SELECT * FROM users').all() as Array<{ id: string; username_ci: string }>;
  assert.equal(after.length, 1);
  assert.equal(after[0]?.username_ci, 'bootstrap-admin');

  const invalid = await createHarness({ ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'bootstrap password' });
  t.after(invalid.close);
  await assert.rejects(ensureEnvAdmin(invalid.db, invalid.config, logger), ConfigError);
});
