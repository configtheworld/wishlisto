import { createHash } from 'node:crypto';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { Config } from '../config.js';
import type { DB } from '../db/index.js';
import { randomToken } from './ids.js';
import { isLocale } from './i18n.js';
import type { Locale } from './i18n.js';

export const SESSION_COOKIE = 'wishlisto_session';
export const LOCALE_COOKIE = 'wishlisto_locale';

export interface SessionRow {
  id: string;
  user_id: string;
  csrf_token: string;
  flash: string | null;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  ip: string;
  user_agent: string;
}

export interface SessionUser {
  id: string;
  username: string;
  isAdmin: boolean;
  isDisabled: boolean;
  mustChangePassword: boolean;
  locale: Locale;
  createdAt: number;
}

interface JoinedRow extends SessionRow {
  username: string;
  is_admin: number;
  is_disabled: number;
  must_change_password: number;
  locale: string;
  user_created_at: number;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(
  db: DB,
  config: Config,
  userId: string,
  ip: string,
  userAgent: string,
): { token: string; session: SessionRow } {
  const now = Date.now();
  const token = randomToken(32);
  const session: SessionRow = {
    id: hashSessionToken(token),
    user_id: userId,
    csrf_token: randomToken(24),
    flash: null,
    created_at: now,
    expires_at: now + config.sessionTtlMs,
    last_seen_at: now,
    ip: ip.slice(0, 64),
    user_agent: userAgent.slice(0, 300),
  };
  db.prepare(
    'INSERT INTO sessions (id, user_id, csrf_token, flash, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    session.id,
    session.user_id,
    session.csrf_token,
    session.flash,
    session.created_at,
    session.expires_at,
    session.last_seen_at,
    session.ip,
    session.user_agent,
  );
  if (Math.random() < 0.05) {
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  }
  return { token, session };
}

export function findSession(
  db: DB,
  config: Config,
  token: string,
): { session: SessionRow; user: SessionUser } | null {
  const row = db
    .prepare(
      `SELECT s.*, u.username, u.is_admin, u.is_disabled, u.must_change_password, u.locale,
              u.created_at AS user_created_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`,
    )
    .get(hashSessionToken(token)) as JoinedRow | undefined;
  if (!row) return null;

  const now = Date.now();
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    return null;
  }
  if (row.is_disabled === 1) return null;

  // Slide the session and refresh last_seen at most every five minutes.
  if (now - row.last_seen_at > 5 * 60_000) {
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(
      now,
      now + config.sessionTtlMs,
      row.id,
    );
  }

  return {
    session: {
      id: row.id,
      user_id: row.user_id,
      csrf_token: row.csrf_token,
      flash: row.flash,
      created_at: row.created_at,
      expires_at: row.expires_at,
      last_seen_at: row.last_seen_at,
      ip: row.ip,
      user_agent: row.user_agent,
    },
    user: {
      id: row.user_id,
      username: row.username,
      isAdmin: row.is_admin === 1,
      isDisabled: row.is_disabled === 1,
      mustChangePassword: row.must_change_password === 1,
      locale: isLocale(row.locale) ? row.locale : 'en',
      createdAt: row.user_created_at,
    },
  };
}

export function setSessionCookie(c: Context, config: Config, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export function destroySession(db: DB, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function destroyAllSessions(db: DB, userId: string, exceptSessionId?: string): void {
  if (exceptSessionId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, exceptSessionId);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

export function setSessionFlash(db: DB, sessionId: string, flash: unknown): void {
  db.prepare('UPDATE sessions SET flash = ? WHERE id = ?').run(JSON.stringify(flash), sessionId);
}

export function takeSessionFlash(db: DB, sessionId: string): unknown {
  const row = db.prepare('SELECT flash FROM sessions WHERE id = ?').get(sessionId) as { flash: string | null } | undefined;
  if (!row?.flash) return null;
  db.prepare('UPDATE sessions SET flash = NULL WHERE id = ?').run(sessionId);
  try {
    return JSON.parse(row.flash);
  } catch {
    return null;
  }
}

export function peekSessionFlash(db: DB, sessionId: string): unknown {
  const row = db.prepare('SELECT flash FROM sessions WHERE id = ?').get(sessionId) as { flash: string | null } | undefined;
  if (!row?.flash) return null;
  try {
    return JSON.parse(row.flash);
  } catch {
    return null;
  }
}

export function clearSessionFlash(db: DB, sessionId: string): void {
  db.prepare('UPDATE sessions SET flash = NULL WHERE id = ?').run(sessionId);
}

export function readLocaleCookie(c: Context): Locale | null {
  const value = getCookie(c, LOCALE_COOKIE);
  return isLocale(value) ? value : null;
}

export function setLocaleCookie(c: Context, config: Config, locale: Locale): void {
  setCookie(c, LOCALE_COOKIE, locale, {
    httpOnly: false,
    secure: config.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
  });
}
