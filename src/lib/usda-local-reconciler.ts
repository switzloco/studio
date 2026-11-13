/**
 * @fileOverview Offline-first USDA FoodData Central & Compendium of Physical Activities (METs)
 * deterministic reconciler and CFO Double-Entry Ledger classifier.
 *
 * Works 100% offline in the browser with zero network calls:
 * 1. Anchors AI-parsed shorthand food items against verified USDA macros when matched.
 * 2. Enriches supplement micronutrients (creatine, beta-alanine, omega-3, caffeine, electrolytes).
 * 3. Reconciles exercise durations & intensities into gross + CFO-tier-discounted kcal burn.
 * 4. Classifies every item into Wall Street CFO double-entry ledger accounts.
 */

import {
  parseSupplementFieldsFromText,
  type FoodLogEntry,
  type ExerciseLogEntry,
} from './food-exercise-types';

export type CfoLedgerClass =
  | 'CAPITAL_ASSET_INFLOW'
  | 'LIABILITY_EXPOSURE'
  | 'CAPITAL_CAPEX'
  | 'OPERATING_FUEL';

export interface CfoClassMeta {
  code: CfoLedgerClass;
  label: string;
  shortTag: string;
  accountType: 'ASSET' | 'LIABILITY' | 'CAPEX' | 'OPEX';
}

export const CFO_CLASS_META: Record<CfoLedgerClass, CfoClassMeta> = {
  CAPITAL_ASSET_INFLOW: {
    code: 'CAPITAL_ASSET_INFLOW',
    label: 'Capital Asset Inflow',
    shortTag: 'ASSET // LEAN TISSUE',
    accountType: 'ASSET',
  },
  LIABILITY_EXPOSURE: {
    code: 'LIABILITY_EXPOSURE',
    label: 'Liability Exposure',
    shortTag: 'LIABILITY // METABOLIC DEBT',
    accountType: 'LIABILITY',
  },
  CAPITAL_CAPEX: {
    code: 'CAPITAL_CAPEX',
    label: 'Capital CapEx',
    shortTag: 'CAPEX // TRAINING STIMULUS',
    accountType: 'CAPEX',
  },
  OPERATING_FUEL: {
    code: 'OPERATING_FUEL',
    label: 'Operating Fuel',
    shortTag: 'OPEX // GLYCOGEN & MICRO',
    accountType: 'OPEX',
  },
};

interface UsdaReferenceFood {
  keywords: string[];
  canonicalName: string;
  /** Grams per 1 standard unit (e.g. 1 large egg = 50g, 1 cup cooked oats = 234g / dry 81g) */
  unitGrams: number;
  unitAliases?: Record<string, number>; // unit keyword -> grams
  per100g: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
    plantFraction?: number;
    glycemicIndex?: number;
    omega3Mg?: number;
    caffeineMg?: number;
    alcoholDrinksPer100g?: number;
    hasSeedOils?: boolean;
  };
}

/**
 * Curated USDA FoodData Central SR Legacy / Foundation Foods reference profiles (per 100g).
 */
