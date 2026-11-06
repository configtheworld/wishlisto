import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Config } from '../config.js';
import { migrations } from './migrations.js';

export type DB = Database.Database;

export function openDatabase(config: Config): DB {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(config.uploadsDir, { recursive: true, mode: 0o700 });

  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('trusted_schema = OFF');

  migrate(db);

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('open_signup', config.openSignupDefault ? 'true' : 'false');
  insertSetting.run('instance_name', 'Wishlisto');

  try {
    fs.chmodSync(config.dbPath, 0o600);
  } catch {
    // Non-fatal (e.g. exotic filesystems).
  }

  return db;
}

export function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set(
    db
      .prepare('SELECT id FROM _migrations')
      .all()
      .map((row) => (row as { id: string }).id),
  );
  const insert = db.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)');
  const now = Date.now();

  // Table rebuilds (for example widening a CHECK constraint) need foreign keys
  // disabled outside the transaction. Sessions and rows are re-validated after.
  const foreignKeys = db.pragma('foreign_keys', { simple: true }) === 1;
  if (foreignKeys) db.pragma('foreign_keys = OFF');
  try {
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      db.transaction(() => {
        db.exec(migration.sql);
        insert.run(migration.id, now);
      })();
    }
  } finally {
    if (foreignKeys) db.pragma('foreign_keys = ON');
  }
}

export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function openSignupEnabled(db: DB): boolean {
  return getSetting(db, 'open_signup') !== 'false';
}

export function uploadPath(config: Config, filename: string): string {
  return path.join(config.uploadsDir, filename);
}
