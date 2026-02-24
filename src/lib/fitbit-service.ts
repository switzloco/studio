/**
 * @fileOverview Mock Fitbit service for "Day 1" of the CFO audit.
 * In a production environment, this would handle OAuth2 exchange and cloud-to-cloud sync.
 */

export interface FitbitSyncResult {
  success: boolean;
  steps: number;
  sleep: number;
  hrv: number;
}

export const fitbitService = {
  /**
   * Generates the OAuth2 Authorization URL for Fitbit.
   */
  getAuthUrl(): string {
    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID || 'MOCK_ID';
    const redirectUri = typeof window !== 'undefined' ? `${window.location.origin}/api/auth/fitbit/callback` : '';
    const scope = 'activity heartrate sleep profile';
    return `https://www.fitbit.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;
  },

  /**
   * Mock sync for Day-Zero onboarding.
   */
  async syncDayOneData(): Promise<FitbitSyncResult> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    return {
      success: true,
      steps: 8432,
      sleep: 7.2,
      hrv: 62
    };
  }
};
