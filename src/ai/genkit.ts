import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

/**
 * @fileOverview Genkit initialization for Gemini 3 Pro Preview.
 * Configured with thinking level HIGH for complex coaching reasoning.
 */

export const ai = genkit({
  plugins: [googleAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY })],
  model: 'googleai/gemini-3-pro-preview',
});