const USDA_REFERENCE_TABLE: UsdaReferenceFood[] = [
  {
    keywords: ['egg white', 'egg whites'],
    canonicalName: 'Egg Whites (USDA)',
    unitGrams: 33,
    unitAliases: { cup: 243, tbsp: 15 },
    per100g: { calories: 52, proteinG: 10.9, carbsG: 0.7, fatG: 0.2, fiberG: 0, glycemicIndex: 0 },
  },
  {
    keywords: ['egg', 'eggs', 'whole egg', 'scrambled eggs', 'hard boiled egg', 'poached egg'],
    canonicalName: 'Whole Eggs, Large (USDA)',
    unitGrams: 50,
    per100g: { calories: 143, proteinG: 12.6, carbsG: 0.7, fatG: 9.5, fiberG: 0, glycemicIndex: 0, omega3Mg: 37 },
  },
  {
    keywords: ['oat', 'oats', 'oatmeal', 'rolled oats', 'steel cut oats'],
    canonicalName: 'Rolled Oats (USDA)',
    unitGrams: 81, // 1 cup dry rolled oats = 81g (~307 kcal)
    unitAliases: { cup: 81, scoop: 40, packet: 43, bowl: 81 },
    per100g: { calories: 379, proteinG: 13.2, carbsG: 67.7, fatG: 6.5, fiberG: 10.1, glycemicIndex: 55 },
  },
  {
    keywords: ['black coffee', 'espresso', 'americano', 'drip coffee', 'cold brew'],
    canonicalName: 'Black Coffee, Brewed (USDA)',
    unitGrams: 240,
    unitAliases: { cup: 240, mug: 350, shot: 30, oz: 30 },
    per100g: { calories: 1, proteinG: 0.1, carbsG: 0, fatG: 0, fiberG: 0, glycemicIndex: 0, caffeineMg: 40 },
  },
  {
    keywords: ['chicken breast', 'grilled chicken', 'rotisserie chicken breast'],
    canonicalName: 'Chicken Breast, Cooked (USDA)',
    unitGrams: 170,
    unitAliases: { oz: 28.35, lb: 453.6, breast: 174 },
    per100g: { calories: 165, proteinG: 31.0, carbsG: 0, fatG: 3.6, fiberG: 0, glycemicIndex: 0 },
  },
  {
    keywords: ['salmon', 'wild salmon', 'atlantic salmon', 'sockeye salmon'],
    canonicalName: 'Salmon Fillet, Cooked (USDA)',
    unitGrams: 170,
    unitAliases: { oz: 28.35, fillet: 178 },
    per100g: { calories: 206, proteinG: 22.1, carbsG: 0, fatG: 12.4, fiberG: 0, glycemicIndex: 0, omega3Mg: 2150 },
  },
  {
    keywords: ['ribeye', 'ribeye steak'],
    canonicalName: 'Beef Ribeye Steak, Cooked (USDA)',
    unitGrams: 225,
    unitAliases: { oz: 28.35, steak: 225 },
    per100g: { calories: 291, proteinG: 24.0, carbsG: 0, fatG: 21.8, fiberG: 0, glycemicIndex: 0 },
  },
  {
    keywords: ['sirloin', 'steak', 'flank steak', 'ny strip', 'filet mignon'],
    canonicalName: 'Beef Top Sirloin, Cooked (USDA)',
    unitGrams: 200,
    unitAliases: { oz: 28.35, steak: 200 },
    per100g: { calories: 206, proteinG: 29.7, carbsG: 0, fatG: 9.0, fiberG: 0, glycemicIndex: 0 },
  },
  {
    keywords: ['ground beef', 'beef patty', 'burger patty'],
    canonicalName: 'Lean Ground Beef 90/10, Cooked (USDA)',
    unitGrams: 150,
    unitAliases: { oz: 28.35, patty: 113 },
    per100g: { calories: 217, proteinG: 26.1, carbsG: 0, fatG: 11.8, fiberG: 0, glycemicIndex: 0 },
  },
  {
    keywords: ['greek yogurt', 'nonfat greek yogurt', 'fage', 'skyr'],
    canonicalName: 'Greek Yogurt, Plain Nonfat (USDA)',
    unitGrams: 170,
    unitAliases: { cup: 227, bowl: 227, container: 170 },
    per100g: { calories: 59, proteinG: 10.3, carbsG: 3.6, fatG: 0.4, fiberG: 0, glycemicIndex: 12 },
  },
  {
    keywords: ['whey', 'whey protein', 'protein shake', 'protein scoop', 'isolate'],
    canonicalName: 'Whey Protein Isolate Scoop (USDA)',
    unitGrams: 32,
    unitAliases: { scoop: 32, scoops: 32, shake: 32 },
    per100g: { calories: 375, proteinG: 78.1, carbsG: 6.2, fatG: 3.1, fiberG: 0, glycemicIndex: 15 },
  },
  {
    keywords: ['white rice', 'jasmine rice', 'basmati rice', 'steamed rice'],
    canonicalName: 'White Rice, Cooked (USDA)',
    unitGrams: 158,
    unitAliases: { cup: 158, bowl: 220 },
    per100g: { calories: 130, proteinG: 2.7, carbsG: 28.2, fatG: 0.3, fiberG: 0.4, glycemicIndex: 72 },
  },
  {
    keywords: ['brown rice', 'quinoa'],
    canonicalName: 'Brown Rice / Quinoa, Cooked (USDA)',
    unitGrams: 195,
    unitAliases: { cup: 195, bowl: 220 },
    per100g: { calories: 120, proteinG: 4.1, carbsG: 21.3, fatG: 1.9, fiberG: 2.8, glycemicIndex: 53 },
  },
  {
    keywords: ['avocado'],
    canonicalName: 'Avocado, Raw (USDA)',
    unitGrams: 150,
    unitAliases: { half: 75, whole: 150 },
    per100g: { calories: 160, proteinG: 2.0, carbsG: 8.5, fatG: 14.7, fiberG: 6.7, plantFraction: 1, glycemicIndex: 15 },
  },
  {
    keywords: ['banana', 'bananas'],
    canonicalName: 'Banana, Medium (USDA)',
    unitGrams: 118,
    per100g: { calories: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3, fiberG: 2.6, plantFraction: 1, glycemicIndex: 51 },
  },
  {
    keywords: ['apple', 'apples'],
    canonicalName: 'Apple, Medium (USDA)',
    unitGrams: 182,
    per100g: { calories: 52, proteinG: 0.3, carbsG: 13.8, fatG: 0.2, fiberG: 2.4, plantFraction: 1, glycemicIndex: 36 },
  },
  {
    keywords: ['blueberries', 'berries', 'strawberries', 'raspberries'],
    canonicalName: 'Mixed Berries, Raw (USDA)',
    unitGrams: 148,
    unitAliases: { cup: 148, handful: 70 },
    per100g: { calories: 50, proteinG: 0.8, carbsG: 12.1, fatG: 0.3, fiberG: 3.6, plantFraction: 1, glycemicIndex: 25 },
  },
  {
    keywords: ['broccoli', 'spinach', 'asparagus', 'brussels sprouts', 'mixed greens'],
    canonicalName: 'Green Cruciferous / Leafy Veg (USDA)',
    unitGrams: 150,
    unitAliases: { cup: 91, serving: 150 },
    per100g: { calories: 34, proteinG: 2.8, carbsG: 6.6, fatG: 0.4, fiberG: 2.6, plantFraction: 1, glycemicIndex: 15 },
  },
  {
    keywords: ['olive oil', 'extra virgin olive oil', 'evoo'],
    canonicalName: 'Extra Virgin Olive Oil (USDA)',
    unitGrams: 14,
    unitAliases: { tbsp: 14, tsp: 4.5 },
    per100g: { calories: 884, proteinG: 0, carbsG: 0, fatG: 100, fiberG: 0, glycemicIndex: 0 },
  },
  {
    keywords: ['ipa', 'craft beer', 'beer', 'lager', 'pint of beer'],
    canonicalName: 'Beer, Regular / Craft (USDA)',
    unitGrams: 355,
    unitAliases: { can: 355, bottle: 355, pint: 473 },
    per100g: { calories: 43, proteinG: 0.5, carbsG: 3.6, fatG: 0, fiberG: 0, glycemicIndex: 66, alcoholDrinksPer100g: 0.28 },
  },
  {
    keywords: ['wine', 'red wine', 'white wine', 'cabernet', 'pinot noir'],
    canonicalName: 'Table Wine, 5oz Pour (USDA)',
    unitGrams: 147,
    unitAliases: { glass: 147, bottle: 750 },
    per100g: { calories: 85, proteinG: 0.1, carbsG: 2.6, fatG: 0, fiberG: 0, glycemicIndex: 0, alcoholDrinksPer100g: 0.68 },
  },
  {
    keywords: ['french fries', 'fries', 'fried chicken', 'onion rings', 'nachos'],
    canonicalName: 'Deep-Fried Restaurant Side (USDA)',
    unitGrams: 140,
    per100g: { calories: 312, proteinG: 3.4, carbsG: 41.4, fatG: 14.7, fiberG: 3.8, glycemicIndex: 75, hasSeedOils: true },
  },
];

