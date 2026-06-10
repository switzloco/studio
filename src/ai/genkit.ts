// Phoenix/OpenTelemetry instrumentation must be registered before Genkit so its
// spans flow to the configured exporter. This import is a no-op when
// PHOENIX_ENABLED !== 'true'. (Next.js also wires it via instrumentation.ts;
// importing here covers the Genkit dev server / standalone flow runs.)
import '@/ai/observability/phoenix';

import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

/**
 * @fileOverview Genkit initialization for the Gemini 3 Flash engine.
 * Optimized for speed and complex analytical reasoning in fitness auditing.
 *
 * The model is env-overridable via CFO_MODEL so the engine can be swapped
 * without a code change (defaults to Gemini 3 Flash).
 */

// Gemini 3 Flash (GA). Override via CFO_MODEL — e.g. a preview variant like
// googleai/gemini-3-flash-preview.
export const CFO_MODEL = process.env.CFO_MODEL ?? 'googleai/gemini-3.5-flash';

export const ai = genkit({
  plugins: [googleAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY })],
  model: CFO_MODEL,
});

export const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HATE_SPEECH',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT',  threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HARASSMENT',         threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',  threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
];
