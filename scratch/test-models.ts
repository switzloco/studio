import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const apiKey = process.env.GOOGLE_GENAI_API_KEY;
console.log('Using API key:', apiKey ? apiKey.substring(0, 8) + '...' : 'undefined');

const ai = genkit({
  plugins: [googleAI({ apiKey })],
});

const modelsToTest = [
  'googleai/gemini-3.1-flash-lite',
  'googleai/gemini-3.1-flash',
  'googleai/gemini-3-flash',
  'googleai/gemini-2.5-flash',
  'googleai/gemini-2.0-flash',
  'googleai/gemini-1.5-flash',
  'googleai/gemini-2.5-pro',
  'googleai/gemini-2.0-pro-exp',
  'googleai/gemini-1.5-pro',
];

async function test() {
  for (const model of modelsToTest) {
    try {
      console.log(`Testing model: ${model}...`);
      const res = await ai.generate({
        model,
        prompt: 'say pong',
      });
      console.log(`✅ Success with ${model}: ${res.text.trim()}`);
    } catch (e: any) {
      console.error(`❌ Failed with ${model}:`, e.message ?? String(e));
    }
  }
}

test();