interface ExerciseMetProfile {
  keywords: string[];
  category: ExerciseLogEntry['category'];
  met: number;
  tier: NonNullable<ExerciseLogEntry['activityTier']>;
}

const EXERCISE_MET_PROFILES: ExerciseMetProfile[] = [
  {
    keywords: ['squat', 'squats', 'deadlift', 'deadlifts', 'bench', 'press', 'lifting', 'weights', 'hypertrophy', 'barbell', 'dumbbell', 'kettlebell', 'pullup', 'pull-ups'],
    category: 'strength',
    met: 6.0,
    tier: 'tier3_anaerobic',
  },
  {
    keywords: ['hiit', 'sprint', 'sprints', 'metcon', 'crossfit', 'assault bike', ' sled ', 'rowing intervals'],
    category: 'conditioning',
    met: 8.5,
    tier: 'tier3_anaerobic',
  },
  {
    keywords: ['run', 'running', 'jog', 'jogging', 'peloton', 'cycling', 'bike', 'swim', 'swimming', 'stairmaster', 'zone 2', 'rucking'],
    category: 'cardio',
    met: 7.5,
    tier: 'tier2_steady_state',
  },
  {
    keywords: ['walk', 'walking', 'stroll', 'incline walk', 'treadmill walk'],
    category: 'cardio',
    met: 3.5,
    tier: 'tier1_walking',
  },
  {
    keywords: ['yoga', 'mobility', 'stretching', 'sauna', 'foam roll', 'pilates'],
    category: 'recovery',
    met: 2.5,
    tier: 'tier1_walking',
  },
];

