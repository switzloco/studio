/**
 * @fileOverview Serper.dev web search tool for the CFO AI Coach.
 * Used for fitness research, supplement science, workout programming, and anything
 * the USDA nutrition tool doesn't cover.
 * Requires SERPER_API_KEY in environment. Throws a clear error if missing.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

export const webSearchTool = ai.defineTool(
  {
    name: 'web_search',
    description:
      'Searches the web for current fitness, health, and supplement research. ' +
      'Use for: exercise programming, recovery science, supplement efficacy, ' +
      'product comparisons, or anything outside the nutrition_lookup tool\'s scope. ' +
      'Returns top 5 search results with title, URL, and snippet.',
    inputSchema: z.object({
      query: z.string().describe('Search query, e.g. "kettlebell swing muscle activation research"'),
    }),
    outputSchema: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string(),
      })
    ),
  },
  async (input) => {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      throw new Error(
        'SERPER_API_KEY is not set. Add it to your .env.local to enable web search.'
      );
    }

    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: input.query, num: 5 }),
    });

    if (!res.ok) {
      throw new Error(`Serper API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const organic: Array<{ title: string; link: string; snippet: string }> =
      data.organic ?? [];

    return organic.slice(0, 5).map((r) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
    }));
  }
);
