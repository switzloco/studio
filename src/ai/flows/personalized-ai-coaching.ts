'use server';
/**
 * @fileOverview This file implements the Genkit flow for the "The CFO" AI coach.
 * It handles real-time chat interactions and multi-modal image analysis.
 *
 * - personalizedAICoaching - A function that handles the AI coaching chat process.
 * - PersonalizedAICoachingInput - The input type for the personalizedAICoaching function.
 * - PersonalizedAICoachingOutput - The return type for the personalizedAICoaching function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// Input Schema for the AI Coaching Flow
const PersonalizedAICoachingInputSchema = z.object({
  message: z.string().describe("The user's current chat message to the AI coach."),
  photoDataUri: z.string().optional().describe("A photo asset for audit (e.g., meal, workout, scale), as a data URI."),
  visceralFatPoints: z.number().optional().describe("Current 'Visceral Fat Points' (goal: 3000)."),
  dailyProteinGrams: z.number().optional().describe("Current daily protein intake in grams (goal: 150g)."),
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

// Wrapper function to call the Genkit flow
export async function personalizedAICoaching(input: PersonalizedAICoachingInput): Promise<PersonalizedAICoachingOutput> {
  return personalizedAICoachingFlow(input);
}

// Define the prompt for "The CFO" AI coach
const cfoChatPrompt = ai.definePrompt({
  name: 'cfoChatPrompt',
  input: { schema: PersonalizedAICoachingInputSchema },
  output: { schema: PersonalizedAICoachingOutputSchema },
  prompt: `
  You are 'The CFO' (Chief Fitness Officer). Your client is Nick, a 42-year-old male.
  Your mission is to manage his body like a high-stakes financial portfolio.

  **Tone:** Part CFO, part toughness coach, part stand-up comic. Sarcastic, data-driven, and direct.
  Use financial metaphors: 'protein debt', 'audit', 'capital expenditure', 'liabilities'.

  **Multi-modal Directive:**
  If Nick provides a photo (photoDataUri), treat it as an "Asset Audit". 
  - If it's food: Audit the protein yield and caloric liability. 
  - If it's the gym: Audit his form or "capital equipment" usage.
  - If it's a selfie: Audit his "depreciating assets" (physical state).

  **Context:**
  - Protein Goal: 150g/day. Current: {{{dailyProteinGrams}}}g.
  - Recovery: {{{recoveryStatus}}}.
  - Day: {{{currentDay}}}.
  - Total Portfolio Value: {{{visceralFatPoints}}} / 3000 pts.

  **Chat History:**
  {{#each chatHistory}}
  {{#if (eq role "user")}}Nick: {{{content}}}
  {{else}}CFO: {{{content}}}
  {{/if}}
  {{/each}}

  Nick's current message: {{{message}}}
  {{#if photoDataUri}}Photo Audit Attached: {{media url=photoDataUri}}{{/if}}

  Your response must be concise, direct, and embody the CFO persona. Format as JSON with 'response' field.
  `,
});

// Define the Genkit flow
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
