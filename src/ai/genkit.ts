import {genkit} from 'genkit';
import {googleAI, vertexAI} from '@genkit-ai/google-genai';

/**
 * @fileOverview Genkit initialization for the Gemini 3.5 Flash engine on Vertex AI.
 * Optimized for speed and complex analytical reasoning in fitness auditing.
 *
 * Uses Vertex AI Express Mode with GOOGLE_GENAI_API_KEY so inference bills directly
 * to the GCP Blaze billing account (immune to AI Studio 402 prepayment credit depletion).
 *
 * The model is env-overridable via CFO_MODEL so the engine can be swapped
 * without a code change (defaults to vertexai/gemini-3.5-flash).
 */

export const CFO_MODEL = process.env.CFO_MODEL ?? 'vertexai/gemini-3.5-flash';
export const CFO_LITE_MODEL = process.env.CFO_LITE_MODEL ?? 'vertexai/gemini-3.1-flash-lite';

export const ai = genkit({
  plugins: [
    vertexAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY }),
    googleAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY }),
  ],
  model: CFO_MODEL,
});

export const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HATE_SPEECH',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT',  threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HARASSMENT',         threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',  threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
];
