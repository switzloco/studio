import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

/**
 * @fileOverview Genkit initialization for the modern Gemini 2.0 Flash engine.
 * Optimized for speed and complex analytical reasoning in fitness auditing.
 */

export const ai = genkit({
  plugins: [googleAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY })],
  model: 'googleai/gemini-2.0-flash',
});
