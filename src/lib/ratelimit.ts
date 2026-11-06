import type { DB } from '../db/index.js';

export interface ThrottlePolicy {
  /** Failures allowed inside the window before backoff begins. */
  limit: number;
  windowMs: number;
  backoffBaseMs?: number;
  maxBackoffMs?: number;
}

export interface ThrottleState {
  allowed: boolean;
  retryAfterSec: number;
  failures: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function maybePrune(db: DB, now: number): void {
  if (Math.random() > 0.03) return;
  db.prepare('DELETE FROM rate_events WHERE at < ?').run(now - DAY_MS);
}

export function recordRateEvent(db: DB, bucket: string, now = Date.now()): void {
  db.prepare('INSERT INTO rate_events (bucket, at) VALUES (?, ?)').run(bucket, now);
  maybePrune(db, now);
}

export function countRateEvents(db: DB, bucket: string, since: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count, MAX(at) AS last FROM rate_events WHERE bucket = ? AND at >= ?')
    .get(bucket, since) as { count: number; last: number | null };
  return row.count;
}

export function rateEventStats(db: DB, bucket: string, since: number): { count: number; last: number | null; first: number | null } {
  return db
    .prepare('SELECT COUNT(*) AS count, MAX(at) AS last, MIN(at) AS first FROM rate_events WHERE bucket = ? AND at >= ?')
    .get(bucket, since) as { count: number; last: number | null; first: number | null };
}

export function clearRateEvents(db: DB, bucket: string): void {
  db.prepare('DELETE FROM rate_events WHERE bucket = ?').run(bucket);
}

/**
 * Sliding-window throttle whose cooldown grows exponentially after the limit is reached.
 * The delay is measured from the most recent failure, so hammering never shortens it.
 */
export function checkThrottle(db: DB, bucket: string, policy: ThrottlePolicy, now = Date.now()): ThrottleState {
  const since = now - policy.windowMs;
  const { count, last } = rateEventStats(db, bucket, since);
  if (count < policy.limit) return { allowed: true, retryAfterSec: 0, failures: count };

  const base = policy.backoffBaseMs ?? 30_000;
  const max = policy.maxBackoffMs ?? 15 * 60_000;
  const exponent = Math.min(count - policy.limit, 16);
  const delay = Math.min(max, base * 2 ** exponent);
  const elapsed = last === null ? Number.POSITIVE_INFINITY : now - last;
  if (elapsed >= delay) return { allowed: true, retryAfterSec: 0, failures: count };
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((delay - elapsed) / 1000)), failures: count };
}

/** A plain sliding window without backoff, used for signup / recovery / preview quotas. */
export function checkWindow(db: DB, bucket: string, limit: number, windowMs: number, now = Date.now()): ThrottleState {
  const since = now - windowMs;
  const { count, first } = rateEventStats(db, bucket, since);
  if (count < limit) return { allowed: true, retryAfterSec: 0, failures: count };
  const elapsed = first === null ? 0 : now - first;
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)), failures: count };
}

export interface FailureBucket {
  bucket: string;
  policy: ThrottlePolicy;
}

export function checkBuckets(db: DB, buckets: FailureBucket[], now = Date.now()): { allowed: boolean; retryAfterSec: number } {
  let retryAfterSec = 0;
  for (const { bucket, policy } of buckets) {
    const state = checkThrottle(db, bucket, policy, now);
    if (!state.allowed) retryAfterSec = Math.max(retryAfterSec, state.retryAfterSec);
  }
  return { allowed: retryAfterSec === 0, retryAfterSec };
}
