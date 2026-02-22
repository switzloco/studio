export interface HealthData {
  steps: number;
  hrv: number;
  sleepHours: number;
  recoveryStatus: 'low' | 'medium' | 'high';
  proteinGrams: number;
  visceralFatPoints: number;
}

export const mockHealthService = {
  async getHealthSummary(): Promise<HealthData> {
    // Simulating API latency
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Generating consistent pseudo-random metrics for Nick
    const hour = new Date().getHours();
    
    return {
      steps: 8432,
      hrv: 62,
      sleepHours: 7.2,
      recoveryStatus: 'medium',
      proteinGrams: hour > 14 ? 110 : 45, // Simulating mid-day protein intake
      visceralFatPoints: 1250,
    };
  },

  async requestPermissions(): Promise<boolean> {
    console.log("Mock: Requesting Google Health Connect read permissions...");
    return true;
  }
};
