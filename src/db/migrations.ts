export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: '001_initial',
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        username_ci TEXT NOT NULL UNIQUE,
        username_skel TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        avatar_style TEXT NOT NULL DEFAULT 'lorelei',
        avatar_seed TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
        is_disabled INTEGER NOT NULL DEFAULT 0 CHECK (is_disabled IN (0, 1)),
        locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'de')),
        recovery_hash TEXT,
        recovery_created_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- There can be exactly one admin, enforced by the database itself.
      CREATE UNIQUE INDEX users_single_admin ON users (is_admin) WHERE is_admin = 1;

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        flash TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        ip TEXT NOT NULL,
        user_agent TEXT NOT NULL
      );
      CREATE INDEX sessions_user_idx ON sessions (user_id);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE uploads (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        mime TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX uploads_user_idx ON uploads (user_id);

      CREATE TABLE lists (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '',
        color INTEGER NOT NULL DEFAULT 0 CHECK (color BETWEEN 0 AND 7),
        note TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX lists_user_idx ON lists (user_id, created_at);

      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        url TEXT NOT NULL DEFAULT '',
        image_upload_id TEXT REFERENCES uploads (id) ON DELETE SET NULL,
        price_minor INTEGER CHECK (price_minor IS NULL OR price_minor >= 0),
        currency TEXT NOT NULL DEFAULT 'EUR',
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 999),
        priority INTEGER NOT NULL DEFAULT 1 CHECK (priority BETWEEN 0 AND 3),
        notes TEXT NOT NULL DEFAULT '',
        size TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '',
        is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX items_list_idx ON items (list_id, is_archived, position);
      CREATE INDEX items_user_idx ON items (user_id);

      CREATE TABLE item_links (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        url TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX item_links_item_idx ON item_links (item_id, position);

      CREATE TABLE rate_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bucket TEXT NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE INDEX rate_events_bucket_idx ON rate_events (bucket, at);
    `,
  },
  {
    id: '002_sharing_groups_tr_admin',
    sql: `
      -- SQLite cannot widen a CHECK constraint in place, so rebuild users to add
      -- Turkish and the forced-password-change flag. Foreign keys are disabled
      -- around the migration loop by migrate().
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        username_ci TEXT NOT NULL UNIQUE,
        username_skel TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        avatar_style TEXT NOT NULL DEFAULT 'lorelei-neutral',
        avatar_seed TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
        is_disabled INTEGER NOT NULL DEFAULT 0 CHECK (is_disabled IN (0, 1)),
        locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'de', 'tr')),
        must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
        recovery_hash TEXT,
        recovery_created_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO users_new (id, username, username_ci, username_skel, password_hash, avatar_style, avatar_seed,
                             is_admin, is_disabled, locale, must_change_password, recovery_hash, recovery_created_at,
                             created_at, updated_at)
        SELECT id, username, username_ci, username_skel, password_hash, avatar_style, avatar_seed,
               is_admin, is_disabled, locale, 0, recovery_hash, recovery_created_at,
               created_at, updated_at
          FROM users;

      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      CREATE UNIQUE INDEX users_single_admin ON users (is_admin) WHERE is_admin = 1;

      ALTER TABLE lists ADD COLUMN public_token TEXT;
      CREATE UNIQUE INDEX lists_public_token_idx ON lists (public_token) WHERE public_token IS NOT NULL;

      CREATE TABLE groups (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        invite_token TEXT UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX groups_owner_idx ON groups (owner_id, created_at);

      CREATE TABLE group_members (
        group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, user_id)
      );
      CREATE INDEX group_members_user_idx ON group_members (user_id, joined_at);

      CREATE TABLE list_groups (
        list_id TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
        group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
        shared_by TEXT REFERENCES users (id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (list_id, group_id)
      );
      CREATE INDEX list_groups_group_idx ON list_groups (group_id, created_at);
    `,
  },
  {
    id: '003_claims',
    sql: `
      -- One claim per item. The claimer chooses whether the list owner may see who claimed it.
      CREATE TABLE claims (
        item_id TEXT PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
        claimer_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        reveal_to_owner INTEGER NOT NULL DEFAULT 0 CHECK (reveal_to_owner IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX claims_claimer_idx ON claims (claimer_id);
    `,
  },
  {
    id: '004_claim_visibility',
    sql: `
      -- Visibility for the list owner: 0 = hidden (surprise), 1 = claimed but not by whom, 2 = claimer shown.
      -- SQLite cannot widen a CHECK constraint, so the table is rebuilt.
      CREATE TABLE claims_new (
        item_id TEXT PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
        claimer_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        visibility INTEGER NOT NULL DEFAULT 0 CHECK (visibility IN (0, 1, 2)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO claims_new (item_id, claimer_id, visibility, created_at, updated_at)
        SELECT item_id, claimer_id, CASE WHEN reveal_to_owner = 1 THEN 2 ELSE 0 END, created_at, updated_at
          FROM claims;
      DROP TABLE claims;
      ALTER TABLE claims_new RENAME TO claims;
      CREATE INDEX claims_claimer_idx ON claims (claimer_id);
    `,
  },
];
