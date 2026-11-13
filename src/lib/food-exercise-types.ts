/**
 * @fileOverview Shared types for the structured food and exercise log collections.
 * Used by both client (health-service.ts) and admin (health-service-admin.ts).
 */

import type { FieldValue, Timestamp } from 'firebase/firestore';

export interface FoodLogEntry {
  id?: string;
  name: string;
  portionG: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  // Raw weight in grams of fruits + vegetables only (Starrett 800g protocol).
  // Apple = 100% of portion. Salad = ~80% portion. Grain dish = 0g. Optional;
  // 0 / undefined means "not tracked".
  plantMassG?: number;
  glycemicIndex?: number;      // 0-100; affects absorption speed and insulin spike
  omega3Mg?: number;           // Omega-3 content (EPA/DHA); anti-inflammatory & sensitivity
  caffeineMg?: number;         // caffeine content; boosts fat oxidation rate
  hasElectrolytes?: boolean;   // true if electrolytes were supplemented
  betaAlanineG?: number;       // Beta-alanine (g) — rate-limiting precursor for intramuscular carnosine saturation (179g target)
  creatineG?: number;          // Creatine monohydrate (g) — phosphocreatine & cell-volumization saturation
  source: 'usda' | 'web_search' | 'user_estimate';
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  alcoholDrinks?: number;      // number of alcoholic drinks in this entry
  hasSeedOils?: boolean;       // true if meal contains heavy seed oils / deep-fried
  ignored?: boolean;           // soft-delete flag — entry excluded from totals when true
  consumedAt?: string;         // HH:MM (24h) — when the user actually ate, from conversation context
  /** Hybrid AI execution metadata for CRT audit receipt badges */
  inferenceSource?: 'ON_DEVICE' | 'IN_CLOUD';
  inferenceLatencyMs?: number;
  cfoClass?: 'CAPITAL_ASSET_INFLOW' | 'LIABILITY_EXPOSURE' | 'CAPITAL_CAPEX' | 'OPERATING_FUEL';
  timestamp: FieldValue | Timestamp;
  date: string; // "YYYY-MM-DD" for date-range queries
}

/**
 * An immutable snapshot of a single food entry, embedded in a shared meal.
 * Deliberately omits the source row's `id`/`timestamp`/`date`/`ignored` — a
 * share is a stable copy, decoupled from the originating ledger entry (which
 * may later be edited or soft-deleted).
 */
export type SharedMealItem = Omit<FoodLogEntry, 'id' | 'timestamp' | 'date' | 'ignored'>;

/**
 * A publicly shareable meal: a token-addressable snapshot of one or more
 * food entries that anyone with the link can view and log to their own day.
 * Lives at the ROOT `shared_meals/{id}` collection (not under `users/`) because
 * it is read cross-user. The document ID doubles as the unguessable link token.
 */
export interface SharedMeal {
  id: string;
  createdBy: string;          // sharer UID
  createdByName?: string;     // display name for attribution ("Nick shared…")
  createdAt: FieldValue | Timestamp;
  items: SharedMealItem[];    // immutable snapshot, 1..n entries
  title: string;              // human label for the share
  totals: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
  };
  visibility: 'link';         // v1: anyone with the link can view
  logCount: number;           // how many people logged this (social proof)
  viewCount: number;
  cfoAssessment?: string;     // cached CFO welcome greeting (immutable meal → generated once)
  revoked?: boolean;          // when true, the link no longer resolves
  expiresAt?: FieldValue | Timestamp | null;
}

export interface ExerciseLogEntry {
  id?: string;
  name: string;
  category: 'strength' | 'conditioning' | 'recovery' | 'cardio';
  sets?: number;
  reps?: number;
  durationMin?: number;
  weightKg?: number;
  estimatedCaloriesBurned?: number;
  adjustedCalories?: number;   // post-tier-discount calorie burn stored by log_exercise
  activityTier?: 'tier1_walking' | 'tier2_steady_state' | 'tier3_anaerobic';
  pointsDelta: number;
  notes?: string;
  ignored?: boolean;           // soft-delete flag — entry excluded from totals when true
  performedAt?: string;        // HH:MM (24h) — when the user actually exercised, from conversation context
  /** Hybrid AI execution metadata for CRT audit receipt badges */
  inferenceSource?: 'ON_DEVICE' | 'IN_CLOUD';
  inferenceLatencyMs?: number;
  cfoClass?: 'CAPITAL_ASSET_INFLOW' | 'LIABILITY_EXPOSURE' | 'CAPITAL_CAPEX' | 'OPERATING_FUEL';
  timestamp: FieldValue | Timestamp;
  date: string; // "YYYY-MM-DD"
}

