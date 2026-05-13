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
 * User-defined performance metric (e.g. basketball shooting %, golf putts).
 * The def doc lives at /users/{uid}/custom_metric_defs/{metricKey} and pins
 * the canonical label + unit so repeated logs don't fragment ("bball %" vs
 * "shooting pct"). Logs live at /users/{uid}/custom_metric_log/{auto}.
 */
export interface CustomMetricDef {
  metricKey: string;         // lowercase_snake — stable identifier (also the doc id)
  metricLabel: string;       // human display label
  unit: string;              // "%", "makes", "min", "rpe", "count", etc.
  higherIsBetter?: boolean;  // helps the analyst interpret trends
  createdAt: FieldValue | Timestamp;
  updatedAt: FieldValue | Timestamp;
}

export interface CustomMetricEntry {
  id?: string;
  metricKey: string;                   // FK to CustomMetricDef.metricKey
  value: number;                       // primary numeric value
  secondary?: Record<string, number>;  // optional structured fields (e.g. { makes: 12, attempts: 20 })
  notes?: string;
  date: string;                        // "YYYY-MM-DD"
  performedAt?: string;                // "HH:MM" (24h)
  ignored?: boolean;
  timestamp: FieldValue | Timestamp;
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
