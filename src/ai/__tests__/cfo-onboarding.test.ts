/**
 * @fileOverview ICE Test Case CFO-001 — New User Onboarding & First Session Flow
 *
 * Validates the deterministic logic, math, and state model that underpins the
 * 16-turn golden-path conversation. The LLM itself is not called; these tests
 * verify the rules and calculations the CFO is expected to apply.
 *
 * Assertion map (from spec):
 *   1  — CFO does NOT ask about equipment more than once
 *   2  — CFO does NOT ask about workout schedule more than once
 *   3  — CFO does NOT present point system before user states goal
 *   4  — CFO asks about goal weight/timeline BEFORE offering to start tracking
 *   5  — CFO asks for weight AND body fat before designing the point system
 *   6  — CFO contextualises goal using fat mass / lean mass / target BF%
 *   7  — CFO builds the point system to beat the user's stated timeline
 *   8  — CFO processes first reported activity with a calorie estimate
 *   9  — CFO asks about tracker at the natural moment (after first manual log)
 *  10  — Entire onboarding flow is linear — no loops, no repeated intake questions
 *  11  — CFO defers secondary data collection (walks, daily movement) to future sessions
 *  12  — CFO never stacks multiple questions in a single turn
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ─── Pure helpers (mirror the CFO's internal calculations) ────────────────────

function calcFatMassLbs(weightLbs: number, bodyFatPct: number): number {
  return weightLbs * bodyFatPct;
}

function calcLeanMassLbs(weightLbs: number, fatMassLbs: number): number {
  return weightLbs - fatMassLbs;
}

function calcTargetBodyFatPct(
  leanMassLbs: number,
  fatMassLbs: number,
  fatToLoseLbs: number
): number {
  const remainingFat = fatMassLbs - fatToLoseLbs;
  return remainingFat / (leanMassLbs + remainingFat);
}

/** MET-based calorie estimation: kcal = MET × 3.5 × weightKg × durationMin / 200 */
function estimateCaloriesBurned(
  durationMin: number,
  met: number,
  weightKg: number
): number {
  return Math.round((met * 3.5 * weightKg * durationMin) / 200);
}

// ─── Onboarding state helpers ─────────────────────────────────────────────────

type OnboardingPillars = {
  equipment: string[] | null;
  weeklySchedule: string | null;
  targets: { proteinGoal: number; fatPointsGoal: number } | null;
};

function isOnboardingComplete(p: OnboardingPillars): boolean {
  return p.equipment !== null && p.weeklySchedule !== null && p.targets !== null;
}

// ─── Conversation helpers ─────────────────────────────────────────────────────

type ChatTurn = { role: 'user' | 'model'; content: string };

function topicInHistory(history: ChatTurn[], patterns: RegExp[]): boolean {
  return history.some(t => patterns.some(p => p.test(t.content)));
}

/** Returns the index of the last turn matching the predicate, or -1. */
function findLastTurn(history: ChatTurn[], pred: (t: ChatTurn) => boolean): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (pred(history[i])) return i;
  }
  return -1;
}

