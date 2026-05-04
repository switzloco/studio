import { getAdminFirestore } from '@/firebase/admin';

/**
 * @fileOverview Per-user rate limiting backed by a single Firestore doc per uid.
 * Each request runs a transaction that reads the current counters, checks all
 * three windows (minute/hour/day), and either rejects with a Retry-After
 * value or increments. Buckets are independent so chat abuse can't exhaust
 * transcribe quota and vice versa.
 */

type WindowConfig = { max: number; windowMs: number };
type BucketConfig = { minute: WindowConfig; hour: WindowConfig; day: WindowConfig };

const LIMITS: Record<RateLimitBucket, BucketConfig> = {
  // Chat covers /api/chat and /api/ledger-chat — moderate per-call cost.
  chat: {
    minute: { max: 20,  windowMs: 60_000 },
    hour:   { max: 200, windowMs: 60 * 60_000 },
    day:    { max: 500, windowMs: 24 * 60 * 60_000 },
  },
  // Transcribe is much more expensive per call (audio tokens), so cap tighter.
  transcribe: {
    minute: { max: 5,   windowMs: 60_000 },
    hour:   { max: 30,  windowMs: 60 * 60_000 },
    day:    { max: 100, windowMs: 24 * 60 * 60_000 },
  },
};

export type RateLimitBucket = 'chat' | 'transcribe';
export type RateLimitScope = 'minute' | 'hour' | 'day';

export type RateLimitResult =
  | { ok: true }
  | { ok: false; bucket: RateLimitBucket; scope: RateLimitScope; retryAfter: number };

interface WindowState {
  count: number;
  windowStart: number;
}

export async function checkRateLimit(uid: string, bucket: RateLimitBucket): Promise<RateLimitResult> {
  const db = getAdminFirestore();
  const ref = db.doc(`rate_limits/${uid}`);
  const config = LIMITS[bucket];
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.exists ? snap.data() : {}) as Record<string, unknown>;
    const bucketData = (data[bucket] ?? {}) as Record<RateLimitScope, WindowState | undefined>;

    const next: Record<RateLimitScope, WindowState> = {} as Record<RateLimitScope, WindowState>;

    for (const scope of ['minute', 'hour', 'day'] as RateLimitScope[]) {
      const { max, windowMs } = config[scope];
      const prev = bucketData[scope];
      const windowExpired = !prev || now - prev.windowStart >= windowMs;
      const currentCount = windowExpired ? 0 : prev.count;

      if (currentCount >= max) {
        const windowStart = prev?.windowStart ?? now;
        const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
        return { ok: false, bucket, scope, retryAfter };
      }

      next[scope] = {
        count: currentCount + 1,
        windowStart: windowExpired ? now : prev!.windowStart,
      };
    }

    tx.set(ref, { [bucket]: next, lastRequestAt: now }, { merge: true });
    return { ok: true };
  });
}
