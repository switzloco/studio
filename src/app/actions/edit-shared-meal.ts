'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { checkRateLimit } from '@/lib/rate-limit';
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
    // 1. Strict input bounds so public visitors cannot submit oversized prompts
    if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
      return { success: false, error: 'Invalid meal items list.' };
    }
    const cleanRequest = (editRequest || '').trim();
    if (!cleanRequest || cleanRequest.length > 400) {
      return { success: false, error: 'Edit request must be between 1 and 400 characters.' };
    }

    // 2. Global shared-meal edit rate limit bucket to cap worst-case unauthenticated spend
    const limit = await checkRateLimit('public_shared_meal_edit', 'chat');
    if (!limit.ok) {
      return { success: false, error: `Busy right now — please try again in ${limit.retryAfter}s.` };
    }

    // 3. Use gemini-2.5-flash-lite (72% lower token cost) for simple arithmetic portion edits
    const { output } = await ai.generate({
      model: 'googleai/gemini-2.5-flash-lite',
      output: { schema: EditResponseSchema },
      prompt: `You are editing a meal's food items based on a user's natural language request.

Current items (JSON):
${JSON.stringify(items, null, 2)}

User request: "${cleanRequest}"

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
