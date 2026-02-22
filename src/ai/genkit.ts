import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

/**
 * @fileOverview Genkit initialization for Gemini 1.5 Pro.
 * Optimized for complex fitness portfolio auditing.
 */

export const ai = genkit({
  plugins: [googleAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY })],
  model: 'googleai/gemini-1.5-pro',
});
