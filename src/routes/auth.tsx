import fs from 'node:fs/promises';
import path from 'node:path';
import type { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import {
  loginInputSchema,
  recoverInputSchema,
  signupInputSchema,
  zodErrorKeys,
} from '../lib/validation.js';
import { formString } from '../lib/forms.js';
import { clientIp } from '../lib/request.js';
import {
  checkBuckets,
  checkWindow,
  clearRateEvents,
  recordRateEvent,
} from '../lib/ratelimit.js';
import {
  dummyPasswordHash,
  hashPassword,
  meetsPasswordPolicy,
  verifyPassword,
} from '../lib/password.js';
import {
  formatRecoveryCode,
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyRecoveryCode,
} from '../lib/recovery.js';
import { normalizeUsernameKey, validateUsername, isValidAvatarSeed } from '../lib/username.js';
import { parseAvatarSize, renderAvatar } from '../lib/avatar.js';
import {
  clearSessionCookie,
  createSession,
  destroyAllSessions,
  destroySession,
  peekSessionFlash,
  setSessionCookie,
  setSessionFlash,
  clearSessionFlash,
} from '../lib/session.js';
import { openSignupEnabled } from '../db/index.js';
import { countUsers } from '../lib/bootstrap.js';
import { safeNextPath } from '../lib/validation.js';
import { getUpload, canViewUpload } from '../lib/images.js';
import { renderPage } from '../views/layout.js';
import { forbidden, rateLimited } from '../views/errors.js';
import {
  Landing,
  LoginForm,
  RecoveryCodePage,
  RecoverForm,
  SetupForm,
  SignupClosed,
  SignupForm,
} from '../views/auth.js';
import { translate } from '../lib/i18n.js';
import { randomId } from '../lib/ids.js';

const LOGIN_USER_POLICY = { limit: 5, windowMs: 15 * 60_000, backoffBaseMs: 30_000, maxBackoffMs: 15 * 60_000 };
const LOGIN_IP_POLICY = { limit: 20, windowMs: 15 * 60_000, backoffBaseMs: 60_000, maxBackoffMs: 30 * 60_000 };
const RECOVER_USER_POLICY = { limit: 5, windowMs: 60 * 60_000, backoffBaseMs: 60_000, maxBackoffMs: 60 * 60_000 };
const RECOVER_IP_POLICY = { limit: 15, windowMs: 60 * 60_000, backoffBaseMs: 60_000, maxBackoffMs: 60 * 60_000 };

function usernameErrorKey(code: 'length' | 'charset' | 'separators'): string {
  if (code === 'length') return 'validation.usernameLength';
  if (code === 'charset') return 'validation.usernameCharset';
  return 'validation.usernameSeparators';
}

function userExists(db: AppEnv['Variables']['db'], usernameCi: string, usernameSkel: string): { ci: boolean; skel: boolean } {
  const ci = db.prepare('SELECT 1 AS found FROM users WHERE username_ci = ?').get(usernameCi);
  const skel = db.prepare('SELECT 1 AS found FROM users WHERE username_skel = ?').get(usernameSkel);
  return { ci: Boolean(ci), skel: Boolean(skel) };
}

function signupQuota(
  db: AppEnv['Variables']['db'],
  ip: string,
  usernameKey: string,
): { allowed: boolean; retryAfterSec: number } {
  const checks = [
    { bucket: `signup:ip:hour:${ip}`, limit: 5, windowMs: 60 * 60_000 },
    { bucket: `signup:ip:day:${ip}`, limit: 20, windowMs: 24 * 60 * 60_000 },
    { bucket: `signup:user:${usernameKey}`, limit: 3, windowMs: 60 * 60_000 },
  ];
  let retryAfterSec = 0;
  for (const check of checks) {
    const state = checkWindow(db, check.bucket, check.limit, check.windowMs);
    if (!state.allowed) retryAfterSec = Math.max(retryAfterSec, state.retryAfterSec);
  }
  return { allowed: retryAfterSec === 0, retryAfterSec };
}

function recordSignupQuota(db: AppEnv['Variables']['db'], ip: string, usernameKey: string): void {
  recordRateEvent(db, `signup:ip:hour:${ip}`);
  recordRateEvent(db, `signup:ip:day:${ip}`);
  recordRateEvent(db, `signup:user:${usernameKey}`);
}

export function registerAuthRoutes(app: Hono<AppEnv>): void {
  app.get('/', (c) => {
    if (c.get('user')) return c.redirect('/lists', 303);
    const db = c.get('db');
    if (countUsers(db) === 0) return c.redirect('/setup', 303);
    const locale = c.get('locale');
    return renderPage(
      c,
      { title: c.get('site').appName, campaign: true },
      <Landing locale={locale} csrfToken={c.get('csrfToken')} openSignup={openSignupEnabled(db)} site={c.get('site')} />,
    );
  });

  app.get('/login', (c) => {
    if (c.get('user')) return c.redirect('/lists', 303);
    const locale = c.get('locale');
    return renderPage(
      c,
      { title: translate(locale, 'auth.login.title') },
      <LoginForm
        locale={locale}
        csrfToken={c.get('csrfToken')}
        next={safeNextPath(c.req.query('next'))}
        errors={[]}
        username=""
        password=""
      />,
    );
  });

  app.post('/login', async (c) => {
    if (c.get('user')) return c.redirect('/lists', 303);
    const db = c.get('db');
    const config = c.get('config');
    const locale = c.get('locale');
    const form = c.get('form');
    const rawUsername = formString(form, 'username');
    const rawPassword = formString(form, 'password');
    const parsed = loginInputSchema.safeParse({ username: rawUsername, password: rawPassword });
    const next = safeNextPath(formString(form, 'next'));
    if (!parsed.success) {
      return renderPage(
        c,
        { title: translate(locale, 'auth.login.title'), status: 400 },
        <LoginForm locale={locale} csrfToken={c.get('csrfToken')} next={next} errors={zodErrorKeys(parsed.error)} username={rawUsername} password="" />,
      );
    }

    const ip = clientIp(c, config);
    const usernameKey = normalizeUsernameKey(parsed.data.username) || 'unknown';
    const throttle = checkBuckets(
      db,
      [
        { bucket: `login:user:${usernameKey}`, policy: LOGIN_USER_POLICY },
        { bucket: `login:ip:${ip}`, policy: LOGIN_IP_POLICY },
      ],
    );
    if (!throttle.allowed) {
      c.get('logger').warn('auth.login.rate_limited', { ip });
      return rateLimited(c, throttle.retryAfterSec);
    }

    const row = db
      .prepare('SELECT id, password_hash, is_disabled FROM users WHERE username_ci = ?')
      .get(usernameKey) as { id: string; password_hash: string; is_disabled: number } | undefined;

    let passwordOk = false;
    if (row) {
      passwordOk = await verifyPassword(row.password_hash, parsed.data.password);
    } else {
      await verifyPassword(await dummyPasswordHash(), parsed.data.password);
    }

    if (!row || !passwordOk) {
      recordRateEvent(db, `login:user:${usernameKey}`);
      recordRateEvent(db, `login:ip:${ip}`);
      c.get('logger').info('auth.login.failed', { ip });
      return renderPage(
        c,
        { title: translate(locale, 'auth.login.title'), status: 401 },
        <LoginForm locale={locale} csrfToken={c.get('csrfToken')} next={next} errors={['auth.invalidCredentials']} username={rawUsername} password="" />,
      );
    }

    if (row.is_disabled === 1) {
      recordRateEvent(db, `login:ip:${ip}`);
      return renderPage(
        c,
        { title: translate(locale, 'auth.login.title'), status: 403 },
        <LoginForm locale={locale} csrfToken={c.get('csrfToken')} next={next} errors={['auth.disabled']} username={rawUsername} password="" />,
      );
    }

    const mustChange = (db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(row.id) as {
      must_change_password: number;
    }).must_change_password === 1;
    clearRateEvents(db, `login:user:${usernameKey}`);
    const { token } = createSession(db, config, row.id, ip, c.req.header('user-agent') ?? '');
    setSessionCookie(c, config, token);
    c.get('logger').info('auth.login.succeeded', { userId: row.id });
    if (mustChange) return c.redirect('/settings?notice=mustChangePassword', 303);
    return c.redirect(next ?? '/lists', 303);
  });

  app.post('/logout', (c) => {
    const session = c.get('session');
    if (session) destroySession(c.get('db'), session.id);
    clearSessionCookie(c);
    return c.redirect('/?notice=loggedOut', 303);
  });

  app.get('/signup', (c) => {
    if (c.get('user')) return c.redirect('/lists', 303);
    const db = c.get('db');
    if (countUsers(db) === 0) return c.redirect('/setup', 303);
    const locale = c.get('locale');
    if (!openSignupEnabled(db)) {
      return renderPage(c, { title: translate(locale, 'auth.signup.closedTitle'), status: 403 }, <SignupClosed locale={locale} />);
    }
    return renderPage(
      c,
      { title: translate(locale, 'auth.signup.title') },
      <SignupForm locale={locale} csrfToken={c.get('csrfToken')} errors={[]} username="" />,
    );
  });

  app.post('/signup', async (c) => {
    if (c.get('user')) return c.redirect('/lists', 303);
    const db = c.get('db');
    const config = c.get('config');
    const locale = c.get('locale');
    if (countUsers(db) === 0) return c.redirect('/setup', 303);
    if (!openSignupEnabled(db)) {
      return renderPage(c, { title: translate(locale, 'auth.signup.closedTitle'), status: 403 }, <SignupClosed locale={locale} />);
    }

    const form = c.get('form');
    const rawUsername = formString(form, 'username');
    const parsed = signupInputSchema.safeParse({
      username: rawUsername,
      password: formString(form, 'password'),
      confirm: formString(form, 'confirm'),
    });
    if (!parsed.success) {
      return renderPage(
        c,
        { title: translate(locale, 'auth.signup.title'), status: 400 },
        <SignupForm locale={locale} csrfToken={c.get('csrfToken')} errors={zodErrorKeys(parsed.error)} username={rawUsername} />,
      );
    }

    const username = validateUsername(parsed.data.username);
    if (!username.ok) {
      return renderPage(
        c,
        { title: translate(locale, 'auth.signup.title'), status: 400 },
        <SignupForm locale={locale} csrfToken={c.get('csrfToken')} errors={[usernameErrorKey(username.code)]} username={rawUsername} />,
      );
    }
    if (!meetsPasswordPolicy(parsed.data.password)) {
      return renderPage(
        c,
        { title: translate(locale, 'auth.signup.title'), status: 400 },
        <SignupForm locale={locale} csrfToken={c.get('csrfToken')} errors={['validation.passwordLength']} username={rawUsername} />,
      );
    }

    const ip = clientIp(c, config);
    const quota = signupQuota(db, ip, username.usernameCi);
    if (!quota.allowed) return rateLimited(c, quota.retryAfterSec);
    recordSignupQuota(db, ip, username.usernameCi);

    const exists = userExists(db, username.usernameCi, username.usernameSkel);
    if (exists.ci || exists.skel) {
      return renderPage(
        c,
        { title: translate(locale, 'auth.signup.title'), status: 409 },
        <SignupForm
          locale={locale}
          csrfToken={c.get('csrfToken')}
          errors={[exists.ci ? 'validation.usernameTaken' : 'validation.usernameSimilar']}
          username={rawUsername}
        />,
      );
    }

    const recoveryCode = generateRecoveryCode();
    const now = Date.now();
    const userId = randomId();
    try {
      db.prepare(
        `INSERT INTO users (id, username, username_ci, username_skel, password_hash, avatar_style, avatar_seed,
                            is_admin, is_disabled, locale, recovery_hash, recovery_created_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
      ).run(
        userId,
        username.username,
        username.usernameCi,
        username.usernameSkel,
        await hashPassword(parsed.data.password),
        c.get('config').avatarStyle,
        username.username,
        locale,
        await hashRecoveryCode(recoveryCode),
        now,
        now,
        now,
      );
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      if (code.startsWith('SQLITE_CONSTRAINT')) {
        return renderPage(
          c,
          { title: translate(locale, 'auth.signup.title'), status: 409 },
          <SignupForm locale={locale} csrfToken={c.get('csrfToken')} errors={['validation.usernameTaken']} username={rawUsername} />,
        );
      }
      throw error;
    }

    const { token, session } = createSession(db, config, userId, ip, c.req.header('user-agent') ?? '');
    setSessionCookie(c, config, token);
    setSessionFlash(db, session.id, { recoveryCode });
    c.get('logger').info('auth.signup.succeeded', { userId });
    return c.redirect('/welcome/recovery', 303);
  });

  app.get('/setup', (c) => {
    const db = c.get('db');
    if (countUsers(db) > 0) return c.redirect('/', 303);
    const locale = c.get('locale');
    return renderPage(
      c,
      { title: translate(locale, 'auth.setup.title') },
      <SetupForm locale={locale} csrfToken={c.get('csrfToken')} errors={[]} username="" />,
    );
  });

  app.post('/setup', async (c) => {
    const db = c.get('db');
    const config = c.get('config');
    const locale = c.get('locale');
    if (countUsers(db) > 0) return forbidden(c);

    const form = c.get('form');
    const rawUsername = formString(form, 'username');
    const parsed = signupInputSchema.safeParse({
      username: rawUsername,
      password: formString(form, 'password'),
      confirm: formString(form, 'confirm'),
    });
    if (!parsed.success) {
      return renderPage(
        c,
        { title: translate(locale, 'auth.setup.title'), status: 400 },
        <SetupForm locale={locale} csrfToken={c.get('csrfToken')} errors={zodErrorKeys(parsed.error)} username={rawUsername} />,
      );
    }
    const username = validateUsername(parsed.data.username);
    if (!username.ok) {
      return renderPage(
        c,
        { title: translate(locale, 'auth.setup.title'), status: 400 },
        <SetupForm locale={locale} csrfToken={c.get('csrfToken')} errors={[usernameErrorKey(username.code)]} username={rawUsername} />,
      );
    }
    if (!meetsPasswordPolicy(parsed.data.password)) {
      return renderPage(
        c,
        { title: translate(locale, 'auth.setup.title'), status: 400 },
        <SetupForm locale={locale} csrfToken={c.get('csrfToken')} errors={['validation.passwordLength']} username={rawUsername} />,
      );
    }

    const ip = clientIp(c, config);
    const quota = signupQuota(db, ip, username.usernameCi);
    if (!quota.allowed) return rateLimited(c, quota.retryAfterSec);
    recordSignupQuota(db, ip, username.usernameCi);

    const recoveryCode = generateRecoveryCode();
    const now = Date.now();
    const userId = randomId();
    try {
      db.prepare(
        `INSERT INTO users (id, username, username_ci, username_skel, password_hash, avatar_style, avatar_seed,
                            is_admin, is_disabled, locale, recovery_hash, recovery_created_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?)`,
      ).run(
        userId,
        username.username,
        username.usernameCi,
        username.usernameSkel,
        await hashPassword(parsed.data.password),
        c.get('config').avatarStyle,
        username.username,
        locale,
        await hashRecoveryCode(recoveryCode),
        now,
        now,
        now,
      );
    } catch {
      return forbidden(c);
    }

    const { token, session } = createSession(db, config, userId, ip, c.req.header('user-agent') ?? '');
    setSessionCookie(c, config, token);
    setSessionFlash(db, session.id, { recoveryCode });
    c.get('logger').info('auth.setup.completed', { userId });
    return c.redirect('/welcome/recovery?from=setup', 303);
  });

  app.get('/recover', (c) => {
    const locale = c.get('locale');
    return renderPage(
      c,
      { title: translate(locale, 'auth.recover.title') },
      <RecoverForm locale={locale} csrfToken={c.get('csrfToken')} errors={[]} username="" code="" />,
    );
  });

  app.post('/recover', async (c) => {
    const db = c.get('db');
    const config = c.get('config');
    const locale = c.get('locale');
    const form = c.get('form');
    const rawUsername = formString(form, 'username');
    const rawCode = formString(form, 'code');
    const parsed = recoverInputSchema.safeParse({
      username: rawUsername,
      code: rawCode,
      password: formString(form, 'password'),
      confirm: formString(form, 'confirm'),
    });
    if (!parsed.success) {
      return renderPage(
        c,
        { title: translate(locale, 'auth.recover.title'), status: 400 },
        <RecoverForm locale={locale} csrfToken={c.get('csrfToken')} errors={zodErrorKeys(parsed.error)} username={rawUsername} code={rawCode} />,
      );
    }
    if (!meetsPasswordPolicy(parsed.data.password)) {
      return renderPage(
        c,
        { title: translate(locale, 'auth.recover.title'), status: 400 },
        <RecoverForm locale={locale} csrfToken={c.get('csrfToken')} errors={['validation.passwordLength']} username={rawUsername} code={rawCode} />,
      );
    }
    if (!normalizeRecoveryCode(parsed.data.code)) {
      return renderPage(
        c,
        { title: translate(locale, 'auth.recover.title'), status: 400 },
        <RecoverForm locale={locale} csrfToken={c.get('csrfToken')} errors={['validation.codeInvalid']} username={rawUsername} code={rawCode} />,
      );
    }

    const ip = clientIp(c, config);
    const usernameKey = normalizeUsernameKey(parsed.data.username) || 'unknown';
    const throttle = checkBuckets(
      db,
      [
        { bucket: `recover:user:${usernameKey}`, policy: RECOVER_USER_POLICY },
        { bucket: `recover:ip:${ip}`, policy: RECOVER_IP_POLICY },
      ],
    );
    if (!throttle.allowed) return rateLimited(c, throttle.retryAfterSec);

    const row = db
      .prepare('SELECT id, recovery_hash, is_disabled FROM users WHERE username_ci = ?')
      .get(usernameKey) as { id: string; recovery_hash: string | null; is_disabled: number } | undefined;

    let codeOk = false;
    if (row) {
      codeOk = await verifyRecoveryCode(row.recovery_hash, parsed.data.code);
    } else {
      await verifyPassword(await dummyPasswordHash(), parsed.data.code);
    }

    if (!row || !codeOk) {
      recordRateEvent(db, `recover:user:${usernameKey}`);
      recordRateEvent(db, `recover:ip:${ip}`);
      return renderPage(
        c,
        { title: translate(locale, 'auth.recover.title'), status: 400 },
        <RecoverForm
          locale={locale}
          csrfToken={c.get('csrfToken')}
          errors={['validation.codeWrong']}
          username={rawUsername}
          code={rawCode}
        />,
      );
    }

    db.prepare(
      'UPDATE users SET password_hash = ?, must_change_password = 0, recovery_hash = NULL, recovery_created_at = NULL, updated_at = ? WHERE id = ?',
    ).run(await hashPassword(parsed.data.password), Date.now(), row.id);
    destroyAllSessions(db, row.id);
    clearRateEvents(db, `recover:user:${usernameKey}`);
    c.get('logger').info('auth.recover.succeeded', { userId: row.id });
    return c.redirect('/login?notice=recoveryUsed', 303);
  });

  app.get('/welcome/recovery', (c) => {
    const session = c.get('session');
    const user = c.get('user');
    if (!session || !user) return c.redirect('/login', 303);
    const db = c.get('db');
    const flash = peekSessionFlash(db, session.id) as { recoveryCode?: unknown } | null;
    const code = typeof flash?.recoveryCode === 'string' ? flash.recoveryCode : null;
    if (!code) return c.redirect('/lists', 303);
    const requestedFrom = c.req.query('from');
    const from = requestedFrom === 'setup' || requestedFrom === 'settings' ? requestedFrom : 'signup';
    const locale = c.get('locale');
    return renderPage(
      c,
      { title: translate(locale, 'auth.welcome.title') },
      <RecoveryCodePage
        locale={locale}
        csrfToken={c.get('csrfToken')}
        formattedCode={formatRecoveryCode(code)}
        from={from}
      />,
    );
  });

  app.post('/welcome/recovery/ack', (c) => {
    const session = c.get('session');
    if (!session) return c.redirect('/login', 303);
    clearSessionFlash(c.get('db'), session.id);
    const from = formString(c.get('form'), 'from');
    if (from === 'setup') return c.redirect('/lists?notice=setupDone', 303);
    if (from === 'settings') return c.redirect('/settings?notice=recoveryGenerated', 303);
    return c.redirect('/lists', 303);
  });

  app.get('/avatar', (c) => {
    const seed = c.req.query('seed') ?? '';
    const size = parseAvatarSize(c.req.query('size'));
    if (!isValidAvatarSeed(seed)) {
      c.status(400);
      return c.text('Invalid avatar parameters');
    }
    const svg = renderAvatar(seed, size, c.get('config').avatarStyle);
    c.header('Content-Type', 'image/svg+xml; charset=utf-8');
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    // Not immutable: the admin can change AVATAR_STYLE, and the same URL then renders differently.
    c.header('Cache-Control', 'public, max-age=86400');
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
    c.header('Content-Disposition', 'inline');
    return c.body(svg);
  });

  app.get('/media/:file', async (c) => {
    const user = c.get('user');
    if (!user) {
      c.status(401);
      c.header('Cache-Control', 'no-store');
      return c.text('Unauthorized');
    }
    const file = c.req.param('file');
    const match = /^([a-f0-9]{32})\.webp$/.exec(file);
    if (!match) return c.notFound();
    const upload = getUpload(c.get('db'), match[1] as string);
    if (!upload) return c.notFound();
    if (!canViewUpload(c.get('db'), user.id, upload)) {
      c.status(403);
      return c.text('Forbidden');
    }
    try {
      const data = await fs.readFile(path.join(c.get('config').uploadsDir, upload.filename));
      c.header('Content-Type', upload.mime);
      c.header('Content-Length', String(upload.bytes));
      c.header('Cache-Control', 'private, max-age=31536000, immutable');
      c.header('Content-Disposition', 'inline');
      return c.body(new Uint8Array(data));
    } catch {
      return c.notFound();
    }
  });

  app.get('/healthz', (c) => {
    try {
      c.get('db').prepare('SELECT 1').get();
      c.header('Cache-Control', 'no-store');
      return c.json({ status: 'ok', version: '0.1.0' });
    } catch {
      c.header('Cache-Control', 'no-store');
      return c.json({ status: 'error' }, 503);
    }
  });
}
