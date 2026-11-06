import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types.js';
import { DEFAULT_LOCALE, localeFromAcceptLanguage } from '../lib/i18n.js';
import type { Locale } from '../lib/i18n.js';
import { readLocaleCookie } from '../lib/session.js';
import { forbidden } from '../views/errors.js';

export const localeMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  const locale: Locale =
    user?.locale ?? readLocaleCookie(c) ?? localeFromAcceptLanguage(c.req.header('accept-language')) ?? DEFAULT_LOCALE;
  c.set('locale', locale);
  await next();
};

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (!user) {
    if (c.req.method === 'GET') {
      const nextPath = `${c.req.path}${new URL(c.req.url).search}`;
      return c.redirect(`/login?next=${encodeURIComponent(nextPath)}`, 303);
    }
    return c.redirect('/login', 303);
  }
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (!user) {
    if (c.req.method === 'GET') {
      const nextPath = `${c.req.path}${new URL(c.req.url).search}`;
      return c.redirect(`/login?next=${encodeURIComponent(nextPath)}`, 303);
    }
    return c.redirect('/login', 303);
  }
  if (!user.isAdmin) return forbidden(c);
  await next();
};

// A temporary password from the admin can only be replaced. Everything else is
// paused until the user has chosen their own password.
const PASSWORD_CHANGE_ALLOWED = new Set([
  '/settings',
  '/settings/password',
  '/settings/language',
  '/logout',
  '/healthz',
  '/avatar',
  '/app.css',
  '/app.js',
  '/theme.js',
  '/favicon.svg',
]);

export const requirePasswordChangeComplete: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (!user?.mustChangePassword) return next();
  const path = c.req.path;
  if (PASSWORD_CHANGE_ALLOWED.has(path) || path.startsWith('/media/')) return next();
  return c.redirect('/settings?notice=mustChangePassword', 303);
};
