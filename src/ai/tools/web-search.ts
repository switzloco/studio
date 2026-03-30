/**
 * @fileOverview Serper.dev web search tool for the CFO AI Coach.
 * Used for fitness research, supplement science, workout programming, and anything
 * the USDA nutrition tool doesn't cover.
 * Requires SERPER_API_KEY in environment. Returns graceful fallback if missing.
 */

import { tool } from 'ai';
import { z } from 'zod';

export const webSearchTool = tool({
  description:
    'Searches the web for current fitness, health, and supplement research. ' +
    'Use for: exercise programming, recovery science, supplement efficacy, ' +
    "product comparisons, or anything outside the nutrition_lookup tool's scope. " +
    'Returns top 5 search results with title, URL, and snippet.',
  parameters: z.object({
    query: z.string().describe('Search query, e.g. "kettlebell swing muscle activation research"'),
  }),
  execute: async (input) => {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      // No API key — return gracefully so the LLM falls back to built-in knowledge
      return [{ title: 'Web search unavailable', url: '', snippet: 'Search is not configured. Use built-in knowledge to answer.' }];
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
  },
});
