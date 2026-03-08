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
  source: 'usda' | 'web_search' | 'user_estimate';
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  alcoholDrinks?: number;      // number of alcoholic drinks in this entry
  hasSeedOils?: boolean;       // true if meal contains heavy seed oils / deep-fried
  ignored?: boolean;           // soft-delete flag — entry excluded from totals when true
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
  pointsDelta: number;
  notes?: string;
  ignored?: boolean;           // soft-delete flag — entry excluded from totals when true
  timestamp: FieldValue | Timestamp;
  date: string; // "YYYY-MM-DD"
}

export interface UserProfile {
  heightCm?: number;
  weightKg?: number;
  age?: number;
  activityLevel?: 'sedentary' | 'light' | 'moderate' | 'active';
  goals?: string[];
  injuries?: string[];
  dietaryRestrictions?: string[];
  lastConversationSummary?: string;
}
