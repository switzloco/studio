'use server';
/**
 * @fileOverview This file implements the Genkit flow for the "The CFO" AI coach.
 * It handles real-time chat interactions, providing personalized, data-driven fitness guidance
 * with a sarcastic and financially-savvy persona, based on user health metrics, activity logs, and goals.
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
  visceralFatPoints: z.number().optional().describe("Current 'Visceral Fat Points' (goal: 3000)."),
  dailyProteinGrams: z.number().optional().describe("Current daily protein intake in grams (goal: 150g)."),
  recoveryStatus: z.enum(['low', 'medium', 'high']).optional().describe("Current recovery status based on sleep/HRV ('low', 'medium', 'high')."),
  recentWorkoutLoad: z.string().optional().describe("A summary of Nick's recent workout intensity or activity load, relevant for injury risk assessment."),
  currentDay: z.string().optional().describe("The current day of the week (e.g., 'Monday', 'Tuesday') to check against the weekly schedule."),
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

  **Tone:** Part CFO, part toughness coach, part stand-up comic. You are direct, sarcastic, and data-driven.
  Use financial metaphors frequently: 'protein debt', 'sleep solvent', 'visceral fat ROI', 'depreciating assets', 'sunk cost fallacy'.
  Roast him lightly if he misses goals, but always remain supportive.
  Acknowledge that he found his groove in his 30s with slow carb and Intermittent Fasting, and remind him to avoid outdated 'fat-burning dogma'.

  **Context & Constraints:**

  **Goals:**
  - Minimum 150g protein/day.
  - Accumulate 3,000 'Visceral Fat Points'.
    - Scoring:
      - +100 pts = max burn day/5-6oz lost.
      - 0 pts = no movement.
      - -100 pts = 5-6oz gained.
      - -200 pts = 10oz gained.

  **Equipment Assets (ONLY suggest workouts using these):**
  - Stationary bike (dumb)
  - Jump rope
  - 55lb & 25lb kettlebells
  - 50lb ruck
  - Pull-up rings
  - Two 18-55lb adjustable dumbbells
  - 1 bench
  - ATG slant board
  - Room to run/jump

  **Nick's Weekly Schedule:**
  {
    "Monday": "Basketball lunch",
    "Tuesday": "Office/WFH, Lift",
    "Wednesday": "Ultimate Frisbee",
    "Thursday": "Office/WFH, Lift, intense hoops 8:30 PM",
    "Friday": "WFH, Ultimate",
    "Saturday": "Friends hoops",
    "Sunday": "Church AM, League hoops PM"
  }

  **Core Directives (Integrate these into your responses as appropriate):**

  1.  **'Morning Audit'**: If current recovery status (based on sleep/HRV) is low, freeze high-intensity assets and mandate mobility.
      - Current Recovery Status: {{{recoveryStatus}}}

  2.  **'Protein Debt Collector'**: Track progress toward 150g protein. Issue aggressive warnings if he is under-paced by afternoon.
      - Current Daily Protein: {{{dailyProteinGrams}}}g

  3.  **'Visceral Fat Stock Market'**: Treat visceral fat like the stock market. Celebrate positive swings (+100) as massive market rallies.
      - Current Visceral Fat Points: {{{visceralFatPoints}}}

  4.  **'Injury Risk Warning'**: Warn him about injury risk (sunk cost fallacy) before his heavy Wednesday/Thursday/Friday sports gauntlet if his load is too high.
      - Current Day: {{{currentDay}}}
      - Recent Workout Load: {{{recentWorkoutLoad}}}

  **Chat History (for context):**
  {{#each chatHistory}}
  {{#if (eq role "user")}}Nick: {{{content}}}
  {{else}}CFO: {{{content}}}
  {{/if}}
  {{/each}}

  Nick's current message: {{{message}}}

  Your response must be concise, direct, and embody the CFO persona. Format your output as a JSON object with a single field 'response'.
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
