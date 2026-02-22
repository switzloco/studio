'use server';
/**
 * @fileOverview This file implements the Genkit flow for the "The CFO" AI coach.
 * It handles real-time chat interactions, multi-modal image analysis, and tool-based vital updates.
 * Uses Gemini 3 Pro Preview with relaxed safety settings and thinking config.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { mockHealthService } from '@/lib/health-service';

// Input Schema for the AI Coaching Flow
const PersonalizedAICoachingInputSchema = z.object({
  message: z.string().describe("The user's current chat message to the AI coach."),
  photoDataUri: z.string().optional().describe("A photo asset for audit (e.g., meal, workout, scale), as a data URI."),
  visceral_fat_points: z.number().optional().describe("Current 'Visceral Fat Points' (goal: 3000)."),
  protein_g: z.number().optional().describe("Current daily protein intake in grams (goal: 150g)."),
  recoveryStatus: z.enum(['low', 'medium', 'high']).optional().describe("Current recovery status based on sleep/HRV ('low', 'medium', 'high')."),
  recentWorkoutLoad: z.string().optional().describe("A summary of Nick's recent workout intensity or activity load."),
  currentDay: z.string().optional().describe("The current day of the week."),
  chatHistory: z.array(z.object({
    role: z.enum(['user', 'model']),
    content: z.string(),
  })).optional().describe("Previous chat messages to maintain context."),
});
export type PersonalizedAICoachingInput = z.infer<typeof PersonalizedAICoachingInputSchema>;

// Output Schema for the AI Coaching Flow
const PersonalizedAICoachingOutputSchema = z.object({
  response: z.string().describe("The AI coach's response to the user's message."),
});
export type PersonalizedAICoachingOutput = z.infer<typeof PersonalizedAICoachingOutputSchema>;

// TOOL: Update Vitals
const updateVitalsTool = ai.defineTool(
  {
    name: 'updateVitals',
    description: "Updates Nick's health portfolio metrics. Use this when Nick consumes protein, completes a workout, or earns points. You can add or subtract values.",
    inputSchema: z.object({
      protein_g: z.number().optional().describe('Grams of protein to ADD to the current total (can be negative).'),
      visceral_fat_points: z.number().optional().describe('Points to ADD to the visceral fat portfolio (can be negative).'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const current = await mockHealthService.getHealthSummary();
    await mockHealthService.updateHealthData({
      protein_g: current.protein_g + (input.protein_g || 0),
      visceral_fat_points: current.visceral_fat_points + (input.visceral_fat_points || 0),
    });
    return "Portfolio updated successfully. The new assets are reflected in the terminal.";
  }
);

// Define the prompt for "The CFO" AI coach
const cfoChatPrompt = ai.definePrompt({
  name: 'cfoChatPrompt',
  input: { schema: PersonalizedAICoachingInputSchema },
  output: { schema: PersonalizedAICoachingOutputSchema },
  tools: [updateVitalsTool],
  config: {
    safetySettings: [
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
    ],
  },
  prompt: `
  --- CRITICAL SYSTEM CONTEXT: PORTFOLIO DATA ---
  NICK'S CURRENT ASSETS:
  - Protein Inventory: {{{protein_g}}}g (Daily Target: 150g)
  - Portfolio Equity (Fat Points): {{{visceral_fat_points}}} (Goal: 3000)
  - Recovery Liquidity: {{{recoveryStatus}}}
  - Today: {{{currentDay}}}
  - Recent CapEx Audit: {{{recentWorkoutLoad}}}

  --- IDENTITY OVERRIDE ---
  YOU ARE THE CHIEF FITNESS OFFICER (CFO). 
  TONE: Sarcastic, data-driven, tough-love, financial metaphor heavy. 
  
  **ROASTING RULES:**
  Do NOT roast Nick for things he has already achieved. 
  If protein_g is >= 110g, he is SOLVENT. Do NOT call it a "penny stock". Use "solid" or "stable" if he's close to target.
  If protein_g is 150g+, he is an INSTITUTIONAL BULL. Praise the liquidity.
  
  **TOOL USAGE:**
  If Nick reports consuming protein (e.g., "I just had a 50g shake") or completing a task, call 'updateVitals' immediately. 

  **Multi-modal Directive:**
  If a photo (photoDataUri) is provided, perform an immediate "Asset Audit". 

  **Chat History:**
  {{#each chatHistory}}
  {{role}}: {{{content}}}
  {{/each}}

  Nick's Current Message: {{{message}}}
  {{#if photoDataUri}}Photo Audit Attached: {{media url=photoDataUri}}{{/if}}
  
  CFO RESPONSE:
  `,
});

const personalizedAICoachingFlow = ai.defineFlow(
  {
    name: 'personalizedAICoachingFlow',
    inputSchema: PersonalizedAICoachingInputSchema,
    outputSchema: PersonalizedAICoachingOutputSchema,
  },
  async (input) => {
    const { output } = await cfoChatPrompt(input);
    if (!output) {
      throw new Error('AI coach did not return a response.');
    }
    return output;
  }
);

export async function personalizedAICoaching(input: PersonalizedAICoachingInput): Promise<PersonalizedAICoachingOutput> {
  return personalizedAICoachingFlow(input);
}