export interface FastLogEntry {
  id?: string;
  startedAt: string;        // "HH:MM" (24h) — when the fast began
  endedAt?: string;         // "HH:MM" (24h) — when the fast ended (omit = ongoing)
  durationHours?: number;   // computed duration; omit when fast is still active
  date: string;             // "YYYY-MM-DD" of the start day
  endDate?: string;         // "YYYY-MM-DD" only if fast spans midnight
  notes?: string;
  ignored?: boolean;
  timestamp: FieldValue | Timestamp;
}

/**
 * A single persisted chat message. The transcript is for human visibility and
 * cheap day-to-day continuity — it is NOT the AI's source of truth (structured
 * food/exercise logs are). Photos are deliberately stored as a marker only:
 * base64 data URIs are megabytes each and would blow the 1MB Firestore doc
 * limit and make re-sends expensive.
 */
export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  hasImages?: boolean;   // true when the original message carried photos (base64 never stored)
  ts?: number;           // epoch ms when the message was recorded (ordering / display)
  inferenceSource?: 'ON_DEVICE' | 'IN_CLOUD';
  inferenceLatencyMs?: number;
}

/**
 * One chat document per calendar day. Doc ID == `date` (YYYY-MM-DD), mirroring
 * the date-keyed food/exercise/fast logs. The day is the conversation.
 */
export interface ChatSession {
  date: string;          // "YYYY-MM-DD" — also the Firestore document ID
  messages: ChatMessage[];
  updatedAt?: FieldValue | Timestamp;
}

export interface UserProfile {
  heightCm?: number;
  weightKg?: number;
  age?: number;
  activityLevel?: 'sedentary' | 'light' | 'moderate' | 'active';
  goals?: string[];
  injuries?: string[];
  dietaryRestrictions?: string[];
  hasCreatine?: boolean;    // true if supplementing daily (increases glycogen cap)
  lastConversationSummary?: string;
  motivationalWhy?: string; // The user's personal "why" — their deeper reason for pursuing their goals
}

/**
 * Clinical cumulative beta-alanine intake (grams) required for full (~60-80% increase)
 * intramuscular carnosine saturation (Harris et al. / Stellingwerff et al. meta-analysis).
 */
export const CARNOSINE_SATURATION_TARGET_G = 179;

export interface CarnosineSaturationState {
  cumulativeGrams: number;
  targetGrams: number;
  saturationPct: number;
  todayGrams: number;
  daysLogged: number;
  remainingGrams: number;
  daysToSaturationAt4g: number;
}

/**
 * Extracts grams of beta-alanine from a FoodLogEntry, checking both the explicit
 * `betaAlanineG` field and any "Beta-Alanine (4g)" / "4g beta alanine" pattern in `name`.
 */
export function extractBetaAlanineG(entry: Partial<FoodLogEntry> | Record<string, any>): number {
  if (entry.ignored) return 0;
  if (typeof entry.betaAlanineG === 'number' && entry.betaAlanineG > 0) {
    return entry.betaAlanineG;
  }
  const name = String(entry.name || '').toLowerCase();
  if (!name.includes('beta alanine') && !name.includes('beta-alanine')) return 0;
  const match = name.match(/(\d+(?:\.\d+)?)\s*g\b/);
  if (match) return Number(match[1]) || 0;
  if (typeof entry.portionG === 'number' && entry.portionG > 0 && entry.portionG <= 15) {
    return entry.portionG;
  }
  return 3.2; // standard clinical single dose fallback
}

/**
 * Parse structured supplement fields from a free-text item name (and optional gram portion).
 * Lets users drop supplements directly into the Quick Log or custom food log (e.g.
 * "Beta-Alanine 4g", "Creatine 5g", "Omega-3 2000mg", "Caffeine 200mg", "LMNT Electrolytes").
 */
