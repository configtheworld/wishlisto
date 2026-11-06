import { createHash, timingSafeEqual } from 'node:crypto';
import { getCookie, setCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types.js';
import type { Config } from '../config.js';
import type { DB } from '../db/index.js';
import { randomToken } from '../lib/ids.js';
import { findSession, SESSION_COOKIE, clearSessionCookie } from '../lib/session.js';
import { csrfFailed } from '../views/errors.js';

export const CSRF_COOKIE = 'wishlisto_csrf';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function equalTokens(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

export function sessionMiddleware(db: DB, config: Config): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('user', null);
    c.set('session', null);
    c.set('form', null);

    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const found = findSession(db, config, token);
      if (found) {
        c.set('user', found.user);
        c.set('session', found.session);
        c.set('csrfToken', found.session.csrf_token);
      } else {
        clearSessionCookie(c);
      }
    }

    if (!c.get('csrfToken')) {
      let anonymous = getCookie(c, CSRF_COOKIE);
      if (!anonymous || !/^[A-Za-z0-9_-]{20,64}$/.test(anonymous)) {
        anonymous = randomToken(24);
        setCookie(c, CSRF_COOKIE, anonymous, {
          httpOnly: true,
          secure: config.cookieSecure,
          sameSite: 'Lax',
          path: '/',
          maxAge: 30 * 24 * 60 * 60,
        });
      }
      c.set('csrfToken', anonymous);
    }

    await next();
  };
}

export const csrfMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!UNSAFE_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  const contentType = c.req.header('content-type') ?? '';
  let body: Record<string, unknown> | null = null;
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    try {
      body = (await c.req.parseBody({ all: true })) as Record<string, unknown>;
    } catch {
      return csrfFailed(c);
    }
    c.set('form', body as never);
  }

  const headerToken = c.req.header('x-csrf-token');
  const bodyToken = typeof body?._csrf === 'string' ? body._csrf : undefined;
  const provided = headerToken ?? bodyToken;
  const expected = c.get('csrfToken');

  if (!provided || !expected || !equalTokens(provided, expected)) {
    return csrfFailed(c);
  }

  const origin = c.req.header('origin');
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== (c.req.header('host') ?? '')) return csrfFailed(c);
    } catch {
      return csrfFailed(c);
    }
  }
  const fetchSite = c.req.header('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return csrfFailed(c);
  }

  await next();
};
