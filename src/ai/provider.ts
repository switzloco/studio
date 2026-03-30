import { createGoogleGenerativeAI } from '@ai-sdk/google';

export const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });
export const flashModel = google('gemini-2.0-flash');
