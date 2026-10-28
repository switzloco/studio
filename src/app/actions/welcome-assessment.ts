'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService as healthService } from '@/lib/health-service-admin';
import { checkRateLimit } from '@/lib/rate-limit';
import type { SharedMealItem } from '@/lib/food-exercise-types';

const AssessmentSchema = z.object({
  assessment: z
    .string()
    .describe('A playful, honest 2-3 sentence take on the meal that ends with a warm, low-pressure invite to try the CFO.'),
});

export type WelcomeAssessmentResult =
  | { success: true; assessment: string }
  | { success: false; error: string };

interface MealSummary {
  /** Required: cached on the share document so each shared meal only generates once. */
  shareId?: string;
  title: string;
  createdByName?: string;
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number; fiberG: number };
  items: Pick<SharedMealItem, 'name' | 'calories' | 'proteinG' | 'carbsG' | 'fatG'>[];
}

/**
 * The "welcome CFO" greeting on a shared-meal landing page.
 * Guarded against unauthenticated bot abuse:
 *   1. Checks Firestore for an existing cached `cfoAssessment` first (0 LLM cost on repeat views).
 *   2. Applies rate limiting per shareId/public bucket.
 *   3. Uses `gemini-2.5-flash-lite` (72% lower token cost).
 */
export async function assessSharedMeal(meal: MealSummary): Promise<WelcomeAssessmentResult> {
  try {
    const db = getAdminFirestore();

    if (meal.shareId) {
      const existingShare = await healthService.getSharedMeal(db, meal.shareId);
      if (!existingShare || existingShare.revoked) {
        return { success: false, error: 'Shared meal not found.' };
      }
      if (existingShare.cfoAssessment) {
        return { success: true, assessment: existingShare.cfoAssessment };
      }
    }

    const limit = await checkRateLimit(`share_welcome_${meal.shareId || 'anon'}`, 'chat');
    if (!limit.ok) {
      return { success: false, error: 'Rate limit reached.' };
    }

    const { totals, items, title, createdByName } = meal;
    const itemList = (items || [])
      .slice(0, 15)
      .map(i => `${String(i.name).slice(0, 80)} (${Math.round(i.calories)} cal, ${Math.round(i.proteinG)}g protein)`)
      .join(', ');

    const { output } = await ai.generate({
      model: 'googleai/gemini-2.5-flash-lite',
      output: { schema: AssessmentSchema },
      prompt: `You are "the CFO" — a warm, witty health coach who talks about food like a financial portfolio (protein = assets, calories = budget, fiber/plants = long-term holdings). ${createdByName ? `${String(createdByName).slice(0, 50)} just shared this meal` : 'Someone just shared this meal'} with a friend, who has NEVER used the app and just opened the link. You are greeting that friend.

Meal: "${String(title).slice(0, 100)}"
Items: ${itemList || 'n/a'}
Totals: ${Math.round(totals.calories)} cal, ${Math.round(totals.proteinG)}g protein, ${Math.round(totals.carbsG)}g carbs, ${Math.round(totals.fatG)}g fat, ${Math.round(totals.fiberG)}g fiber

Write a short greeting (2-3 sentences, max ~45 words) that:
- Opens with a PLAYFUL, HONEST one-liner about this specific meal's macros. Be genuinely honest — if protein is strong, celebrate it; if it's a treat/indulgent, tease it warmly. Use a light financial metaphor, but at most one — don't overdo the jargon.
- NEVER scold, shame, or moralize. No "you should", no calorie panic, no fitness-bro intensity. A new person should feel welcomed, not judged.
- Ends with a warm, genuinely low-pressure invite to try the CFO — something like "want to see how a meal like this scores your day, or just look around?" Make clear there's zero obligation.
- Sounds like a clever friend, not a brand. No emoji spam (one is fine), no hashtags, no exclamation overload.

Return only the greeting text.`,
    });

    if (!output?.assessment) return { success: false, error: 'No response from AI.' };

    const assessment = output.assessment.trim();
    if (meal.shareId) {
      await healthService.saveShareAssessment(db, meal.shareId, assessment);
    }

    return { success: true, assessment };
  } catch (err: any) {
    console.error('[WelcomeAssessment] error:', err?.message ?? String(err));
    return { success: false, error: err?.message ?? 'Could not generate assessment.' };
  }
}
