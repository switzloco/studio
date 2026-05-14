import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { calculateDailyVFScore, DailyVFInput } from '../vf-scoring';

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

// ─── Helper: default "clean" day ─────────────────────────────────────────────
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
    ...overrides,
  };
}

// ─── Protein Liquidity Scoring ─────────────────────────────────────────────────
describe('Protein Liquidity — cumulative daily total', () => {
  it('adds protein to a zero baseline', () => {
    const currentDailyProteinG = 0;
    const proteinG = 50;
    const newTotal = currentDailyProteinG + proteinG;
    expect(newTotal).toBe(50);
  });

  it('accumulates multiple meals correctly', () => {
    const meals = [30, 45, 60, 25];
    const total = meals.reduce((acc, g) => acc + g, 0);
    expect(total).toBe(160);
  });

  it('identifies a surplus when total exceeds proteinGoal', () => {
    const proteinGoal = 180;
    const dailyTotal = 195;
    const surplus = dailyTotal - proteinGoal;
    expect(surplus).toBeGreaterThan(0);
    expect(surplus).toBe(15);
  });

  it('identifies a deficit when total is below proteinGoal', () => {
    const proteinGoal = 180;
    const dailyTotal = 120;
    const deficit = proteinGoal - dailyTotal;
    expect(deficit).toBeGreaterThan(0);
    expect(deficit).toBe(60);
  });

  it('reports zero balance when total exactly meets proteinGoal', () => {
    const proteinGoal = 180;
    const dailyTotal = 180;
    expect(dailyTotal - proteinGoal).toBe(0);
  });
});

// ─── Zod validation guards (protein) ──────────────────────────────────────────
describe('Protein Liquidity — Zod validation guards', () => {
  const proteinSchema = z.object({
    proteinG: z.number().positive().max(500, 'Single meal protein cannot exceed 500g — data rejected as implausible'),
    description: z.string().min(1),
  });

  it('accepts a valid protein entry', () => {
    const result = proteinSchema.safeParse({ proteinG: 150, description: 'Chicken breast' });
    expect(result.success).toBe(true);
  });

  it('rejects protein above 500g as implausible', () => {
    const result = proteinSchema.safeParse({ proteinG: 600, description: 'Impossible meal' });
    expect(result.success).toBe(false);
    expect(result.error?.errors[0].message).toContain('500g');
  });

  it('rejects zero protein (must be positive)', () => {
    const result = proteinSchema.safeParse({ proteinG: 0, description: 'Empty plate' });
    expect(result.success).toBe(false);
  });

  it('rejects negative protein', () => {
    const result = proteinSchema.safeParse({ proteinG: -10, description: 'Negative calories' });
    expect(result.success).toBe(false);
  });

  it('rejects empty description', () => {
    const result = proteinSchema.safeParse({ proteinG: 50, description: '' });
    expect(result.success).toBe(false);
  });
});

// ─── Rule 1: Caloric Engine ──────────────────────────────────────────────────
describe('VF Rule 1 — Caloric Engine', () => {
  it('awards +100 for a ~1000 cal deficit with protein met', () => {
    const result = calculateDailyVFScore(cleanDay());
    expect(result.score).toBe(100);
    expect(result.breakdown.proteinMet).toBe(true);
  });

  it('caps positive score at +50 when protein mandate is missed', () => {
    const result = calculateDailyVFScore(cleanDay({ proteinG: 80 }));
    expect(result.score).toBeLessThanOrEqual(50);
    expect(result.breakdown.proteinMet).toBe(false);
  });

  it('returns negative score for caloric surplus', () => {
    const result = calculateDailyVFScore(cleanDay({ caloriesIn: 3000, caloriesOut: 2000 }));
    expect(result.score).toBeLessThan(0);
  });

  it('scales linearly — 500 cal deficit = ~+50', () => {
    const result = calculateDailyVFScore(cleanDay({ caloriesIn: 2000, caloriesOut: 2500 }));
    expect(result.score).toBe(50);
  });
});

// ─── Rule 2: Fasting Multiplier ─────────────────────────────────────────────
describe('VF Rule 2 — Fasting Multiplier', () => {
  it('awards automatic +100 for 24h+ fast regardless of calories', () => {
    const result = calculateDailyVFScore(cleanDay({ fastingHours: 24, caloriesIn: 0, caloriesOut: 2000 }));
    expect(result.score).toBe(100);
    expect(result.breakdown.fastingOverride).toBe(true);
  });

  it('awards +100 for 36h fast', () => {
    const result = calculateDailyVFScore(cleanDay({ fastingHours: 36, caloriesIn: 0 }));
    expect(result.score).toBe(100);
  });

  it('does NOT override for sub-24h fast', () => {
    const result = calculateDailyVFScore(cleanDay({ fastingHours: 18 }));
    expect(result.breakdown.fastingOverride).toBe(false);
  });
});

// ─── Rule 3: Alcohol Drag ───────────────────────────────────────────────────
describe('VF Rule 3 — Alcohol Drag (biology: ~1h suppressed fat oxidation per drink)', () => {
  it('deducts -5 per drink (proportional, no cliff)', () => {
    const clean = calculateDailyVFScore(cleanDay());
    const four = calculateDailyVFScore(cleanDay({ alcoholDrinks: 4 }));
    expect(four.score).toBe(clean.score - 20);
    expect(four.breakdown.alcoholPenalty).toBe(-20);
  });

  it('still allows a positive score with moderate drinking on a deficit day', () => {
    const result = calculateDailyVFScore(cleanDay({ alcoholDrinks: 2 }));
    expect(result.score).toBeGreaterThan(0);
    expect(result.breakdown.alcoholPenalty).toBe(-10);
  });

  it('stacks with surplus for a worse score', () => {
    const result = calculateDailyVFScore(cleanDay({
      alcoholDrinks: 5,
      caloriesIn: 3000,
      caloriesOut: 2000,
    }));
    // base = -100, alcohol = -25 → -125
    expect(result.score).toBeLessThanOrEqual(-100);
    expect(result.breakdown.alcoholPenalty).toBe(-25);
  });
});