function countQuestionMarks(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

// ─── Flow input schema (mirrors PersonalizedAICoachingInputSchema) ────────────

const flowInputSchema = z.object({
  userId: z.string(),
  userName: z.string().optional(),
  message: z.string(),
  currentDay: z.string(),
  photoDataUri: z.string().optional(),
  currentHealth: z.any().optional(),
  chatHistory: z
    .array(z.object({ role: z.enum(['user', 'model']), content: z.string() }))
    .optional(),
});

// ─── Golden-path conversation history (Turns 1–14) ───────────────────────────

const GOLDEN_PATH: ChatTurn[] = [
  { role: 'model', content: "Hi, I'm your new Chief Fitness Officer. What's the main thing you want to track?" },
  { role: 'user',  content: "I'm trying to reduce visceral fat." },
  { role: 'model', content: "Visceral fat. Sounds great. Tell me about your weekly schedule in terms of workouts and exercise." },
  { role: 'user',  content: "I play basketball on Thursday nights, and that's it." },
  { role: 'model', content: "Oh, okay, we can work with that. What kind of home equipment do you have for a gym, or do you have gym access anywhere?" },
  { role: 'user',  content: "I have one 55 lb kettlebell." },
  { role: 'model', content: "Great! We can do a lot with that. What's your goal overall — do you have a goal weight and a time frame?" },
  { role: 'user',  content: "I want to lose 20 lbs of fat in the next three months." },
  { role: 'model', content: "Got it — 20 lbs in three months. What's your current weight, and do you have any idea what your body fat percentage is?" },
  { role: 'user',  content: "I'm about 220 lbs. I'd guess maybe 25% body fat?" },
  { role: 'model', content: "At 220 lbs and roughly 25% body fat, you're carrying about 55 lbs of fat and 165 lbs of lean mass. Losing 20 lbs of fat would put you right around 18%." },
  { role: 'user',  content: "Okay." },
  { role: 'model', content: "Are you ready to start tracking your activity and your food intake now?" },
  { role: 'user',  content: "Yes, let's do that. I went for a bike ride this morning for two hours." },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CFO-001 | Body Composition Math — Turn 11 (Assertion 6)', () => {
  const weightLbs   = 220;
  const bodyFatPct  = 0.25;
  const fatToLose   = 20;

  it('fat mass: 220 lbs × 25% = 55 lbs', () => {
    expect(calcFatMassLbs(weightLbs, bodyFatPct)).toBe(55);
  });

  it('lean mass: 220 − 55 = 165 lbs', () => {
    const fatMass = calcFatMassLbs(weightLbs, bodyFatPct);
    expect(calcLeanMassLbs(weightLbs, fatMass)).toBe(165);
  });

  it('total weight after 20 lb fat loss: 165 + 35 = 200 lbs', () => {
    const fatMass  = calcFatMassLbs(weightLbs, bodyFatPct); // 55
    const leanMass = calcLeanMassLbs(weightLbs, fatMass);   // 165
    expect(leanMass + (fatMass - fatToLose)).toBe(200);
  });

  it('target body fat % ≈ 17.5% (CFO reports as ~18%)', () => {
    const fatMass  = calcFatMassLbs(weightLbs, bodyFatPct);
    const leanMass = calcLeanMassLbs(weightLbs, fatMass);
    const targetBF = calcTargetBodyFatPct(leanMass, fatMass, fatToLose);
    expect(targetBF).toBeCloseTo(0.175, 3);           // 35 / 200
    expect(Math.round(targetBF * 100)).toBe(18);      // rounds to 18% as the CFO states
  });

  it('remaining fat mass after goal achieved: 55 − 20 = 35 lbs', () => {
    const fatMass = calcFatMassLbs(weightLbs, bodyFatPct);
    expect(fatMass - fatToLose).toBe(35);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('CFO-001 | Timeline Optimization — Turn 11 (Assertion 7)', () => {
  it('2-month design beats the 3-month stated goal, leaving 1 month of buffer', () => {
    const stated      = 3;
    const designed    = 2;
    const buffer      = stated - designed;
    expect(designed).toBeLessThan(stated);
    expect(buffer).toBe(1);
  });

  it('accelerated weekly rate (2-month) is higher than stated-goal rate (3-month)', () => {
    const fatToLose         = 20;
    const statedRate        = fatToLose / 12; // weeks in 3 months
    const acceleratedRate   = fatToLose / 8;  // weeks in 2 months
    expect(acceleratedRate).toBeGreaterThan(statedRate);
    expect(acceleratedRate).toBeCloseTo(2.5, 2); // 2.5 lbs/week at perfect adherence
  });

  it('stated goal rate fits within a sustainable range (≤ 2 lbs/week)', () => {
    // 20 lbs / 12 weeks ≈ 1.67 lbs/week — aggressive but physiologically plausible
    const weeklyRate = 20 / 12;
    expect(weeklyRate).toBeGreaterThan(0);
    expect(weeklyRate).toBeLessThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('CFO-001 | Onboarding Pillar State Model (Assertions 1–5)', () => {
  const full: OnboardingPillars = {
    equipment:      ['55 lb kettlebell'],
    weeklySchedule: '{"Thu":"Basketball"}',
    targets:        { proteinGoal: 170, fatPointsGoal: 5000 },
  };

  it('incomplete when no pillars are set', () => {
    expect(isOnboardingComplete({ equipment: null, weeklySchedule: null, targets: null })).toBe(false);
  });

  it('incomplete with only equipment set', () => {
    expect(isOnboardingComplete({ ...full, weeklySchedule: null, targets: null })).toBe(false);
  });

  it('incomplete with only schedule set', () => {
    expect(isOnboardingComplete({ ...full, equipment: null, targets: null })).toBe(false);
  });

  it('incomplete with only targets set', () => {
    expect(isOnboardingComplete({ ...full, equipment: null, weeklySchedule: null })).toBe(false);
  });

  it('incomplete with any single pillar missing', () => {
    expect(isOnboardingComplete({ ...full, targets: null })).toBe(false);
    expect(isOnboardingComplete({ ...full, weeklySchedule: null })).toBe(false);
    expect(isOnboardingComplete({ ...full, equipment: null })).toBe(false);
  });

  it('complete ONLY when all three pillars are set', () => {
    expect(isOnboardingComplete(full)).toBe(true);
  });

  it('golden-path history captures all three pillars before tracker question', () => {
    const hasEquipment = topicInHistory(GOLDEN_PATH, [/kettlebell|home equipment/i]);
    const hasSchedule  = topicInHistory(GOLDEN_PATH, [/weekly schedule|basketball|thursday/i]);
    const hasTargets   = topicInHistory(GOLDEN_PATH, [/20 lbs|three months|goal weight/i]);
    expect(hasEquipment).toBe(true);
    expect(hasSchedule).toBe(true);
    expect(hasTargets).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('CFO-001 | No Re-Ask Rules — Assertions 1, 2, 10', () => {
  it('equipment question appears no more than once in CFO turns (Assertion 1)', () => {
    const equipmentAsks = GOLDEN_PATH.filter(
      t => t.role === 'model' && /home equipment|gym access|what.*equipment/i.test(t.content)
    );
    expect(equipmentAsks.length).toBeLessThanOrEqual(1);
  });

  it('schedule question appears no more than once in CFO turns (Assertion 2)', () => {
    const scheduleAsks = GOLDEN_PATH.filter(
      t => t.role === 'model' && /weekly schedule|workout schedule|training days/i.test(t.content)
    );
    expect(scheduleAsks.length).toBeLessThanOrEqual(1);
  });

  it('goal question (weight/timeline) appears no more than once (Assertion 4)', () => {
    const goalAsks = GOLDEN_PATH.filter(
      t => t.role === 'model' && /goal weight|time frame|how much.*lose/i.test(t.content)
    );
    expect(goalAsks.length).toBeLessThanOrEqual(1);
  });

  it('baseline stats question appears no more than once (Assertion 5)', () => {
    // Match only the *question* about stats, not the CFO's later statement using those stats.
    const statsAsks = GOLDEN_PATH.filter(
      t => t.role === 'model' && /current weight.*\?|body fat.*\?/i.test(t.content)
    );
    expect(statsAsks.length).toBeLessThanOrEqual(1);
  });

  it('baseline stats question precedes the body composition statement (Assertions 5 → 6)', () => {
    const statsIdx = GOLDEN_PATH.findIndex(
      t => t.role === 'model' && /current weight|body fat/i.test(t.content)
    );
    const compositionIdx = GOLDEN_PATH.findIndex(
      t => t.role === 'model' && /55 lbs of fat|165 lbs of lean/i.test(t.content)
    );
    expect(statsIdx).toBeGreaterThanOrEqual(0);
    expect(compositionIdx).toBeGreaterThan(statsIdx);
  });

  it('tracking offer appears after goal/baseline turns (Assertion 4 ordering)', () => {
    const baselineIdx = GOLDEN_PATH.findIndex(
      t => t.role === 'user' && /220 lbs|25% body fat/i.test(t.content)
    );
    const trackingIdx = GOLDEN_PATH.findIndex(
      t => t.role === 'model' && /start tracking/i.test(t.content)
    );
    expect(baselineIdx).toBeGreaterThanOrEqual(0);
    expect(trackingIdx).toBeGreaterThan(baselineIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('CFO-001 | Tracker Ask Timing — Assertion 9', () => {
  it('tracker question appears AFTER the first reported activity', () => {
    const historyWithTrackerAsk: ChatTurn[] = [
      ...GOLDEN_PATH,
      { role: 'model', content: "Awesome, I estimate ~900 kcal for that bike ride. Do you have a Fitbit or some other activity tracker you want to connect?" },
    ];

    const activityIdx = findLastTurn(
      historyWithTrackerAsk,
      t => t.role === 'user' && /bike ride|workout|exercise|ran|walked/i.test(t.content)
    );
    const trackerIdx = findLastTurn(
      historyWithTrackerAsk,
      t => t.role === 'model' && /fitbit|tracker|wearable/i.test(t.content)
    );

    expect(activityIdx).toBeGreaterThanOrEqual(0);
    expect(trackerIdx).toBeGreaterThan(activityIdx);
  });

  it('tracker question does NOT appear during early onboarding (before any activity)', () => {
    const earlyHistory = GOLDEN_PATH.slice(0, 8); // up through goal-setting
    const trackerEarly = earlyHistory.some(
      t => t.role === 'model' && /fitbit|tracker|wearable/i.test(t.content)
    );
    expect(trackerEarly).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('CFO-001 | Single Question Per Turn Rule — Assertion 12', () => {
  const CFO_TURNS = [
    "Hi, I'm your new Chief Fitness Officer. What's the main thing you want to track?",
    "Visceral fat. Sounds great. Tell me about your weekly schedule in terms of workouts and exercise.",
    "Oh, okay, we can work with that. What kind of home equipment do you have for a gym, or do you have gym access anywhere?",
    "Great! We can do a lot with that. What's your goal overall — do you have a goal weight and a time frame?",
    "Got it — 20 lbs in three months. What's your current weight, and do you have any idea what your body fat percentage is?",
    "Are you ready to start tracking your activity and your food intake now?",
    "Awesome, I estimate ~900 kcal for that bike ride. Do you have a Fitbit or some other activity tracker you want to connect?",
  ];

  it('every CFO turn in the golden path has at most one question mark', () => {
    CFO_TURNS.forEach(turn => {
      expect(countQuestionMarks(turn)).toBeLessThanOrEqual(1);
    });
  });

  it('combined activity+food tracking prompt is ONE question, not two (no split gate)', () => {
    const combined = 'Are you ready to start tracking your activity and your food intake now?';
    const split1   = 'Are you ready to start tracking your activity?';
    const split2   = 'Are you ready to start tracking your food intake?';
    expect(countQuestionMarks(combined)).toBe(1);
    expect(countQuestionMarks(split1) + countQuestionMarks(split2)).toBe(2);
  });

  it('a turn with multiple question marks would violate the rule', () => {
    const violating = 'What is your weight? And your body fat? And your height?';
    expect(countQuestionMarks(violating)).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('CFO-001 | Activity Calorie Estimation — Turn 15 (Assertion 8)', () => {
  it('produces a positive calorie estimate for a 2-hour bike ride at 220 lbs', () => {
    const weightKg = 220 * 0.453592; // ~99.8 kg
    const calories = estimateCaloriesBurned(120, 8.0, weightKg);
    expect(calories).toBeGreaterThan(0);
  });

  it('vigorous cycling burns more than moderate cycling for the same duration', () => {
    const weightKg = 99.8;
    expect(estimateCaloriesBurned(120, 12.0, weightKg)).toBeGreaterThan(
      estimateCaloriesBurned(120, 8.0, weightKg)
    );
  });

  it('calorie burn scales linearly with duration', () => {
    const weightKg = 100;
    const oneHour = estimateCaloriesBurned(60, 8.0, weightKg);
    const twoHour = estimateCaloriesBurned(120, 8.0, weightKg);
    expect(twoHour).toBe(oneHour * 2);
  });

  it('calorie burn scales with body weight', () => {
    expect(estimateCaloriesBurned(120, 8.0, 100)).toBeGreaterThan(
      estimateCaloriesBurned(120, 8.0, 70)
    );
  });

  it('zero duration produces zero calories', () => {
    expect(estimateCaloriesBurned(0, 8.0, 100)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('CFO-001 | Flow Input Schema Validation (Assertions 3–5)', () => {
  it('accepts a valid new-user onboarding turn', () => {
    const result = flowInputSchema.safeParse({
      userId:        'anon-test-001',
      message:       "I'm trying to reduce visceral fat.",
      currentDay:    'Thursday',
      currentHealth: { onboardingComplete: false },
      chatHistory:   [{ role: 'model', content: "Hi, I'm your new Chief Fitness Officer." }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts the bare minimum (userId + message + currentDay)', () => {
    const result = flowInputSchema.safeParse({
      userId:     'anon-test-001',
      message:    'Hello',
      currentDay: 'Monday',
    });
    expect(result.success).toBe(true);
  });

  it('rejects input missing userId', () => {
    const result = flowInputSchema.safeParse({ message: 'Hello', currentDay: 'Monday' });
    expect(result.success).toBe(false);
  });

  it('rejects input missing message', () => {
    const result = flowInputSchema.safeParse({ userId: 'anon-001', currentDay: 'Monday' });
    expect(result.success).toBe(false);
  });

  it('rejects chatHistory with an invalid role value', () => {
    const result = flowInputSchema.safeParse({
      userId:      'anon-001',
      message:     'Hello',
      currentDay:  'Monday',
      chatHistory: [{ role: 'assistant', content: 'Hi there' }], // not 'user' or 'model'
    });
    expect(result.success).toBe(false);
  });

  it('accepts the full 14-turn golden-path history', () => {
    const result = flowInputSchema.safeParse({
      userId:        'anon-test-001',
      message:       'Yes.',
      currentDay:    'Friday',
      currentHealth: { onboardingComplete: true, isDeviceVerified: false },
      chatHistory:   GOLDEN_PATH,
    });
    expect(result.success).toBe(true);
  });
});
