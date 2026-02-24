
/**
 * @fileOverview Mock Fitbit service for "Day 1" of the CFO audit.
 * Now includes verification sources to distinguish between hardware and manual data.
 */

export interface FitbitMetric {
  value: number;
  source: 'device' | 'manual';
}

export interface FitbitSyncResult {
  success: boolean;
  steps: FitbitMetric;
  sleep: FitbitMetric;
  hrv: FitbitMetric;
  isVerified: boolean;
}

export const fitbitService = {
  getAuthUrl(): string {
    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID || 'MOCK_ID';
    const redirectUri = typeof window !== 'undefined' ? `${window.location.origin}/api/auth/fitbit/callback` : '';
    const scope = 'activity heartrate sleep profile';
    return `https://www.fitbit.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;
  },

  /**
   * Mock sync returns 'device' source for verification auditing.
   */
  async syncDayOneData(): Promise<FitbitSyncResult> {
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    return {
      success: true,
      steps: { value: 8432, source: 'device' },
      sleep: { value: 7.2, source: 'device' },
      hrv: { value: 62, source: 'device' },
      isVerified: true
    };
  }
};
