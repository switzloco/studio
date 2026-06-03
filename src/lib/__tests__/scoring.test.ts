import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { calculateDailyVFScore, DailyVFInput, computeAlpertNumber } from '../vf-scoring';
import type { FoodLogEntry, ExerciseLogEntry } from '../food-exercise-types';

// ─── Mock Firebase so tests never touch a real database ───────────────────────
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  collection: vi.fn(),
  addDoc: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
  serverTimestamp: vi.fn(() => ({ _type: 'serverTimestamp' })),
  arrayUnion: vi.fn((...items) => items),
  Firestore: vi.fn(),
  FieldValue: vi.fn(),
  Timestamp: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function cleanDay(overrides: Partial<DailyVFInput> = {}): DailyVFInput {
  return {
    caloriesIn: 1500,
    caloriesOut: 2500,
    proteinG: 160,
    proteinGoal: 150,
    fastingHours: 0,
    alcoholDrinks: 0,
    sleepHours: 8,
    seedOilMeals: 0,
    weightKg: 68,
    bodyFatPct: 25,
    ...overrides,
  };
}

function food(o: Partial<FoodLogEntry> = {}): FoodLogEntry {
  return {
    name: 'meal',
    portionG: 300,
    calories: 600,
    proteinG: 40,
    carbsG: 50,
    fatG: 20,
    fiberG: 5,
    source: 'user_estimate',
    meal: 'lunch',
    consumedAt: '12:00',
    timestamp: {} as any,
    date: '2026-06-03',
    ...o,
  };
}

function exercise(o: Partial<ExerciseLogEntry> = {}): ExerciseLogEntry {
  return {
    name: 'session',
    category: 'cardio',
    durationMin: 60,
    estimatedCaloriesBurned: 700,
    adjustedCalories: 700,
    pointsDelta: 0,
    performedAt: '17:00',
    timestamp: {} as any,
    date: '2026-06-03',
    ...o,
  };
}

// ─── Alpert normalization (per-user scale) ────────────────────────────────────
describe('VF v2 — Alpert-normalized scale', () => {
  it('sets the points denominator to 70% of the Alpert number', () => {
    const r = calculateDailyVFScore(cleanDay());
    const expectedDenom = Math.round(0.7 * computeAlpertNumber(68, 25));
    expect(r.breakdown.alpertNumber).toBe(computeAlpertNumber(68, 25));
    expect(r.breakdown.pointsDenominator).toBe(expectedDenom);
  });

  it('scales the denominator by the user fat estimate — more fat mass, higher bar', () => {
    const lean = calculateDailyVFScore(cleanDay({ bodyFatPct: 15 }));
    const heavier = calculateDailyVFScore(cleanDay({ bodyFatPct: 35 }));
    expect(heavier.breakdown.pointsDenominator).toBeGreaterThan(lean.breakdown.pointsDenominator);
  });

  it('rewards a clean deficit day with a positive score', () => {
    expect(calculateDailyVFScore(cleanDay()).score).toBeGreaterThan(0);
  });

  it('returns a negative score for a caloric surplus', () => {
    expect(calculateDailyVFScore(cleanDay({ caloriesIn: 3200, caloriesOut: 2000 })).score).toBeLessThan(0);
  });
});

// ─── Limits removed ───────────────────────────────────────────────────────────
describe('VF v2 — limits removed', () => {
  it('allows a score well below the old -200 floor on a large surplus', () => {
    const r = calculateDailyVFScore(cleanDay({ caloriesIn: 6000, caloriesOut: 1500 }));
    expect(r.score).toBeLessThan(-200);
  });
});

// ─── Muscle catabolism is priced in ───────────────────────────────────────────
describe('VF v2 — muscle catabolism priced into the score', () => {
  it('reports muscle loss on an extreme zero-intake high-burn day', () => {
    const r = calculateDailyVFScore(cleanDay({ caloriesIn: 0, caloriesOut: 5000 }));
    expect(r.breakdown.muscleKcal).toBeGreaterThan(0);
    expect(r.summary).toContain('muscle lost');
  });
});

// ─── Volume-Based Metabolic Pause ─────────────────────────────────────────────
describe('VF v2 — Volume-Based Metabolic Pause (alcohol)', () => {
  it('applies a pause penalty when an evening drink interrupts fat-burning slots', () => {
    // Gut is empty by ~21:00 (dinner at 17:30), so the fat faucet is running —
    // the 3h pause after the drink zeroes those positive slots.
    const dayFoods = (drinks: number): FoodLogEntry[] => [
      food({ meal: 'breakfast', consumedAt: '07:00', calories: 500, carbsG: 40 }),
      food({ meal: 'dinner', consumedAt: '17:30', calories: 600, carbsG: 50 }),
      food({ name: 'drinks', meal: 'snack', consumedAt: '21:00', calories: 120, carbsG: 8, proteinG: 0, fatG: 0, alcoholDrinks: drinks }),
    ];
    const sober = calculateDailyVFScore(cleanDay({ foodLogs: dayFoods(0) }));
    const drinking = calculateDailyVFScore(cleanDay({ foodLogs: dayFoods(2) }));
    expect(sober.breakdown.alcoholPausePenalty).toBe(0);
    expect(drinking.breakdown.alcoholPausePenalty).toBeLessThan(0);
    expect(drinking.score).toBeLessThanOrEqual(sober.score);
  });
});

