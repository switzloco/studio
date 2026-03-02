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
      'Looks up accurate macro data (protein, carbs, fat, calories) for a food from the USDA database. ' +
      'Use this PROACTIVELY whenever the client mentions eating something or asks about macros. ' +
      'Do NOT guess macros — look them up. Returns per-100g values.',
    inputSchema: z.object({
      query: z.string().describe('Food name to look up, e.g. "chicken breast" or "Greek yogurt"'),
      portionG: z
        .number()
        .optional()
        .describe('Optional portion size in grams to calculate totals for that portion'),
    }),
    outputSchema: z.object({
      foodName: z.string(),
      per100g: z.object({
        calories: z.number(),
        proteinG: z.number(),
        carbsG: z.number(),
        fatG: z.number(),
        fiberG: z.number(),
      }),
      portionTotals: z
        .object({
          portionG: z.number(),
          calories: z.number(),
          proteinG: z.number(),
          carbsG: z.number(),
          fatG: z.number(),
        })
        .optional(),
      source: z.string(),
    }),
  },
  async (input) => {
    const apiKey = process.env.USDA_FOOD_API_KEY ?? 'DEMO_KEY';

    const searchParams = new URLSearchParams({
      query: input.query,
      api_key: apiKey,
      pageSize: '3',
      dataType: 'SR Legacy,Foundation,Branded',
    });

    const searchRes = await fetch(`${USDA_BASE}/foods/search?${searchParams}`, {
      headers: { Accept: 'application/json' },
    });

    if (!searchRes.ok) {
      throw new Error(`USDA API error: ${searchRes.status} ${searchRes.statusText}`);
    }

    const searchData = await searchRes.json();
    const foods: UsdaFood[] = searchData.foods ?? [];

    if (foods.length === 0) {
      throw new Error(`No USDA data found for "${input.query}". Try a more specific food name.`);
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
  }
);
