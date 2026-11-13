import { describe, expect, it } from 'vitest';
import { renderUserSummaryEmailHtml, type UserSummaryMetrics } from '../admin-metrics';

describe('renderUserSummaryEmailHtml', () => {
  it('renders 3-day KPI strip, outreach counts, AI cost, and escaped user roster rows', () => {
    const metrics: UserSummaryMetrics = {
      periodDays: 3,
      dateRange: { start: '2026-11-10', end: '2026-11-12' },
      totalUsers: 12,
      registeredUsers: 5,
      anonymousUsers: 7,
      dau: 3,
      activeUsersPeriod: 4,
      wau: 5,
      newUsersPeriod: 1,
      newUsersWeek: 2,
      outreachActiveUsers: 3,
      outreach3xUsers: 3,
      outreachMorningOnlyUsers: 0,
      totalFoodLogsPeriod: 9,
      totalExerciseLogsPeriod: 4,
      totalFoodLogsWeek: 9,
      totalExerciseLogsWeek: 4,
      totalLLMCallsPeriod: 14,
      totalLLMCallsWeek: 14,
      totalAiCostUsdPeriod: 0.0124,
      roster: [
        {
          uid: 'u1',
          name: 'gina switzer',
          email: 'gina.switzer@gmail.com',
          tier: 'free',
          outreachStatus: '3x/day Email',
          outreachActive: true,
          lastOutreachInteraction: '2026-11-12',
          lastActiveDate: '2026-11-12',
          foodLogsPeriod: 2,
          exerciseLogsPeriod: 1,
          latestMealLabel: 'Salmon & Asparagus (520 kcal, 46g P)',
          dailyProteinG: 110,
          proteinGoalG: 150,
          visceralFatPoints: 143,
          aiCallsPeriod: 3,
          aiCostUsdPeriod: 0.0005,
          isNewInPeriod: false,
        },
      ],
    };

    const html = renderUserSummaryEmailHtml({
      metrics,
      summary: 'Strong 3-day engagement with 3 users active on Daily Briefings.',
    });

    expect(html).toContain('3-Day Founder User Summary');
    expect(html).toContain('4 Active Users · 3 on Daily Briefings');
    expect(html).toContain('gina.switzer@gmail.com');
    expect(html).toContain('Salmon &amp; Asparagus (520 kcal, 46g P)');
    expect(html).toContain('$0.0124');
  });
});
