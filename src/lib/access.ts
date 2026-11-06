import type { DB } from '../db/index.js';

export interface GroupRow {
  id: string;
  owner_id: string;
  name: string;
  note: string;
  invite_token: string | null;
  created_at: number;
  updated_at: number;
}

export interface GroupWithCounts extends GroupRow {
  member_count: number;
  list_count: number;
}

export interface GroupMemberRow {
  user_id: string;
  username: string;
  joined_at: number;
}

export interface SharedListRow {
  id: string;
  name: string;
  emoji: string;
  color: number;
  owner_id: string;
  owner_username: string;
  shared_by: string | null;
  created_at: number;
}

export function isGroupMember(db: DB, groupId: string, userId: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 AS ok FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId),
  );
}

export function isListOwner(db: DB, listId: string, userId: string): boolean {
  return Boolean(db.prepare('SELECT 1 AS ok FROM lists WHERE id = ? AND user_id = ?').get(listId, userId));
}

/**
 * How a user may see a list: as its owner, or through a group it is shared to.
 * Returns null when the list is not visible at all.
 */
export function listAccess(db: DB, listId: string, userId: string): 'owner' | 'group' | null {
  const owned = db.prepare('SELECT 1 AS ok FROM lists WHERE id = ? AND user_id = ?').get(listId, userId);
  if (owned) return 'owner';
  const shared = db
    .prepare(
      `SELECT 1 AS ok
         FROM list_groups lg
         JOIN group_members gm ON gm.group_id = lg.group_id
        WHERE lg.list_id = ? AND gm.user_id = ?
        LIMIT 1`,
    )
    .get(listId, userId);
  return shared ? 'group' : null;
}

export function listSharedGroups(db: DB, listId: string): Array<{ id: string; name: string }> {
  return db
    .prepare(
      `SELECT g.id, g.name
         FROM list_groups lg
         JOIN groups g ON g.id = lg.group_id
        WHERE lg.list_id = ?
        ORDER BY g.name COLLATE NOCASE ASC`,
    )
    .all(listId) as Array<{ id: string; name: string }>;
}

export function userGroups(db: DB, userId: string): GroupWithCounts[] {
  return db
    .prepare(
      `SELECT g.*,
              (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) AS member_count,
              (SELECT COUNT(*) FROM list_groups lg WHERE lg.group_id = g.id) AS list_count
         FROM groups g
         JOIN group_members gm ON gm.group_id = g.id
        WHERE gm.user_id = ?
        ORDER BY g.created_at DESC`,
    )
    .all(userId) as GroupWithCounts[];
}

export function groupWithCounts(db: DB, groupId: string): GroupWithCounts | null {
  return (
    (db
      .prepare(
        `SELECT g.*,
                (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
                (SELECT COUNT(*) FROM list_groups lg WHERE lg.group_id = g.id) AS list_count
           FROM groups g
          WHERE g.id = ?`,
      )
      .get(groupId) as GroupWithCounts | undefined) ?? null
  );
}

export function groupMembers(db: DB, groupId: string): GroupMemberRow[] {
  return db
    .prepare(
      `SELECT gm.user_id, u.username, gm.joined_at
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = ?
        ORDER BY gm.joined_at ASC, u.username COLLATE NOCASE ASC`,
    )
    .all(groupId) as GroupMemberRow[];
}

export function groupLists(db: DB, groupId: string): SharedListRow[] {
  return db
    .prepare(
      `SELECT l.id, l.name, l.emoji, l.color, l.user_id AS owner_id, u.username AS owner_username,
              lg.shared_by, lg.created_at
         FROM list_groups lg
         JOIN lists l ON l.id = lg.list_id
         JOIN users u ON u.id = l.user_id
        WHERE lg.group_id = ?
        ORDER BY lg.created_at ASC`,
    )
    .all(groupId) as SharedListRow[];
}

export function groupByInviteToken(db: DB, token: string): GroupWithCounts | null {
  return (
    (db
      .prepare(
        `SELECT g.*,
                (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
                (SELECT COUNT(*) FROM list_groups lg WHERE lg.group_id = g.id) AS list_count
           FROM groups g
          WHERE g.invite_token = ?`,
      )
      .get(token) as GroupWithCounts | undefined) ?? null
  );
}

export interface PreviewItemRow {
  id: string;
  list_id: string;
  title: string;
  image_upload_id: string | null;
  price_minor: number | null;
  currency: string;
}

export interface FeedRow extends PreviewItemRow {
  list_name: string;
  owner_id: string;
  owner_username: string;
}

/** The first few wishes of each list, for compact previews. */
export function listPreviewItems(db: DB, listIds: string[], perList = 4): Map<string, PreviewItemRow[]> {
  const map = new Map<string, PreviewItemRow[]>();
  if (listIds.length === 0) return map;
  const placeholders = listIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, list_id, title, image_upload_id, price_minor, currency
         FROM (
           SELECT i.id, i.list_id, i.title, i.image_upload_id, i.price_minor, i.currency,
                  ROW_NUMBER() OVER (PARTITION BY i.list_id ORDER BY i.position ASC, i.created_at ASC) AS rn
             FROM items i
            WHERE i.is_archived = 0 AND i.list_id IN (${placeholders})
         )
        WHERE rn <= ?`,
    )
    .all(...listIds, perList) as PreviewItemRow[];
  for (const row of rows) {
    const list = map.get(row.list_id) ?? [];
    list.push(row);
    map.set(row.list_id, list);
  }
  return map;
}

/** Newest wishes from lists shared with any group the user is in, excluding their own lists. */
export function groupFeed(db: DB, userId: string, limit = 24): FeedRow[] {
  return db
    .prepare(
      `SELECT i.id, i.list_id, i.title, i.image_upload_id, i.price_minor, i.currency,
              l.name AS list_name, l.user_id AS owner_id, u.username AS owner_username
         FROM items i
         JOIN lists l ON l.id = i.list_id
         JOIN users u ON u.id = l.user_id
        WHERE i.is_archived = 0
          AND l.user_id <> ?
          AND EXISTS (
            SELECT 1 FROM list_groups lg
              JOIN group_members gm ON gm.group_id = lg.group_id
             WHERE lg.list_id = l.id AND gm.user_id = ?
          )
        ORDER BY i.created_at DESC
        LIMIT ?`,
    )
    .all(userId, userId, limit) as FeedRow[];
}