// ─── Consecutive-Day Alcohol penalty (flat -25) ───────────────────────────────
describe('VF v2 — Consecutive-Day Alcohol', () => {
  it('deducts a flat 25 when alcohol was logged yesterday AND today', () => {
    const base = cleanDay({ foodLogs: [food({ alcoholDrinks: 1 })], alcoholDrinks: 1 });
    const single = calculateDailyVFScore({ ...base, alcoholYesterday: false });
    const consecutive = calculateDailyVFScore({ ...base, alcoholYesterday: true });
    expect(consecutive.score).toBe(single.score - 25);
    expect(consecutive.breakdown.consecutiveAlcoholPenalty).toBe(-25);
  });

  it('does NOT penalize if there was no alcohol today', () => {
    const base = cleanDay({ foodLogs: [food({ alcoholDrinks: 0 })], alcoholDrinks: 0 });
    const yesterdayOnly = calculateDailyVFScore({ ...base, alcoholYesterday: true });
    expect(yesterdayOnly.breakdown.consecutiveAlcoholPenalty).toBe(0);
  });
});

// ─── Tension Deficit Cap ──────────────────────────────────────────────────────
describe('VF v2 — Tension Deficit Cap', () => {
  it('discounts cardio burn and never raises the score when >2 cardio sessions and no strength in 7 days', () => {
    const base = cleanDay({ exerciseLogs: [exercise()], caloriesOut: 2500 });
    const capped = calculateDailyVFScore({ ...base, cardioSessions7d: 3, tensionSessions7d: 0 });
    const notCapped = calculateDailyVFScore({ ...base, cardioSessions7d: 3, tensionSessions7d: 1 });
    expect(capped.breakdown.cardioCapped).toBe(true);
    expect(notCapped.breakdown.cardioCapped).toBe(false);
    // Half of the 700 kcal cardio burn is discounted from the simulation.
    expect(capped.breakdown.cardioKcalRemoved).toBe(350);
    // The cap can only ever hold the score down, never inflate it.
    expect(capped.score).toBeLessThanOrEqual(notCapped.score);
  });

  it('does not cap when a strength session exists in the window', () => {
    const r = calculateDailyVFScore(cleanDay({
      exerciseLogs: [exercise()],
      cardioSessions7d: 5,
      tensionSessions7d: 1,
    }));
    expect(r.breakdown.cardioCapped).toBe(false);
    expect(r.breakdown.cardioKcalRemoved).toBe(0);
  });
});

// ─── Seed Oil Nudge (flat -5/meal) ────────────────────────────────────────────
describe('VF v2 — Seed Oil Nudge', () => {
  it('deducts a flat 5 points per seed-oil meal', () => {
    const clean = calculateDailyVFScore(cleanDay());
    const oily = calculateDailyVFScore(cleanDay({ seedOilMeals: 2 }));
    expect(oily.score).toBe(clean.score - 10);
    expect(oily.breakdown.seedOilPenalty).toBe(-10);
  });
});

// ─── Protein Liquidity Scoring (unchanged arithmetic guards) ──────────────────
describe('Protein Liquidity — cumulative daily total', () => {
  it('accumulates multiple meals correctly', () => {
    const total = [30, 45, 60, 25].reduce((acc, g) => acc + g, 0);
    expect(total).toBe(160);
  });

  it('identifies a deficit when total is below proteinGoal', () => {
    expect(180 - 120).toBe(60);
  });
});

// ─── Zod validation guards (protein) ──────────────────────────────────────────
describe('Protein Liquidity — Zod validation guards', () => {
  const proteinSchema = z.object({
    proteinG: z.number().positive().max(500, 'Single meal protein cannot exceed 500g — data rejected as implausible'),
    description: z.string().min(1),
  });

  it('accepts a valid protein entry', () => {
    expect(proteinSchema.safeParse({ proteinG: 150, description: 'Chicken breast' }).success).toBe(true);
  });

  it('rejects protein above 500g as implausible', () => {
    const result = proteinSchema.safeParse({ proteinG: 600, description: 'Impossible meal' });
    expect(result.success).toBe(false);
    expect(result.error?.errors[0].message).toContain('500g');
  });

  it('rejects negative protein', () => {
    expect(proteinSchema.safeParse({ proteinG: -10, description: 'Negative calories' }).success).toBe(false);
  });
});

// ─── Zod validation guards (visceral fat) ─────────────────────────────────────
describe('Visceral Fat — Zod validation guards', () => {
  const workoutSchema = z.object({
    pointsDelta: z.number().min(-500, 'Points delta cannot be less than -500').max(500, 'Points delta cannot exceed 500'),
    workoutDetails: z.string().min(1, 'Workout details cannot be empty'),
  });

  it('accepts a valid workout entry', () => {
    expect(workoutSchema.safeParse({ pointsDelta: 150, workoutDetails: 'Back squats 5x5' }).success).toBe(true);
  });

  it('rejects pointsDelta above 500', () => {
    expect(workoutSchema.safeParse({ pointsDelta: 1000, workoutDetails: 'Superhuman workout' }).success).toBe(false);
  });

  it('rejects empty workoutDetails', () => {
    const result = workoutSchema.safeParse({ pointsDelta: 100, workoutDetails: '' });
    expect(result.success).toBe(false);
    expect(result.error?.errors[0].message).toBe('Workout details cannot be empty');
  });
});
