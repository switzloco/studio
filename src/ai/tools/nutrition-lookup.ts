/**
 * @fileOverview USDA FoodData Central lookup tool for the CFO AI Coach.
 * Free, authoritative macro data — no hallucination on common foods.
 * API key: optional USDA_FOOD_API_KEY env var, falls back to DEMO_KEY (100 req/hr).
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1';

interface UsdaNutrient {
  nutrientName: string;
  value: number;
  unitName: string;
}

interface UsdaFood {
  description: string;
  foodNutrients: UsdaNutrient[];
  servingSize?: number;
  servingSizeUnit?: string;
}

function extractMacros(food: UsdaFood) {
  const find = (name: string) =>
    food.foodNutrients.find((n) =>
      n.nutrientName.toLowerCase().includes(name.toLowerCase())
    );

  const protein = find('protein');
  const fat = find('total lipid') ?? find('total fat');
  const carbs = find('carbohydrate, by difference') ?? find('carbohydrate');
  const calories = find('energy');
  const fiber = find('fiber, total dietary') ?? find('fiber');

  return {
    per100g: {
      calories: Math.round(calories?.value ?? 0),
      proteinG: Math.round((protein?.value ?? 0) * 10) / 10,
      carbsG: Math.round((carbs?.value ?? 0) * 10) / 10,
      fatG: Math.round((fat?.value ?? 0) * 10) / 10,
      fiberG: Math.round((fiber?.value ?? 0) * 10) / 10,
    },
    servingSize: food.servingSize,
    servingSizeUnit: food.servingSizeUnit,
  };
}

export const nutritionLookupTool = ai.defineTool(
  {
    name: 'nutrition_lookup',
    description:
      'Looks up accurate macro data for a SPECIALTY, branded, or restaurant food from the USDA database ' +
      'when you are genuinely uncertain. For common whole foods (eggs, chicken, rice, bread, fruit, ' +
      'vegetables, dairy) use your own nutrition knowledge — do NOT call this. Never block logging on ' +
      'this lookup: if it returns "unavailable", just estimate the macros yourself and proceed. ' +
      'Returns per-100g values.',
    inputSchema: z.object({
      query: z.string().describe('Food name to look up, e.g. "Chipotle chicken bowl" or a branded protein bar'),
      portionG: z
        .number()
        .optional()
        .describe('Optional portion size in grams to calculate totals for that portion'),
    }),
    // Loose schema so the tool can return a graceful "unavailable" fallback
    // instead of throwing — a thrown tool error aborts the whole chat turn.
    outputSchema: z.any(),
  },
  async (input) => {
    const apiKey = process.env.USDA_FOOD_API_KEY ?? 'DEMO_KEY';

    const searchParams = new URLSearchParams({
      query: input.query,
      api_key: apiKey,
      pageSize: '3',
      dataType: 'SR Legacy,Foundation,Branded',
    });

    try {
      const searchRes = await fetch(`${USDA_BASE}/foods/search?${searchParams}`, {
        headers: { Accept: 'application/json' },
      });

      if (!searchRes.ok) {
        // Degrade gracefully — especially on 429 (rate limit on the shared
        // DEMO_KEY). Tell the model to fall back to its own knowledge.
        const reason = searchRes.status === 429 ? 'rate_limited' : `http_${searchRes.status}`;
        return {
          unavailable: true,
          reason,
          note:
            'USDA lookup is unavailable right now (' +
            `${searchRes.status} ${searchRes.statusText}). Estimate the macros from your own ` +
            'nutrition knowledge and proceed with logging — do not block on this.',
        };
      }

      const searchData = await searchRes.json();
      const foods: UsdaFood[] = searchData.foods ?? [];

      if (foods.length === 0) {
        return {
          unavailable: true,
          reason: 'no_match',
          note: `No USDA entry for "${input.query}". Estimate the macros yourself and proceed.`,
        };
      }

      const top = foods[0];
      const macros = extractMacros(top);

      const result: {
        foodName: string;
        per100g: typeof macros.per100g;
        portionTotals?: { portionG: number; calories: number; proteinG: number; carbsG: number; fatG: number };
        source: string;
      } = {
        foodName: top.description,
        per100g: macros.per100g,
        source: 'USDA FoodData Central',
      };

      if (input.portionG) {
        const scale = input.portionG / 100;
        result.portionTotals = {
          portionG: input.portionG,
          calories: Math.round(macros.per100g.calories * scale),
          proteinG: Math.round(macros.per100g.proteinG * scale * 10) / 10,
          carbsG: Math.round(macros.per100g.carbsG * scale * 10) / 10,
          fatG: Math.round(macros.per100g.fatG * scale * 10) / 10,
        };
      }

      return result;
    } catch (err: unknown) {
      // Network/parse failure — never let it crash the turn.
      return {
        unavailable: true,
        reason: 'fetch_failed',
        note:
          'USDA lookup failed (' +
          (err instanceof Error ? err.message : String(err)) +
          '). Estimate the macros from your own knowledge and proceed.',
      };
    }
  }
);