export function parseSupplementFieldsFromText(
  rawName: string,
  portionG?: number
): Partial<Pick<FoodLogEntry, 'betaAlanineG' | 'creatineG' | 'caffeineMg' | 'omega3Mg' | 'hasElectrolytes'>> {
  const name = String(rawName || '').toLowerCase();
  const out: Partial<Pick<FoodLogEntry, 'betaAlanineG' | 'creatineG' | 'caffeineMg' | 'omega3Mg' | 'hasElectrolytes'>> = {};

  if (name.includes('beta alanine') || name.includes('beta-alanine') || /\bba\b/.test(name)) {
    const match = name.match(/(\d+(?:\.\d+)?)\s*g\b/);
    if (match) {
      out.betaAlanineG = Number(match[1]) || 3.2;
    } else if (typeof portionG === 'number' && portionG > 0 && portionG <= 15) {
      out.betaAlanineG = portionG;
    } else {
      out.betaAlanineG = 3.2;
    }
  }

  if (name.includes('creatine')) {
    const match = name.match(/(\d+(?:\.\d+)?)\s*g\b/);
    if (match) {
      out.creatineG = Number(match[1]) || 5;
    } else if (typeof portionG === 'number' && portionG > 0 && portionG <= 20) {
      out.creatineG = portionG;
    } else {
      out.creatineG = 5;
    }
  }

  if (name.includes('caffeine') || name.includes('pre-workout') || name.includes('preworkout')) {
    const mgMatch = name.match(/(\d+(?:\.\d+)?)\s*mg\b/);
    if (mgMatch) {
      out.caffeineMg = Math.round(Number(mgMatch[1]) || 150);
    } else {
      out.caffeineMg = 150;
    }
  }

  if (
    name.includes('omega-3') ||
    name.includes('omega 3') ||
    name.includes('omega3') ||
    name.includes('fish oil') ||
    name.includes('krill oil') ||
    /\bepa\b/.test(name) ||
    /\bdha\b/.test(name)
  ) {
    const mgMatch = name.match(/(\d+(?:\.\d+)?)\s*mg\b/);
    const gMatch = name.match(/(\d+(?:\.\d+)?)\s*g\b/);
    if (mgMatch) {
      out.omega3Mg = Math.round(Number(mgMatch[1]) || 1000);
    } else if (gMatch) {
      out.omega3Mg = Math.round((Number(gMatch[1]) || 1) * 1000);
    } else {
      out.omega3Mg = 1000;
    }
  }

  if (
    name.includes('electrolyte') ||
    name.includes('lmnt') ||
    name.includes('liquid iv') ||
    name.includes('nuun') ||
    name.includes('sea salt')
  ) {
    out.hasElectrolytes = true;
  }

  return out;
}

/**
 * Returns human-readable supplement badges for a FoodLogEntry so supplements
 * show up clearly in the Transaction Ledger and Today's Logged strip.
 */
export function formatSupplementBadges(entry: Partial<FoodLogEntry> | Record<string, any>): string[] {
  if (!entry || entry.ignored) return [];
  const badges: string[] = [];
  const ba = extractBetaAlanineG(entry);
  if (ba > 0) badges.push(`Beta-Alanine ${ba}g`);
  if (typeof entry.creatineG === 'number' && entry.creatineG > 0) {
    badges.push(`Creatine ${entry.creatineG}g`);
  }
  if (typeof entry.omega3Mg === 'number' && entry.omega3Mg > 0) {
    badges.push(`Omega-3 ${entry.omega3Mg}mg`);
  }
  if (typeof entry.caffeineMg === 'number' && entry.caffeineMg > 0) {
    badges.push(`Caffeine ${entry.caffeineMg}mg`);
  }
  if (entry.hasElectrolytes) {
    badges.push('Electrolytes');
  }
  return badges;
}

/** Parse "HH:MM" (24h) into minutes since midnight (0..1439). */
export function hhmmToMinutes(hhmm?: string, fallbackMinutes = 12 * 60): number {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm.trim())) return fallbackMinutes;
  const [h, m] = hhmm.trim().split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallbackMinutes;
  return Math.max(0, Math.min(23 * 60 + 59, h * 60 + m));
}