const TIER_DISCOUNT: Record<NonNullable<ExerciseLogEntry['activityTier']>, number> = {
  tier1_walking: 0.5,
  tier2_steady_state: 0.7,
  tier3_anaerobic: 0.85,
};

export interface ReconciledFoodDraft {
  name: string;
  portionG: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  plantMassG?: number;
  glycemicIndex?: number;
  omega3Mg?: number;
  caffeineMg?: number;
  hasElectrolytes?: boolean;
  betaAlanineG?: number;
  creatineG?: number;
  alcoholDrinks?: number;
  hasSeedOils?: boolean;
  meal: FoodLogEntry['meal'];
  source: FoodLogEntry['source'];
  cfoClass: CfoLedgerClass;
  usdaMatched: boolean;
}

export interface ReconciledWorkoutDraft {
  name: string;
  category: ExerciseLogEntry['category'];
  durationMin: number;
  sets?: number;
  reps?: number;
  weightKg?: number;
  estimatedCaloriesBurned: number;
  adjustedCalories: number;
  activityTier: NonNullable<ExerciseLogEntry['activityTier']>;
  pointsDelta: number;
  cfoClass: CfoLedgerClass;
}

export function inferMealSlotByLocalHour(date: Date = new Date()): FoodLogEntry['meal'] {
  const h = date.getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h >= 17 && h <= 21) return 'dinner';
  return 'snack';
}

export function classifyFoodItemCfo(item: {
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  alcoholDrinks?: number;
  hasSeedOils?: boolean;
  glycemicIndex?: number;
  creatineG?: number;
  betaAlanineG?: number;
}): CfoLedgerClass {
  if ((item.alcoholDrinks && item.alcoholDrinks > 0) || item.hasSeedOils) {
    return 'LIABILITY_EXPOSURE';
  }
  const lower = item.name.toLowerCase();
  if (
    /\b(soda|candy|donut|doughnut|cake|pastry|cookie|cookies|ice cream|beer|wine|vodka|whiskey|tequila|margarita|fries|chips)\b/.test(
      lower
    )
  ) {
    return 'LIABILITY_EXPOSURE';
  }
  if (item.calories >= 160 && item.proteinG < 4 && (item.glycemicIndex ?? 50) >= 70) {
    return 'LIABILITY_EXPOSURE';
  }
  if ((item.creatineG && item.creatineG > 0) || (item.betaAlanineG && item.betaAlanineG > 0)) {
    return 'CAPITAL_ASSET_INFLOW';
  }
  const proteinCalories = item.proteinG * 4;
  if (item.proteinG >= 15 || (item.calories > 30 && proteinCalories / item.calories >= 0.25)) {
    return 'CAPITAL_ASSET_INFLOW';
  }
  return 'OPERATING_FUEL';
}