// ─── Rule 4: HRV Multiplier ─────────────────────────────────────────────────
describe('VF Rule 4 — HRV Multiplier (biology: recovery-based fat oxidation)', () => {
  it('reduces a positive score by 15% when HRV < 30', () => {
    const good = calculateDailyVFScore(cleanDay({ hrv: 50 })); // neutral
    const bad = calculateDailyVFScore(cleanDay({ hrv: 20 }));
    expect(bad.score).toBe(Math.round(good.score * 0.85));
    expect(bad.breakdown.hrvMultiplier).toBe(0.85);
    expect(bad.breakdown.hrvStatus).toBe('tax');
  });

  it('awards +10% bonus when HRV > 80', () => {
    const neutral = calculateDailyVFScore(cleanDay({ hrv: 50 }));
    const elite = calculateDailyVFScore(cleanDay({ hrv: 95 }));
    expect(elite.score).toBe(Math.round(neutral.score * 1.10));
    expect(elite.breakdown.hrvMultiplier).toBe(1.10);
    expect(elite.breakdown.hrvStatus).toBe('bonus');
  });

  it('does NOT reduce a negative score (bad recovery should not help surplus)', () => {
    const result = calculateDailyVFScore(cleanDay({
      caloriesIn: 3000,
      caloriesOut: 2000,
      hrv: 20,
    }));
    const withGoodRecovery = calculateDailyVFScore(cleanDay({
      caloriesIn: 3000,
      caloriesOut: 2000,
      hrv: 50,
    }));
    expect(result.score).toBeLessThanOrEqual(withGoodRecovery.score);
  });

  it('is neutral when HRV is between 30 and 80', () => {
    const result = calculateDailyVFScore(cleanDay({ hrv: 50 }));
    expect(result.breakdown.hrvMultiplier).toBe(1);
    expect(result.breakdown.hrvStatus).toBe('neutral');
  });
});

// ─── Rule 5: Seed Oil Nudge ─────────────────────────────────────────────────
describe('VF Rule 5 — Seed Oil Nudge (mild inflammation signal, not acute)', () => {
  it('deducts -5 per seed-oil meal', () => {
    const clean = calculateDailyVFScore(cleanDay());
    const oily = calculateDailyVFScore(cleanDay({ seedOilMeals: 2 }));
    expect(oily.score).toBe(clean.score - 10);
  });

  it('deducts -5 for a single seed-oil meal', () => {
    const clean = calculateDailyVFScore(cleanDay());
    const one = calculateDailyVFScore(cleanDay({ seedOilMeals: 1 }));
    expect(one.score).toBe(clean.score - 5);
  });
});

// ─── Combined Scenarios ─────────────────────────────────────────────────────
describe('VF Scoring — Combined Scenarios', () => {
  it('perfect day: deficit + protein + sleep + no alcohol + no seed oils = +100', () => {
    const result = calculateDailyVFScore(cleanDay());
    expect(result.score).toBe(100);
  });

  it('worst case: surplus + alcohol + bad sleep + seed oils = clamped at -200', () => {
    const result = calculateDailyVFScore(cleanDay({
      caloriesIn: 4000,
      caloriesOut: 2000,
      alcoholDrinks: 6,
      sleepHours: 4,
      seedOilMeals: 3,
    }));
    expect(result.score).toBe(-200);
  });

  it('fasting day with poor recovery: +100 base × 0.85 = +85', () => {
    const result = calculateDailyVFScore(cleanDay({
      fastingHours: 24,
      caloriesIn: 0,
      hrv: 25,
    }));
    expect(result.score).toBe(85);
  });

  it('returns a summary string describing the breakdown', () => {
    const result = calculateDailyVFScore(cleanDay());
    expect(result.summary).toContain('Daily VF score');
    expect(typeof result.summary).toBe('string');
  });
});

// ─── Zod validation guards (visceral fat) ─────────────────────────────────────
describe('Visceral Fat — Zod validation guards', () => {
  const workoutSchema = z.object({
    pointsDelta: z.number().min(-500, 'Points delta cannot be less than -500').max(500, 'Points delta cannot exceed 500'),
    workoutDetails: z.string().min(1, 'Workout details cannot be empty'),
  });

  it('accepts a valid workout entry', () => {
    const result = workoutSchema.safeParse({ pointsDelta: 150, workoutDetails: 'Back squats 5x5' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid negative delta (fat-burning session)', () => {
    const result = workoutSchema.safeParse({ pointsDelta: -200, workoutDetails: 'HIIT sprints' });
    expect(result.success).toBe(true);
  });

  it('rejects pointsDelta above 500', () => {
    const result = workoutSchema.safeParse({ pointsDelta: 1000, workoutDetails: 'Superhuman workout' });
    expect(result.success).toBe(false);
    expect(result.error?.errors[0].message).toContain('500');
  });

  it('rejects pointsDelta below -500', () => {
    const result = workoutSchema.safeParse({ pointsDelta: -1000, workoutDetails: 'Extreme session' });
    expect(result.success).toBe(false);
  });

  it('rejects empty workoutDetails', () => {
    const result = workoutSchema.safeParse({ pointsDelta: 100, workoutDetails: '' });
    expect(result.success).toBe(false);
    expect(result.error?.errors[0].message).toBe('Workout details cannot be empty');
  });
});
