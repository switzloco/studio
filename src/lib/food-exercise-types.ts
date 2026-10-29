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
