import { AVATAR_STYLE_ID } from './avatar.js';
import type { Config } from '../config.js';
import { ConfigError } from '../config.js';
import type { DB } from '../db/index.js';
import type { Logger } from './logger.js';
import { hashPassword, meetsPasswordPolicy } from './password.js';
import { validateUsername } from './username.js';
import { randomId } from './ids.js';

export function countUsers(db: DB): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  return row.count;
}

/**
 * Creates the admin from ADMIN_USERNAME / ADMIN_PASSWORD on first boot.
 * Existing instances are never modified by these variables.
 */
export async function ensureEnvAdmin(db: DB, config: Config, logger: Logger): Promise<void> {
  if (!config.adminUsername || !config.adminPassword) return;
  if (countUsers(db) > 0) {
    logger.debug('ADMIN_USERNAME is set but users already exist; leaving them untouched');
    return;
  }

  const username = validateUsername(config.adminUsername);
  if (!username.ok) throw new ConfigError('ADMIN_USERNAME is not a valid username (3–32 characters, letters/numbers/._-).');
  if (!meetsPasswordPolicy(config.adminPassword)) {
    throw new ConfigError('ADMIN_PASSWORD must be between 8 and 128 characters.');
  }

  const clash = db
    .prepare('SELECT 1 AS found FROM users WHERE username_ci = ? OR username_skel = ?')
    .get(username.usernameCi, username.usernameSkel);
  if (clash) throw new ConfigError('ADMIN_USERNAME collides with an existing user.');

  const now = Date.now();
  const passwordHash = await hashPassword(config.adminPassword);
  db.prepare(
    `INSERT INTO users (id, username, username_ci, username_skel, password_hash, avatar_style, avatar_seed,
                        is_admin, is_disabled, locale, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 'en', ?, ?)`,
  ).run(
    randomId(),
    username.username,
    username.usernameCi,
    username.usernameSkel,
    passwordHash,
    AVATAR_STYLE_ID,
    username.username,
    now,
    now,
  );
  logger.info('Created the admin account from ADMIN_USERNAME');
}
