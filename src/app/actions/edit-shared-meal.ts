'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import type { SharedMealItem } from '@/lib/food-exercise-types';

const ItemSchema = z.object({
  name: z.string(),
  portionG: z.number(),
  calories: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  fiberG: z.number(),
  source: z.enum(['usda', 'web_search', 'user_estimate']),
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  plantMassG: z.number().optional(),
  glycemicIndex: z.number().optional(),
  omega3Mg: z.number().optional(),
  caffeineMg: z.number().optional(),
  hasElectrolytes: z.boolean().optional(),
  alcoholDrinks: z.number().optional(),
  hasSeedOils: z.boolean().optional(),
  consumedAt: z.string().optional(),
});

const EditResponseSchema = z.object({
  items: z.array(ItemSchema),
  summary: z.string(),
});

export type EditSharedMealResult =
  | { success: true; items: SharedMealItem[]; summary: string }
  | { success: false; error: string };

export async function editSharedMeal(
  items: SharedMealItem[],
  editRequest: string,
): Promise<EditSharedMealResult> {
  try {
    const { output } = await ai.generate({
      output: { schema: EditResponseSchema },
      prompt: `You are editing a meal's food items based on a user's natural language request.

Current items (JSON):
${JSON.stringify(items, null, 2)}

User request: "${editRequest}"

Apply the user's edit:
- Scale macros proportionally when the user changes portion sizes ("half", "double", "just a little", etc.)
- Remove items the user says they skipped or didn't eat
- Never add new items that weren't in the original list
- Keep all optional fields (plantMassG, etc.) and scale them proportionally too
- If the user requests something impossible or irrelevant, return the items unchanged
- summary: one short sentence describing what changed (e.g. "Halved the butter chicken portions.")

Return the updated items array and a brief summary.`,
    });

    if (!output) return { success: false, error: 'No response from AI.' };

    return { success: true, items: output.items as SharedMealItem[], summary: output.summary };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Could not process edit.' };
  }
}
