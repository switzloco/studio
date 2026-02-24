
/**
 * @fileOverview Fitbit service for the CFO audit.
 * Manages hardware verification and cloud-to-cloud synchronization.
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
  /**
   * Generates the authorization URL for the client.
   * @param userId The ID of the portfolio to link.
   */
  getAuthUrl(userId: string): string {
    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID || 'MOCK_ID';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:9002';
    const redirectUri = `${origin}/api/auth/fitbit/callback`;
    const scope = 'activity heartrate sleep profile';
    
    // We pass userId in the 'state' parameter to maintain audit trail during callback
    return `https://www.fitbit.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${userId}`;
  },

  /**
   * Mock sync returns 'device' source for verification auditing.
   * Day 1: Returns simulated hardware data.
   * Day 2: Will fetch from Fitbit Web API.
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
