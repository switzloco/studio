'use server';
/**
 * @fileOverview This file implements the Genkit flow for the "The CFO" AI coach.
 * Returns both text response and structural commands for the client to execute.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const PersonalizedAICoachingInputSchema = z.object({
  message: z.string(),
  photoDataUri: z.string().optional(),
  visceral_fat_points: z.number().optional(),
  protein_g: z.number().optional(),
  recoveryStatus: z.enum(['low', 'medium', 'high']).optional(),
  currentDay: z.string().optional(),
  history: z.array(z.object({
    date: z.string(),
    gain: z.number(),
    status: z.string(),
    detail: z.string(),
    equity: z.number(),
  })).optional(),
  chatHistory: z.array(z.object({
    role: z.enum(['user', 'model']),
    content: z.string(),
  })).optional(),
});

const PersonalizedAICoachingOutputSchema = z.object({
  response: z.string(),
  commands: z.array(z.object({
    type: z.enum(['UPDATE_VITALS', 'CORRECT_HISTORY', 'BATCH_UPDATE']),
    payload: z.any()
  })).optional(),
});

export type PersonalizedAICoachingInput = z.infer<typeof PersonalizedAICoachingInputSchema>;
export type PersonalizedAICoachingOutput = z.infer<typeof PersonalizedAICoachingOutputSchema>;

// Define the prompt
const cfoChatPrompt = ai.definePrompt({
  name: 'cfoChatPrompt',
  input: { schema: PersonalizedAICoachingInputSchema },
  output: { schema: PersonalizedAICoachingOutputSchema },
  prompt: `
  YOU ARE THE CHIEF FITNESS OFFICER (CFO). 
  TONE: Sarcastic, data-driven, tough-love, financial metaphor heavy. 
  
  CURRENT PORTFOLIO:
  - Protein: {{{protein_g}}}g (Target: 150g)
  - Equity (VF Points): {{{visceral_fat_points}}} (Goal: 3000)
  - Recovery: {{{recoveryStatus}}}
  
  HISTORICAL LOG:
  {{#each history}}
  - {{{this.date}}}: Gain {{{this.gain}}} | Status {{{this.status}}} | Total {{{this.equity}}}
  {{/each}}

  ROASTING RULES:
  1. If protein_g < 110g, they are in DEBT. Roast them.
  2. If they just did a workout, use the 'UPDATE_VITALS' command.
  3. If they correct a record, use 'CORRECT_HISTORY'.
  4. If they upload a spreadsheet image, use 'BATCH_UPDATE'.

  COMMANDS:
  You MUST include a command in the 'commands' array if Nick reports new data.
  - UPDATE_VITALS: { "protein_g": number, "visceral_fat_points": number } (ADDITIVE values)
  - CORRECT_HISTORY: { "date": string, "gain": number, "status": string, "detail": string, "equity": number }
  - BATCH_UPDATE: { "entries": Array<{ date, gain, status, detail, equity }> }

  Nick's Message: {{{message}}}
  {{#if photoDataUri}}Asset Audit Attached: {{media url=photoDataUri}}{{/if}}
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
    return output!;
  }
);

export async function personalizedAICoaching(input: PersonalizedAICoachingInput): Promise<PersonalizedAICoachingOutput> {
  return personalizedAICoachingFlow(input);
}
