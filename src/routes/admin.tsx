import type { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { requireAdmin } from '../middleware/auth.js';
import { formString } from '../lib/forms.js';
import { randomToken } from '../lib/ids.js';
import { hashPassword } from '../lib/password.js';
import { destroyAllSessions, clearSessionFlash, peekSessionFlash, setSessionFlash } from '../lib/session.js';
import { openSignupEnabled, setSetting } from '../db/index.js';
import { CAMPAIGN_MAX_LENGTH, getCampaign, saveCampaign } from '../lib/campaign.js';
import { renderPage, redirectWithNotice } from '../views/layout.js';
import { AdminPage } from '../views/admin.js';
import type { AdminUser } from '../views/admin.js';
import { badRequest, notFound } from '../views/errors.js';
import { translate } from '../lib/i18n.js';

function temporaryPassword(): string {
  return randomToken(12).replace(/[-_]/g, (char) => (char === '-' ? 'A' : 'B'));
}

export function registerAdminRoutes(app: Hono<AppEnv>): void {
  app.get('/admin', requireAdmin, (c) => {
    const user = c.get('user');
    const session = c.get('session');
    if (!user || !session) return c.redirect('/login', 303);
    const db = c.get('db');

    const flash = peekSessionFlash(db, session.id) as
      | { adminTempPassword?: unknown; adminTempUsername?: unknown }
      | null;
    let tempPassword: { username: string; password: string } | null = null;
    if (typeof flash?.adminTempPassword === 'string' && typeof flash?.adminTempUsername === 'string') {
      tempPassword = { username: flash.adminTempUsername, password: flash.adminTempPassword };
      clearSessionFlash(db, session.id);
    }

    const users = db
      .prepare(
        'SELECT id, username, is_admin, is_disabled, must_change_password, created_at FROM users ORDER BY created_at ASC',
      )
      .all() as AdminUser[];

    return renderPage(
      c,
      { title: translate(c.get('locale'), 'admin.title'), active: 'admin' },
      <AdminPage
        locale={c.get('locale')}
        csrfToken={c.get('csrfToken')}
        openSignup={openSignupEnabled(db)}
        users={users}
        currentUserId={user.id}
        tempPassword={tempPassword}
        campaign={getCampaign(db)}
      />,
    );
  });

  app.post('/admin/campaign', requireAdmin, (c) => {
    const enabled = formString(c.get('form'), 'enabled') === '1';
    const text = formString(c.get('form'), 'text').trim();
    if (text.length > CAMPAIGN_MAX_LENGTH || (enabled && text === '')) return badRequest(c);
    saveCampaign(c.get('db'), { enabled, text });
    c.get('logger').info('admin.campaign.updated', { enabled });
    return redirectWithNotice(c, '/admin', 'campaignSaved');
  });

  app.post('/admin/signup', requireAdmin, (c) => {
    const open = formString(c.get('form'), 'open') === '1';
    setSetting(c.get('db'), 'open_signup', open ? 'true' : 'false');
    c.get('logger').info('admin.signup.updated', { open });
    return redirectWithNotice(c, '/admin', 'signupUpdated');
  });

  app.post('/admin/users/:id/reset', requireAdmin, async (c) => {
    const admin = c.get('user');
    const session = c.get('session');
    if (!admin || !session) return c.redirect('/login', 303);
    const db = c.get('db');
    const target = db
      .prepare('SELECT id, username, is_admin FROM users WHERE id = ?')
      .get(c.req.param('id')) as { id: string; username: string; is_admin: number } | undefined;
    if (!target) return notFound(c);
    if (target.id === admin.id || target.is_admin === 1) return badRequest(c);

    const password = temporaryPassword();
    db.prepare(
      'UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?',
    ).run(await hashPassword(password), Date.now(), target.id);
    destroyAllSessions(db, target.id);
    setSessionFlash(db, session.id, { adminTempPassword: password, adminTempUsername: target.username });
    c.get('logger').info('admin.password.reset', { adminId: admin.id, userId: target.id });
    return redirectWithNotice(c, '/admin', 'tempPasswordReady');
  });
}
