import { describe, expect, it } from 'vitest';
import { InferenceSource } from 'firebase/ai';
import {
  buildSecComplianceAlert,
  formatExecutionBadge,
  normalizeInferenceSource,
  SecPrivacyLockBlockedError,
} from '@/lib/hybrid-ai';
import { sanitizeCloudModelName } from '@/firebase/remote-config';
import {
  classifyFoodItemCfo,
  reconcileParsedFoodItem,
  reconcileParsedWorkout,
} from '@/lib/usda-local-reconciler';

describe('Firebase AI Logic Hybrid Engine & USDA Reconciler', () => {
  it('formats ON_DEVICE and IN_CLOUD execution badges strictly per specification', () => {
    expect(formatExecutionBadge('ON_DEVICE', 142)).toBe(
      '[EXEC: ON_DEVICE // GEMINI NANO // 142ms // $0.00 GAS]'
    );
    expect(formatExecutionBadge('IN_CLOUD', 684.4)).toBe(
      '[EXEC: IN_CLOUD // GEMINI CLOUD // 684ms // FALLBACK]'
    );
  });

  it('normalizes Firebase AI Logic InferenceSource enum values ("on_device" / "in_cloud")', () => {
    expect(normalizeInferenceSource(InferenceSource.ON_DEVICE)).toBe('ON_DEVICE');
    expect(normalizeInferenceSource('on_device')).toBe('ON_DEVICE');
    expect(normalizeInferenceSource('ON_DEVICE')).toBe('ON_DEVICE');
    expect(normalizeInferenceSource(InferenceSource.IN_CLOUD)).toBe('IN_CLOUD');
    expect(normalizeInferenceSource('in_cloud')).toBe('IN_CLOUD');
    expect(normalizeInferenceSource(undefined)).toBe('IN_CLOUD');
  });

  it('enforces the model rule: blocks retired gemini-2.0-* and defaults to gemini-3.8-flash', () => {
    expect(sanitizeCloudModelName('')).toBe('gemini-3.8-flash');
    expect(sanitizeCloudModelName(null)).toBe('gemini-3.8-flash');
    expect(sanitizeCloudModelName('gemini-2.0-flash')).toBe('gemini-3.8-flash');
    expect(sanitizeCloudModelName('gemini-2.0-flash-exp')).toBe('gemini-3.8-flash');
    expect(sanitizeCloudModelName('gemini-3.8-flash')).toBe('gemini-3.8-flash');
    expect(sanitizeCloudModelName('gemini-4-hydrogen')).toBe('gemini-4-hydrogen');
  });

  it('reconciles shorthand food items against local USDA baselines and CFO double-entry accounts', () => {
    const eggs = reconcileParsedFoodItem({
      name: 'Whole Eggs',
      quantityText: '3',
    });
    expect(eggs.usdaMatched).toBe(true);
    expect(eggs.source).toBe('usda');
    expect(eggs.portionG).toBe(150);
    expect(eggs.proteinG).toBeGreaterThanOrEqual(18);
    expect(eggs.cfoClass).toBe('CAPITAL_ASSET_INFLOW');

    const oats = reconcileParsedFoodItem({
      name: 'Rolled Oats',
      quantityText: '1 cup',
    });
    expect(oats.usdaMatched).toBe(true);
    expect(oats.fiberG).toBeGreaterThanOrEqual(7);
    expect(oats.cfoClass).toBe('OPERATING_FUEL');

    const coffee = reconcileParsedFoodItem({
      name: 'Black Coffee',
      quantityText: '1 cup',
    });
    expect(coffee.caffeineMg).toBeGreaterThanOrEqual(80);
    expect(coffee.calories).toBeLessThanOrEqual(10);

    const beer = reconcileParsedFoodItem({
      name: 'Craft Beer',
      quantityText: '2 pints',
    });
    expect(beer.alcoholDrinks).toBeGreaterThan(0);
    expect(beer.cfoClass).toBe('LIABILITY_EXPOSURE');
  });

  it('classifies supplements & liabilities into accurate CFO balance-sheet categories', () => {
    expect(
      classifyFoodItemCfo({
        name: 'Creatine Monohydrate 5g',
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        creatineG: 5,
      })
    ).toBe('CAPITAL_ASSET_INFLOW');

    expect(
      classifyFoodItemCfo({
        name: 'Glazed Donut',
        calories: 280,
        proteinG: 3,
        carbsG: 34,
        fatG: 15,
        glycemicIndex: 76,
      })
    ).toBe('LIABILITY_EXPOSURE');
  });

  it('reconciles workouts into MET calories and CFO anaerobic CapEx discounts', () => {
    const squats = reconcileParsedWorkout(
      {
        name: 'Heavy Barbell Squats',
        category: 'strength',
        durationMin: 35,
      },
      80
    );
    expect(squats.cfoClass).toBe('CAPITAL_CAPEX');
    expect(squats.activityTier).toBe('tier3_anaerobic');
    expect(squats.estimatedCaloriesBurned).toBeGreaterThan(200);
    expect(squats.adjustedCalories).toBe(Math.round(squats.estimatedCaloriesBurned * 0.85));
    expect(squats.pointsDelta).toBeGreaterThan(10);
  });

  it('constructs a structured SEC Insider Privacy Lock compliance alert when Nano is absent', () => {
    const alert = buildSecComplianceAlert();
    const err = new SecPrivacyLockBlockedError(alert);
    expect(err.alert.code).toBe('SEC_LOCK_NANO_UNAVAILABLE');
    expect(err.alert.steps.some((s) => s.includes('prompt-api-for-gemini-nano-multimodal-input'))).toBe(
      true
    );
  });
});
