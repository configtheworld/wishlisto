import fs from 'node:fs/promises';
import path from 'node:path';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { requireUser } from '../middleware/auth.js';
import {
  changePasswordSchema,
  deleteAccountSchema,
  languageInputSchema,
  recoveryPasswordSchema,
  safeNextPath,
  zodErrorKeys,
} from '../lib/validation.js';
import { formString } from '../lib/forms.js';
import { hashPassword, meetsPasswordPolicy, verifyPassword } from '../lib/password.js';
import { normalizeUsername } from '../lib/username.js';
import { generateRecoveryCode, hashRecoveryCode } from '../lib/recovery.js';
import {
  clearSessionCookie,
  destroyAllSessions,
  destroySession,
  setLocaleCookie,
  setSessionFlash,
} from '../lib/session.js';
import { renderPage, redirectWithNotice } from '../views/layout.js';
import { SettingsPage } from '../views/settings.js';
import { translate } from '../lib/i18n.js';

function returnPath(c: Context<AppEnv>): string {
  const referer = c.req.header('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.host === c.req.header('host')) {
        const path = safeNextPath(`${url.pathname}${url.search}`);
        if (path) return path;
      }
    } catch {
      // Fall through to the default.
    }
  }
  return c.get('user') ? '/settings' : '/';
}

function settingsPage(c: Context<AppEnv>, errors: string[] = [], status: 200 | 400 = 200) {
  const user = c.get('user');
  if (!user) return c.redirect('/login', 303);
  const db = c.get('db');
  const lastAdmin =
    user.isAdmin &&
    (db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get() as { count: number }).count <= 1;
  return renderPage(
    c,
    { title: translate(user.locale, 'settings.title'), active: 'settings', status },
    <SettingsPage
      locale={user.locale}
      csrfToken={c.get('csrfToken')}
      user={user}
      lastAdmin={lastAdmin}
      errors={errors}
    />,
  );
}

export function registerSettingsRoutes(app: Hono<AppEnv>): void {
  app.get('/settings', requireUser, (c) => settingsPage(c));

  app.post('/settings/password', requireUser, async (c) => {
    const user = c.get('user');
    const session = c.get('session');
    if (!user || !session) return c.redirect('/login', 303);
    const form = c.get('form');
    const parsed = changePasswordSchema.safeParse({
      current: formString(form, 'current'),
      password: formString(form, 'password'),
      confirm: formString(form, 'confirm'),
    });
    if (!parsed.success) return settingsPage(c, zodErrorKeys(parsed.error), 400);
    if (!meetsPasswordPolicy(parsed.data.password)) {
      return settingsPage(c, ['validation.passwordLength'], 400);
    }

    const row = c.get('db').prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as
      | { password_hash: string }
      | undefined;
    if (!row || !(await verifyPassword(row.password_hash, parsed.data.current))) {
      return settingsPage(c, ['validation.passwordWrong'], 400);
    }

    c.get('db')
      .prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
      .run(await hashPassword(parsed.data.password), Date.now(), user.id);
    destroyAllSessions(c.get('db'), user.id, session.id);
    c.get('logger').info('settings.password.changed', { userId: user.id });
    return redirectWithNotice(c, '/settings', 'passwordChanged');
  });

  app.post('/settings/recovery', requireUser, async (c) => {
    const user = c.get('user');
    const session = c.get('session');
    if (!user || !session) return c.redirect('/login', 303);
    const parsed = recoveryPasswordSchema.safeParse({ password: formString(c.get('form'), 'password') });
    if (!parsed.success) return settingsPage(c, zodErrorKeys(parsed.error), 400);

    const row = c.get('db').prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as
      | { password_hash: string }
      | undefined;
    if (!row || !(await verifyPassword(row.password_hash, parsed.data.password))) {
      return settingsPage(c, ['validation.passwordWrong'], 400);
    }

    const code = generateRecoveryCode();
    c.get('db')
      .prepare('UPDATE users SET recovery_hash = ?, recovery_created_at = ?, updated_at = ? WHERE id = ?')
      .run(await hashRecoveryCode(code), Date.now(), Date.now(), user.id);
    setSessionFlash(c.get('db'), session.id, { recoveryCode: code });
    c.get('logger').info('settings.recovery.regenerated', { userId: user.id });
    return c.redirect('/welcome/recovery?from=settings', 303);
  });

  app.post('/settings/language', async (c) => {
    const parsed = languageInputSchema.safeParse({ locale: formString(c.get('form'), 'locale') });
    const back = returnPath(c);
    if (!parsed.success) return c.redirect(back, 303);
    const user = c.get('user');
    setLocaleCookie(c, c.get('config'), parsed.data.locale);
    if (user) {
      c.get('db')
        .prepare('UPDATE users SET locale = ?, updated_at = ? WHERE id = ?')
        .run(parsed.data.locale, Date.now(), user.id);
    }
    return redirectWithNotice(c, back, 'languageSaved');
  });

  app.post('/settings/delete', requireUser, async (c) => {
    const user = c.get('user');
    const session = c.get('session');
    if (!user || !session) return c.redirect('/login', 303);
    const parsed = deleteAccountSchema.safeParse({
      confirmUsername: formString(c.get('form'), 'confirmUsername'),
      password: formString(c.get('form'), 'password'),
    });
    if (!parsed.success) return settingsPage(c, zodErrorKeys(parsed.error), 400);
    if (normalizeUsername(parsed.data.confirmUsername) !== user.username) {
      return settingsPage(c, ['validation.confirmUsername'], 400);
    }

    const db = c.get('db');
    const adminCount = (db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get() as { count: number }).count;
    if (user.isAdmin && adminCount <= 1) {
      return settingsPage(c, ['settings.lastAdmin'], 400);
    }

    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as
      | { password_hash: string }
      | undefined;
    if (!row || !(await verifyPassword(row.password_hash, parsed.data.password))) {
      return settingsPage(c, ['validation.passwordWrong'], 400);
    }

    const uploads = db.prepare('SELECT filename FROM uploads WHERE user_id = ?').all(user.id) as Array<{
      filename: string;
    }>;
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    destroySession(db, session.id);
    for (const upload of uploads) {
      await fs.rm(path.join(c.get('config').uploadsDir, upload.filename), { force: true }).catch(() => {});
    }
    c.get('logger').info('settings.account.deleted', { userId: user.id });
    clearSessionCookie(c);
    return c.redirect('/login?notice=accountDeleted', 303);
  });
}
