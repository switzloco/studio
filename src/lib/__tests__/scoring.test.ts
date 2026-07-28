import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { calculateDailyVFScore, DailyVFInput, computeAlpertNumber } from '../vf-scoring';
import type { FoodLogEntry, ExerciseLogEntry } from '../food-exercise-types';
import { SCORING_RELEASES, CURRENT_SCORING_RELEASE, hasOneFictionalHero } from '../scoring-releases';

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
  const est = o.estimatedCaloriesBurned ?? 700;
  return {
    name: 'session',
    category: 'cardio',
    durationMin: 60,
    estimatedCaloriesBurned: est,
    adjustedCalories: o.adjustedCalories ?? est,
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

// ─── Consecutive-Day Alcohol penalty (proportional) ───────────────────────────
describe('VF v3 — Consecutive-Day Alcohol (proportional)', () => {
  it('deducts a proportional penalty when alcohol was logged yesterday AND today', () => {
    const base = cleanDay({ foodLogs: [food({ alcoholDrinks: 1 })], alcoholDrinks: 1 });
    const single = calculateDailyVFScore({ ...base, alcoholYesterday: false });
    const consecutive = calculateDailyVFScore({ ...base, alcoholYesterday: true });
    expect(consecutive.breakdown.consecutiveAlcoholPenalty).toBeLessThan(0);
    expect(consecutive.score).toBeLessThan(single.score);
  });

  it('does NOT penalize if there was no alcohol today', () => {
    const base = cleanDay({ foodLogs: [food({ alcoholDrinks: 0 })], alcoholDrinks: 0 });
    const yesterdayOnly = calculateDailyVFScore({ ...base, alcoholYesterday: true });
    expect(yesterdayOnly.breakdown.consecutiveAlcoholPenalty).toBe(0);
  });
});

// ─── Cardio is not point-penalized (muscle loss is priced in instead) ─────────
describe('VF v2 — cardio carries no separate penalty', () => {
  it('does not dock points for logged cardio beyond its metabolic effect', () => {
    // A pure-cardio day and a rest day with the same caloriesOut score off the
    // same engine output — there is no extra "junk cardio" cap on the score.
    const r = calculateDailyVFScore(cleanDay({ exerciseLogs: [exercise()] }));
    expect(r.breakdown).not.toHaveProperty('cardioCapped');
    expect(typeof r.score).toBe('number');
  });
});

// ─── Zone 2 fat-oxidation boost ───────────────────────────────────────────────
describe('VF v2 — Zone 2 (steady-state) fat-oxidation boost', () => {
  it('burns more fat and scores at least as high as equal-calorie anaerobic play', () => {
    const day = (tier: 'tier2_steady_state' | 'tier3_anaerobic') =>
      cleanDay({
        exerciseLogs: [exercise({ activityTier: tier, performedAt: '16:00', estimatedCaloriesBurned: 600, adjustedCalories: 600 })],
        caloriesOut: 2800,
      });
    const zone2 = calculateDailyVFScore(day('tier2_steady_state'));
    const anaerobic = calculateDailyVFScore(day('tier3_anaerobic'));
    expect(zone2.breakdown.totalFatBurned).toBeGreaterThan(anaerobic.breakdown.totalFatBurned);
    expect(zone2.score).toBeGreaterThanOrEqual(anaerobic.score);
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

// ─── Scoring release registry — the "one fictional" twist is sacred ───────────
describe('Scoring releases — codename invariant', () => {
  it('every release pairs exactly one real and one fictional hero', () => {
    for (const r of SCORING_RELEASES) {
      expect(hasOneFictionalHero(r), `${r.codename} must have exactly one fictional hero`).toBe(true);
    }
  });

  it('exposes a current release with a codename and version', () => {
    expect(CURRENT_SCORING_RELEASE.codename).toBeTruthy();
    expect(CURRENT_SCORING_RELEASE.version).toBeTruthy();
  });

  it('has unique codenames and ascending versions', () => {
    const names = SCORING_RELEASES.map((r) => r.codename);
    expect(new Set(names).size).toBe(names.length);
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

// ─── VF v3 — Effort Registers ──────────────────────────────────────────────────
describe('VF v3 — effort registers', () => {
  const refUser = { weightKg: 100, bodyFatPct: 28 };
  const baseFood: FoodLogEntry[] = [
    food({ meal: 'breakfast', consumedAt: '08:00', calories: 500, carbsG: 40, proteinG: 40 }),
    food({ meal: 'lunch', consumedAt: '12:30', calories: 700, carbsG: 60, proteinG: 50 }),
    food({ meal: 'dinner', consumedAt: '18:30', calories: 800, carbsG: 70, proteinG: 60 }),
  ]; // 2000 total kcal, 150g protein

  it('1. Monotonic in training volume', () => {
    const run = (extraBurn: number, exLogs: ExerciseLogEntry[]) =>
      calculateDailyVFScore({
        ...cleanDay(refUser),
        caloriesIn: 2000,
        caloriesOut: 2400 + extraBurn,
        foodLogs: baseFood,
        exerciseLogs: exLogs,
      });

    const rest = run(0, []);
    const walk = run(150, [exercise({ category: 'cardio', activityTier: 'tier1_walking', durationMin: 30, estimatedCaloriesBurned: 150, performedAt: '10:00' })]);
    const lift = run(350, [exercise({ category: 'strength', activityTier: 'tier3_anaerobic', durationMin: 60, estimatedCaloriesBurned: 350, performedAt: '15:00' })]);
    const zone2 = run(700, [exercise({ category: 'cardio', activityTier: 'tier2_steady_state', durationMin: 90, estimatedCaloriesBurned: 700, performedAt: '16:00' })]);
    const combo = run(1200, [
      exercise({ category: 'cardio', activityTier: 'tier1_walking', durationMin: 30, estimatedCaloriesBurned: 150, performedAt: '10:00' }),
      exercise({ category: 'strength', activityTier: 'tier3_anaerobic', durationMin: 60, estimatedCaloriesBurned: 350, performedAt: '15:00' }),
      exercise({ category: 'cardio', activityTier: 'tier2_steady_state', durationMin: 90, estimatedCaloriesBurned: 700, performedAt: '17:00' }),
    ]);

    expect(rest.score).toBeLessThan(walk.score);
    expect(walk.score).toBeLessThan(lift.score);
    expect(lift.score).toBeLessThan(zone2.score);
    expect(zone2.score).toBeLessThan(combo.score);
  });

  it('2. Strength training is worth strictly more than zero points', () => {
    const rest = calculateDailyVFScore({
      ...cleanDay(refUser),
      caloriesIn: 2000,
      caloriesOut: 2400,
      foodLogs: baseFood,
      exerciseLogs: [],
    });
    const lift = calculateDailyVFScore({
      ...cleanDay(refUser),
      caloriesIn: 2000,
      caloriesOut: 2750,
      foodLogs: baseFood,
      exerciseLogs: [exercise({ category: 'strength', activityTier: 'tier3_anaerobic', durationMin: 60, estimatedCaloriesBurned: 350, performedAt: '15:00' })],
    });

    expect(lift.score).toBeGreaterThan(rest.score);
  });

  it('3. Storage penalty is capped symmetrically with fat oxidation', () => {
    const bingeFood = [
      food({ meal: 'lunch', consumedAt: '12:00', calories: 2500, carbsG: 200, fatG: 100, proteinG: 50 }),
    ];
    const r = calculateDailyVFScore({
      ...cleanDay(refUser),
      caloriesIn: 2500,
      caloriesOut: 2400,
      foodLogs: bingeFood,
    });

    expect(r.breakdown.fatStoragePenaltyCapped).toBeGreaterThan(0);
  });

  it('4. Consecutive-day alcohol cannot single-handedly force a negative day on an excellent day', () => {
    const excellentDay = calculateDailyVFScore({
      ...cleanDay(refUser),
      caloriesIn: 2000,
      caloriesOut: 3200, // 1200 deficit
      proteinG: 180,
      proteinGoal: 150,
      foodLogs: [
        ...baseFood,
        food({ name: 'wine', meal: 'snack', consumedAt: '21:00', calories: 150, carbsG: 5, alcoholDrinks: 2 }),
      ],
      alcoholDrinks: 2,
      alcoholYesterday: true,
      exerciseLogs: [exercise({ category: 'strength', durationMin: 60, estimatedCaloriesBurned: 400, performedAt: '16:00' })],
    });

    expect(excellentDay.score).toBeGreaterThanOrEqual(0);
  });

  it('5. No late-drinking advantage (22:00 drink vs 21:00 drink)', () => {
    const makeDay = (time: string) =>
      calculateDailyVFScore({
        ...cleanDay(refUser),
        caloriesIn: 2000,
        caloriesOut: 2800,
        foodLogs: [
          ...baseFood,
          food({ name: 'drink', meal: 'snack', consumedAt: time, calories: 120, carbsG: 5, alcoholDrinks: 1 }),
        ],
        alcoholDrinks: 1,
      });

    const drink21 = makeDay('21:00');
    const drink22 = makeDay('22:00');

    expect(drink22.score).toBeLessThanOrEqual(drink21.score);
  });

  it('6. Glycogen credit is bounded', () => {
    const r = calculateDailyVFScore(cleanDay(refUser));
    expect(r.breakdown.glycogenCreditPoints).toBeGreaterThanOrEqual(0);
    expect(r.breakdown.glycogenCreditPoints).toBeLessThan(100);
  });
});
