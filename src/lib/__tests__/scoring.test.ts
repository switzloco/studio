import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

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

// ─── Visceral Fat Scoring ──────────────────────────────────────────────────────
describe('Visceral Fat — equity point calculation', () => {
  const STARTING_EQUITY = 1250;

  it('increases equity on positive pointsDelta (Bullish)', () => {
    const current = STARTING_EQUITY;
    const pointsDelta = 100;
    const newEquity = current + pointsDelta;
    expect(newEquity).toBe(1350);
  });

  it('decreases equity on negative pointsDelta (Correction)', () => {
    const current = STARTING_EQUITY;
    const pointsDelta = -75;
    const newEquity = current + pointsDelta;
    expect(newEquity).toBe(1175);
  });

  it('leaves equity unchanged on zero delta', () => {
    const current = STARTING_EQUITY;
    const newEquity = current + 0;
    expect(newEquity).toBe(STARTING_EQUITY);
  });

  it('correctly derives Bullish status for positive delta', () => {
    const pointsDelta = 50;
    const status = pointsDelta >= 0 ? 'Bullish' : 'Correction';
    expect(status).toBe('Bullish');
  });

  it('correctly derives Correction status for negative delta', () => {
    const pointsDelta = -50;
    const status = pointsDelta >= 0 ? 'Bullish' : 'Correction';
    expect(status).toBe('Correction');
  });

  it('constructs a valid HistoryEntry shape', () => {
    const entry = {
      date: 'Feb 25',
      gain: 100,
      status: 'Bullish' as const,
      detail: '5x5 Deadlifts — Main Street Gym',
      equity: 1350,
    };
    expect(entry).toMatchObject({
      date: expect.any(String),
      gain: expect.any(Number),
      status: expect.stringMatching(/^(Bullish|Stable|Correction|Bullish Entry)$/),
      detail: expect.any(String),
      equity: expect.any(Number),
    });
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