/** Format minutes since midnight (0..1439) into "HH:MM" (24h), optionally snapped to `stepMin`. */
export function minutesToHHMM(totalMinutes: number, stepMin = 1): string {
  const stepped = stepMin > 1 ? Math.round(totalMinutes / stepMin) * stepMin : Math.round(totalMinutes);
  const clamped = Math.max(0, Math.min(23 * 60 + 59, stepped));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Format "HH:MM" (24h) into 12-hour display label like "9:00 PM". */
export function formatHHMM12h(hhmm?: string): string {
  const mins = hhmmToMinutes(hhmm, 12 * 60);
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Infer default meal label from 24-hour "HH:MM" time. */
export function inferMealFromTime(hhmm: string): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const mins = hhmmToMinutes(hhmm, 12 * 60);
  if (mins >= 5 * 60 && mins < 11 * 60) return 'breakfast';
  if (mins >= 11 * 60 && mins < 15 * 60) return 'lunch';
  if (mins >= 17 * 60 + 30 && mins < 22 * 60) return 'dinner';
  return 'snack';
}

/**
 * Given the neighboring entries around a drop position in the Transaction Ledger
 * (sorted newest-first), compute the target `date` and interpolated `HH:MM` time.
 */
export function interpolateSlotTiming(params: {
  aboveEntry?: { date: string; time?: string };
  belowEntry?: { date: string; time?: string };
  preferDate?: string;
  fallbackDate: string;
}): { date: string; time: string } {
  const { aboveEntry, belowEntry, preferDate, fallbackDate } = params;

  if (aboveEntry && belowEntry) {
    if (aboveEntry.date === belowEntry.date) {
      const aMin = hhmmToMinutes(aboveEntry.time, 18 * 60);
      const bMin = hhmmToMinutes(belowEntry.time, 12 * 60);
      const mid = Math.round((aMin + bMin) / 2);
      return {
        date: aboveEntry.date,
        time: minutesToHHMM(mid, 5),
      };
    }
    // Boundary between two different dates
    const targetDate = preferDate || belowEntry.date;
    if (targetDate === belowEntry.date) {
      const bMin = hhmmToMinutes(belowEntry.time, 20 * 60);
      return {
        date: belowEntry.date,
        time: minutesToHHMM(Math.min(23 * 60 + 30, bMin + 30), 5),
      };
    }
    const aMin = hhmmToMinutes(aboveEntry.time, 9 * 60);
    return {
      date: aboveEntry.date,
      time: minutesToHHMM(Math.max(6 * 60, aMin - 30), 5),
    };
  }

  if (belowEntry) {
    const bMin = hhmmToMinutes(belowEntry.time, 12 * 60);
    return {
      date: preferDate || belowEntry.date,
      time: minutesToHHMM(Math.min(23 * 60 + 45, bMin + 15), 5),
    };
  }

  if (aboveEntry) {
    const aMin = hhmmToMinutes(aboveEntry.time, 20 * 60);
    return {
      date: preferDate || aboveEntry.date,
      time: minutesToHHMM(Math.max(6 * 60, aMin - 30), 5),
    };
  }

  return {
    date: preferDate || fallbackDate,
    time: '20:30',
  };
}

/**
 * Computes intramuscular carnosine saturation progress from a list of food log entries.
 */
export function computeCarnosineSaturation(
  entries: Array<Partial<FoodLogEntry> | Record<string, any>>,
  todayStr: string
): CarnosineSaturationState {
  let cumulativeGrams = 0;
  let todayGrams = 0;
  const distinctDates = new Set<string>();

  for (const e of entries) {
    const g = extractBetaAlanineG(e);
    if (g > 0) {
      cumulativeGrams += g;
      if (e.date) distinctDates.add(String(e.date));
      if (e.date === todayStr) todayGrams += g;
    }
  }

  const roundedCum = Math.round(cumulativeGrams * 10) / 10;
  const roundedToday = Math.round(todayGrams * 10) / 10;
  const saturationPct = Math.min(
    100,
    Math.round((roundedCum / CARNOSINE_SATURATION_TARGET_G) * 1000) / 10
  );
  const remainingGrams = Math.max(0, Math.round((CARNOSINE_SATURATION_TARGET_G - roundedCum) * 10) / 10);
  const daysToSaturationAt4g = Math.max(0, Math.ceil(remainingGrams / 4));

  return {
    cumulativeGrams: roundedCum,
    targetGrams: CARNOSINE_SATURATION_TARGET_G,
    saturationPct,
    todayGrams: roundedToday,
    daysLogged: distinctDates.size,
    remainingGrams,
    daysToSaturationAt4g,
  };
}
