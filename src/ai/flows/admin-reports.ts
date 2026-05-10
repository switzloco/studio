import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { getWeeklyMetrics } from '@/lib/admin-metrics';

/**
 * @fileOverview Genkit flow to generate a weekly executive summary of app usage.
 */

export const adminReportFlow = ai.defineFlow(
  {
    name: 'admin_report_flow',
    inputSchema: z.void(),
    outputSchema: z.object({
      summary: z.string(),
      metrics: z.any(),
    }),
  },
  async () => {
    const metrics = await getWeeklyMetrics();

    const response = await ai.generate({
      prompt: `
        You are the Executive Reporting Assistant for "The CFO" (Chief Fitness Officer) app.
        Generate a professional, concise weekly summary for the founder (Nicholas Switzer).
        
        Metrics for the period ${metrics.dateRange.start} to ${metrics.dateRange.end}:
        - Total Users: ${metrics.totalUsers}
        - Daily Active Users (DAU): ${metrics.dau}
        - Weekly Active Users (WAU): ${metrics.wau}
        - New Users This Week: ${metrics.newUsersWeek}
        - Total Food Logs: ${metrics.totalFoodLogsWeek}
        - Total Exercise Logs: ${metrics.totalExerciseLogsWeek}
        - Estimated AI Interactions (LLM Calls): ${metrics.totalLLMCallsWeek}
        
        The tone should be "Financial Executive" — data-driven, slightly bullish but realistic, using metaphors from the finance world (e.g., "Active liquidity", "Asset engagement", "Operational overhead").
        
        Keep it to 3 short paragraphs. Include a "Key Takeaway" bullet point at the end.
      `,
    });

    return {
      summary: response.text,
      metrics,
    };
  }
);
