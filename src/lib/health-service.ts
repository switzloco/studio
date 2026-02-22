export interface HealthData {
  steps: number;
  hrv: number;
  sleepHours: number;
  recoveryStatus: 'low' | 'medium' | 'high';
  proteinGrams: number;
  visceralFatPoints: number;
}

// Mutable singleton state for the demo session
let currentHealth: HealthData = {
  steps: 8432,
  hrv: 62,
  sleepHours: 7.2,
  recoveryStatus: 'medium',
  proteinGrams: 110,
  visceralFatPoints: 1250,
};

export const mockHealthService = {
  async getHealthSummary(): Promise<HealthData> {
    // Simulating minor latency
    await new Promise(resolve => setTimeout(resolve, 100));
    return { ...currentHealth };
  },

  async updateHealthData(updates: Partial<HealthData>): Promise<HealthData> {
    console.log("Updating Vitals:", updates);
    currentHealth = { 
      ...currentHealth, 
      ...updates,
      // Ensure we don't go below zero
      proteinGrams: Math.max(0, (updates.proteinGrams !== undefined ? updates.proteinGrams : currentHealth.proteinGrams)),
      visceralFatPoints: Math.max(0, (updates.visceralFatPoints !== undefined ? updates.visceralFatPoints : currentHealth.visceralFatPoints))
    };
    return { ...currentHealth };
  },

  async requestPermissions(): Promise<boolean> {
    console.log("Mock: Requesting Google Health Connect read permissions...");
    return true;
  }
};