function findUsdaMatch(name: string): UsdaReferenceFood | null {
  const lower = name.toLowerCase().trim();
  for (const ref of USDA_REFERENCE_TABLE) {
    for (const kw of ref.keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}\\b`, 'i').test(lower)) {
        return ref;
      }
    }
  }
  return null;
}

function inferGramsFromQuantityText(text: string, ref: UsdaReferenceFood): number | null {
  const lower = text.toLowerCase();
  const gramMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:g|grams)\b/);
  if (gramMatch) return Math.round(Number(gramMatch[1]));

  const ozMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:oz|ounce|ounces)\b/);
  if (ozMatch) return Math.round(Number(ozMatch[1]) * 28.35);

  if (ref.unitAliases) {
    for (const [unitWord, unitG] of Object.entries(ref.unitAliases)) {
      const m = lower.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unitWord}s?\\b`));
      if (m) return Math.round(Number(m[1]) * unitG);
      if (new RegExp(`\\b(?:a|one)\\s+${unitWord}\\b`).test(lower)) return unitG;
    }
  }

  const leadingQty = lower.match(/^(\d+(?:\.\d+)?)\b/);
  if (leadingQty) {
    const qty = Number(leadingQty[1]);
    if (qty > 0 && qty <= 24) {
      return Math.round(qty * ref.unitGrams);
    }
  }
  return null;
}

/**
 * Reconciles an AI-parsed food item against our local USDA FoodData Central dictionary
 * and supplement parser, ensuring deterministic macro sanity and double-entry classification.
 */
export function reconcileParsedFoodItem(raw: {
  name: string;
  quantityText?: string;
  portionG?: number;
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number;
  plantMassG?: number;
  alcoholDrinks?: number;
  hasSeedOils?: boolean;
  meal?: FoodLogEntry['meal'];
}): ReconciledFoodDraft {
  const combinedLabel = [raw.quantityText, raw.name].filter(Boolean).join(' ').trim();
  const usda = findUsdaMatch(combinedLabel);
  const supplements = parseSupplementFieldsFromText(combinedLabel, raw.portionG);
  const meal = raw.meal || inferMealSlotByLocalHour();

  let portionG = Math.max(1, Math.round(raw.portionG || 100));
  let calories = Math.max(0, Math.round(raw.calories ?? 0));
  let proteinG = Math.max(0, Math.round((raw.proteinG ?? 0) * 10) / 10);
  let carbsG = Math.max(0, Math.round((raw.carbsG ?? 0) * 10) / 10);
  let fatG = Math.max(0, Math.round((raw.fatG ?? 0) * 10) / 10);
  let fiberG = Math.max(0, Math.round((raw.fiberG ?? 0) * 10) / 10);
  let plantMassG = raw.plantMassG;
  let glycemicIndex: number | undefined;
  let omega3Mg = supplements.omega3Mg;
  let caffeineMg = supplements.caffeineMg;
  let alcoholDrinks = raw.alcoholDrinks;
  let hasSeedOils = raw.hasSeedOils;
  let usdaMatched = false;

  if (usda) {
    const inferredG = inferGramsFromQuantityText(combinedLabel, usda);
    if (inferredG && inferredG > 0) {
      portionG = inferredG;
    } else if (!raw.portionG || raw.portionG <= 0) {
      portionG = usda.unitGrams;
    }

    const scale = portionG / 100;
    const usdaCal = Math.round(usda.per100g.calories * scale);
    // Anchor to USDA reference if AI calories were missing or drifted > 35% from USDA ground truth
    const drift = calories > 0 ? Math.abs(calories - usdaCal) / Math.max(1, usdaCal) : 1;
    if (calories === 0 || drift > 0.35 || inferredG !== null) {
      calories = usdaCal;
      proteinG = Math.round(usda.per100g.proteinG * scale * 10) / 10;
      carbsG = Math.round(usda.per100g.carbsG * scale * 10) / 10;
      fatG = Math.round(usda.per100g.fatG * scale * 10) / 10;
      fiberG = Math.round(usda.per100g.fiberG * scale * 10) / 10;
    }
    if (usda.per100g.plantFraction && !plantMassG) {
      plantMassG = Math.round(portionG * usda.per100g.plantFraction);
    }
    glycemicIndex = usda.per100g.glycemicIndex;
    if (usda.per100g.omega3Mg && !omega3Mg) {
      omega3Mg = Math.round(usda.per100g.omega3Mg * scale);
    }
    if (usda.per100g.caffeineMg && !caffeineMg) {
      caffeineMg = Math.round(usda.per100g.caffeineMg * scale);
    }
    if (usda.per100g.alcoholDrinksPer100g && !alcoholDrinks) {
      alcoholDrinks = Math.max(1, Math.round(usda.per100g.alcoholDrinksPer100g * scale * 10) / 10);
    }
    if (usda.per100g.hasSeedOils && hasSeedOils === undefined) {
      hasSeedOils = true;
    }
    usdaMatched = true;
  } else if (calories === 0 && (proteinG > 0 || carbsG > 0 || fatG > 0)) {
    calories = Math.round(proteinG * 4 + carbsG * 4 + fatG * 9);
  }

  const cfoClass = classifyFoodItemCfo({
    name: raw.name,
    calories,
    proteinG,
    carbsG,
    fatG,
    alcoholDrinks,
    hasSeedOils,
    glycemicIndex,
    creatineG: supplements.creatineG,
    betaAlanineG: supplements.betaAlanineG,
  });

  return {
    name: raw.name.trim(),
    portionG,
    calories,
    proteinG: Math.round(proteinG),
    carbsG: Math.round(carbsG),
    fatG: Math.round(fatG),
    fiberG: Math.round(fiberG),
    plantMassG: plantMassG && plantMassG > 0 ? Math.round(plantMassG) : undefined,
    glycemicIndex,
    omega3Mg,
    caffeineMg,
    hasElectrolytes: supplements.hasElectrolytes,
    betaAlanineG: supplements.betaAlanineG,
    creatineG: supplements.creatineG,
    alcoholDrinks: alcoholDrinks && alcoholDrinks > 0 ? alcoholDrinks : undefined,
    hasSeedOils: hasSeedOils || undefined,
    meal,
    source: usdaMatched ? 'usda' : 'user_estimate',
    cfoClass,
    usdaMatched,
  };
}

