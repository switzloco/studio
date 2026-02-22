'use server';
/**
 * @fileOverview This file implements the Genkit flow for the "The CFO" AI coach.
 * It handles real-time chat interactions, multi-modal image analysis, and tool-based vital updates.
 * Includes support for historical audit sheet ingestion and granular record correction.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { mockHealthService } from '@/lib/health-service';

// Input Schema for the AI Coaching Flow
const PersonalizedAICoachingInputSchema = z.object({
  message: z.string().describe("The user's current chat message to the AI coach."),
  photoDataUri: z.string().optional().describe("A photo asset for audit (e.g., meal, workout, scale, or historical spreadsheet), as a data URI."),
  visceral_fat_points: z.number().optional().describe("Current 'Visceral Fat Points' (goal: 3000)."),
  protein_g: z.number().optional().describe("Current daily protein intake in grams (goal: 150g)."),
  recoveryStatus: z.enum(['low', 'medium', 'high']).optional().describe("Current recovery status based on sleep/HRV ('low', 'medium', 'high')."),
  recentWorkoutLoad: z.string().optional().describe("A summary of Nick's recent workout intensity or activity load."),
  currentDay: z.string().optional().describe("The current day of the week."),
  history: z.array(z.object({
    date: z.string(),
    gain: z.number(),
    status: z.string(),
    detail: z.string(),
    equity: z.number(),
  })).optional().describe("The current historical audit log for context."),
  chatHistory: z.array(z.object({
    role: z.enum(['user', 'model']),
    content: z.string(),
  })).optional().describe("Previous chat messages to maintain context."),
});
export type PersonalizedAICoachingInput = z.infer<typeof PersonalizedAICoachingInputSchema>;

const PersonalizedAICoachingOutputSchema = z.object({
  response: z.string().describe("The AI coach's response to the user's message."),
});
export type PersonalizedAICoachingOutput = z.infer<typeof PersonalizedAICoachingOutputSchema>;

// TOOL: Update Vitals
const updateVitalsTool = ai.defineTool(
  {
    name: 'updateVitals',
    description: "Updates Nick's current daily health portfolio metrics. Use this for real-time protein or point additions.",
    inputSchema: z.object({
      protein_g: z.number().optional().describe('Grams of protein to ADD to the current daily total.'),
      visceral_fat_points: z.number().optional().describe('Points to ADD to the visceral fat portfolio.'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const current = await mockHealthService.getHealthSummary();
    await mockHealthService.updateHealthData({
      protein_g: current.protein_g + (input.protein_g || 0),
      visceral_fat_points: current.visceral_fat_points + (input.visceral_fat_points || 0),
    });
    return "Portfolio updated successfully.";
  }
);

// TOOL: Correct History Entry
const correctHistoryEntryTool = ai.defineTool(
  {
    name: 'correctHistoryEntry',
    description: "Corrects a specific historical record based on new facts or misunderstandings. Use this for targeted fixes.",
    inputSchema: z.object({
      date: z.string().describe("The exact date string of the record to correct (e.g., 'Oct 23')."),
      gain: z.number().optional().describe("The corrected gain/loss points for that day."),
      status: z.enum(['Bullish', 'Stable', 'Correction']).optional().describe("The corrected market sentiment."),
      detail: z.string().optional().describe("Corrected notes about the day."),
      equity: z.number().optional().describe("Corrected running total Visceral Fat Score."),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const { date, ...updates } = input;
    await mockHealthService.updateHistoryEntry(date, updates as any);
    return `Audit record for ${date} has been recalibrated.`;
  }
);

// TOOL: Batch Update History
const batchUpdateHistoryTool = ai.defineTool(
  {
    name: 'batchUpdateHistory',
    description: "Ingests bulk historical audit data from a spreadsheet photo. Replaces the current log with fresh audit data.",
    inputSchema: z.object({
      entries: z.array(z.object({
        date: z.string().describe("The date of the entry."),
        gain: z.number().describe("The VF Score delta for that day."),
        status: z.enum(['Bullish', 'Stable', 'Correction']).describe("Market sentiment."),
        detail: z.string().describe("Notes about the day."),
        equity: z.number().describe("The running total VF Score."),
      })),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const entries = input.entries.map(e => ({
      ...e,
      status: e.status as 'Bullish' | 'Stable' | 'Correction'
    }));
    await mockHealthService.batchUpdateHistory(entries);
    return "Historical portfolio records ingested successfully. The growth curve has been recalibrated.";
  }
);

// Define the prompt for "The CFO" AI coach
const cfoChatPrompt = ai.definePrompt({
  name: 'cfoChatPrompt',
  input: { schema: PersonalizedAICoachingInputSchema },
  output: { schema: PersonalizedAICoachingOutputSchema },
  tools: [updateVitalsTool, batchUpdateHistoryTool, correctHistoryEntryTool],
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
  - Protein Inventory: {{{protein_g}}}g (Target: 150g)
  - Portfolio Equity: {{{visceral_fat_points}}} (Goal: 3000)
  - Recovery Liquidity: {{{recoveryStatus}}}
  - Today: {{{currentDay}}}
  
  --- HISTORICAL AUDIT LOG ---
  {{#each history}}
  - Date: {{{this.date}}} | Gain: {{{this.gain}}} | Status: {{{this.status}}} | Equity: {{{this.equity}}}
  {{/each}}

  --- IDENTITY OVERRIDE ---
  YOU ARE THE CHIEF FITNESS OFFICER (CFO). 
  TONE: Sarcastic, data-driven, tough-love, financial metaphor heavy. 
  
  **ROASTING & CORRECTION RULES:**
  1. If Nick corrects a historical misunderstanding (e.g., "Monday was actually Bullish"), use 'correctHistoryEntry' to fix the specific day.
  2. If protein_g is >= 110g, he is SOLVENT. 
  3. If Nick provides a photo of a spreadsheet, use 'batchUpdateHistory'.

  **Chat History:**
  {{#each chatHistory}}
  {{role}}: {{{content}}}
  {{/each}}

  Nick's Current Message: {{{message}}}
  {{#if photoDataUri}}Audit Asset Attached: {{media url=photoDataUri}}{{/if}}
  
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
