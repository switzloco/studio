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