/**
 * Reconciles an AI-parsed workout into Compendium MET calories + CFO activity-tier discount.
 */
export function reconcileParsedWorkout(
  raw: {
    name: string;
    category?: string;
    durationMin?: number;
    sets?: number;
    reps?: number;
    weightKg?: number;
    estimatedCaloriesBurned?: number;
  },
  userWeightKg: number = 78
): ReconciledWorkoutDraft {
  const lower = ` ${raw.name.toLowerCase()} `;
  let matchedProfile: ExerciseMetProfile = {
    keywords: [],
    category: 'strength',
    met: 5.5,
    tier: 'tier3_anaerobic',
  };

  for (const profile of EXERCISE_MET_PROFILES) {
    if (profile.keywords.some((kw) => lower.includes(kw))) {
      matchedProfile = profile;
      break;
    }
  }

  const validCategory =
    raw.category === 'strength' ||
    raw.category === 'conditioning' ||
    raw.category === 'recovery' ||
    raw.category === 'cardio'
      ? raw.category
      : matchedProfile.category;

  const durationMin = Math.max(5, Math.min(300, Math.round(raw.durationMin || 30)));
  const metEstimate = Math.round(matchedProfile.met * userWeightKg * (durationMin / 60));
  const grossKcal =
    raw.estimatedCaloriesBurned && raw.estimatedCaloriesBurned > 15
      ? Math.round((raw.estimatedCaloriesBurned + metEstimate) / 2)
      : metEstimate;
  const discount = TIER_DISCOUNT[matchedProfile.tier];
  const adjustedCalories = Math.round(grossKcal * discount);
  const pointsDelta = Math.max(5, Math.round(adjustedCalories / 12));

  return {
    name: raw.name.trim(),
    category: validCategory,
    durationMin,
    sets: raw.sets && raw.sets > 0 ? Math.round(raw.sets) : undefined,
    reps: raw.reps && raw.reps > 0 ? Math.round(raw.reps) : undefined,
    weightKg: raw.weightKg && raw.weightKg > 0 ? raw.weightKg : undefined,
    estimatedCaloriesBurned: grossKcal,
    adjustedCalories,
    activityTier: matchedProfile.tier,
    pointsDelta,
    cfoClass: 'CAPITAL_CAPEX',
  };
}
