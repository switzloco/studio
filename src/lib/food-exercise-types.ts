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
