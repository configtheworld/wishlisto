import type { DB } from '../db/index.js';

/**
 * How much the list owner may learn about a claim, chosen by the claimer:
 *
 * - HIDDEN:  surprise. The owner sees nothing about the claim.
 * - STATUS:  the owner sees the wish is claimed, but not by whom.
 * - NAMED:   the owner sees who claimed it.
 *
 * Everyone who is not the owner sees a claimed wish as taken, never the name.
 * Admins have no route to this data at all.
 */
export const VISIBILITY = { HIDDEN: 0, STATUS: 1, NAMED: 2 } as const;
export type Visibility = (typeof VISIBILITY)[keyof typeof VISIBILITY];

export function parseVisibility(raw: string): Visibility | null {
  if (raw === '0') return VISIBILITY.HIDDEN;
  if (raw === '1') return VISIBILITY.STATUS;
  if (raw === '2') return VISIBILITY.NAMED;
  return null;
}

/**
 * What a particular viewer may learn about an item's claim.
 *
 * - open:     nothing visible (no claim, or a hidden claim seen by the owner)
 * - mine:     the viewer is the claimer; `visibility` says what the owner sees
 * - taken:    someone else claimed it; the claimer's identity stays hidden
 * - claimed:  the owner sees it is claimed, not by whom
 * - revealed: the owner sees the claimer's name
 */
export type ClaimView =
  | { state: 'open' }
  | { state: 'mine'; visibility: Visibility }
  | { state: 'taken' }
  | { state: 'claimed' }
  | { state: 'revealed'; username: string };

interface ClaimRow {
  item_id: string;
  claimer_id: string;
  visibility: number;
  username: string;
}

export function claimViews(
  db: DB,
  itemIds: string[],
  viewer: { userId: string | null; ownerId: string },
): Map<string, ClaimView> {
  const views = new Map<string, ClaimView>();
  if (itemIds.length === 0) return views;
  const placeholders = itemIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT c.item_id, c.claimer_id, c.visibility, u.username
         FROM claims c
         JOIN users u ON u.id = c.claimer_id
        WHERE c.item_id IN (${placeholders})`,
    )
    .all(...itemIds) as ClaimRow[];

  for (const row of rows) {
    if (viewer.userId === viewer.ownerId) {
      if (row.visibility === VISIBILITY.NAMED) views.set(row.item_id, { state: 'revealed', username: row.username });
      else if (row.visibility === VISIBILITY.STATUS) views.set(row.item_id, { state: 'claimed' });
    } else if (row.claimer_id === viewer.userId) {
      views.set(row.item_id, { state: 'mine', visibility: row.visibility as Visibility });
    } else {
      views.set(row.item_id, { state: 'taken' });
    }
  }
  return views;
}

export interface ClaimTarget {
  itemId: string;
  listId: string;
  ownerId: string;
  publicToken: string | null;
  archived: boolean;
}

export function claimTarget(db: DB, itemId: string): ClaimTarget | null {
  const row = db
    .prepare(
      `SELECT i.id AS item_id, i.list_id, i.is_archived, l.user_id AS owner_id, l.public_token
         FROM items i
         JOIN lists l ON l.id = i.list_id
        WHERE i.id = ?`,
    )
    .get(itemId) as
    | { item_id: string; list_id: string; is_archived: number; owner_id: string; public_token: string | null }
    | undefined;
  if (!row) return null;
  return {
    itemId: row.item_id,
    listId: row.list_id,
    ownerId: row.owner_id,
    publicToken: row.public_token,
    archived: row.is_archived === 1,
  };
}

/** Returns 'taken' when another person already holds the claim. */
export function setClaim(
  db: DB,
  itemId: string,
  userId: string,
  visibility: Visibility,
  now = Date.now(),
): 'saved' | 'taken' {
  const existing = db.prepare('SELECT claimer_id FROM claims WHERE item_id = ?').get(itemId) as
    | { claimer_id: string }
    | undefined;
  if (existing && existing.claimer_id !== userId) return 'taken';
  if (existing) {
    db.prepare('UPDATE claims SET visibility = ?, updated_at = ? WHERE item_id = ?').run(visibility, now, itemId);
  } else {
    db.prepare(
      'INSERT INTO claims (item_id, claimer_id, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(itemId, userId, visibility, now, now);
  }
  return 'saved';
}

export function removeClaim(db: DB, itemId: string, userId: string): boolean {
  return db.prepare('DELETE FROM claims WHERE item_id = ? AND claimer_id = ?').run(itemId, userId).changes > 0;
}
