/**
 * @fileOverview Stateless HMAC token signing + IANA timezone helpers for
 * 3x/day automated Email & Discord outreach.
 */

import crypto from 'crypto';
import type { OutreachWindow } from './health-service';

export type OutreachActionType =
  | 'unsubscribe'
  | 'pause_7d'
  | 'morning_only'
  | 'resume_3x'
  | 'protein_40'
  | 'protein_45_lunch'
  | 'eggs_breakfast'
  | 'same_breakfast'
  | 'dinner_standard'
  | 'still_fasting'
  | 'kitchen_closed'
  | 'undo_food'
  | 'view_ledger';

export interface OutreachTokenPayload {
  uid: string;
  action: OutreachActionType;
  /** Target local YYYY-MM-DD for meal presets / idempotency. */
  date?: string;
  /** Dispatch window that minted this quick-action link. */
  window?: OutreachWindow;
  /** Specific food_log doc ID when action === 'undo_food'. */
  foodId?: string;
  /** Expiration Unix epoch seconds. */
  exp: number;
}

function getSigningSecret(): string {
  const secret =
    process.env.OUTREACH_TOKEN_SECRET ||
    process.env.CRON_SECRET ||
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||
    'cfo-fitness-outreach-dev-secret';
  return secret;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf8');
}

/**
 * Signs an outreach action payload with HMAC-SHA256.
 * Control actions (unsubscribe, pause, cadence) default to 365-day validity so old
 * emails always honor 1-click cancel; meal quick-log actions default to 7 days.
 */
export function signOutreachToken(
  payload: Omit<OutreachTokenPayload, 'exp'> & { exp?: number; ttlSeconds?: number },
): string {
  const isControlAction =
    payload.action === 'unsubscribe' ||
    payload.action === 'pause_7d' ||
    payload.action === 'morning_only' ||
    payload.action === 'resume_3x' ||
    payload.action === 'view_ledger';

  const defaultTtl = isControlAction ? 365 * 24 * 3600 : 7 * 24 * 3600;
  const exp = payload.exp ?? Math.floor(Date.now() / 1000) + (payload.ttlSeconds ?? defaultTtl);

  const cleanPayload: OutreachTokenPayload = {
    uid: payload.uid,
    action: payload.action,
    ...(payload.date ? { date: payload.date } : {}),
    ...(payload.window ? { window: payload.window } : {}),
    ...(payload.foodId ? { foodId: payload.foodId } : {}),
    exp,
  };

  const encodedBody = base64UrlEncode(JSON.stringify(cleanPayload));
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encodedBody)
    .digest();
  return `${encodedBody}.${base64UrlEncode(sig)}`;
}

/**
 * Verifies an HMAC-signed outreach token and checks expiration.
 * Returns null if tampered, malformed, or expired.
 */
export function verifyOutreachToken(
  token: string | null | undefined,
  nowEpochSec = Math.floor(Date.now() / 1000),
): OutreachTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0 || dotIdx === token.length - 1) return null;

  const encodedBody = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);

  const expectedSigBuf = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encodedBody)
    .digest();
  const expectedSig = base64UrlEncode(expectedSigBuf);

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedBody)) as OutreachTokenPayload;
    if (!parsed || typeof parsed.uid !== 'string' || !parsed.uid || typeof parsed.exp !== 'number') {
      return null;
    }
    if (parsed.exp < nowEpochSec) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export interface LocalClock {
  timezone: string;
  localDate: string;      // "YYYY-MM-DD"
  localTime: string;      // "HH:MM" (24h)
  hour: number;           // 0..23
  minute: number;         // 0..59
  hoursElapsed: number;   // decimal hours since midnight, e.g. 12.5
}

export function normalizeTimezone(tz?: string | null): string {
  const candidate = (tz || '').trim() || 'America/Los_Angeles';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'America/Los_Angeles';
  }
}

/**
 * Resolves a UTC Date into the user's local calendar date and 24h clock time.
 */
export function resolveLocalClock(now: Date = new Date(), rawTimezone?: string | null): LocalClock {
  const timezone = normalizeTimezone(rawTimezone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const rawHour = Number(get('hour'));
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(get('minute'));

  const localDate = `${year}-${month}-${day}`;
  const localTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const hoursElapsed = Math.round((hour + minute / 60) * 100) / 100;

  return {
    timezone,
    localDate,
    localTime,
    hour,
    minute,
    hoursElapsed,
  };
}

/** Add or subtract days from a YYYY-MM-DD date string. */
export function addIsoDays(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

/** Whole calendar days between two YYYY-MM-DD strings (toIso - fromIso). */
export function diffIsoDays(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  const ms1 = Date.UTC(y1, (m1 || 1) - 1, d1 || 1);
  const ms2 = Date.UTC(y2, (m2 || 1) - 1, d2 || 1);
  return Math.round((ms2 - ms1) / 86_400_000);
}
