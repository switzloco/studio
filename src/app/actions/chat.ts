'use server';

import { personalizedAICoaching } from '@/ai/flows/personalized-ai-coaching';
import { mockHealthService } from '@/lib/health-service';

export async function sendChatMessage(
  message: string, 
  chatHistory: { role: 'user' | 'model', content: string }[],
  photoDataUri?: string
) {
  try {
    const health = await mockHealthService.getHealthSummary();
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const currentDay = dayNames[new Date().getDay()];

    const response = await personalizedAICoaching({
      message,
      photoDataUri,
      chatHistory,
      visceralFatPoints: health.visceralFatPoints,
      dailyProteinGrams: health.proteinGrams,
      recoveryStatus: health.recoveryStatus,
      currentDay,
      recentWorkoutLoad: "Moderate activity audit. Recent frisbee and basketball high-intensity movements.",
    });

    return { success: true, response: response.response };
  } catch (error) {
    console.error("Chat flow error:", error);
    return { success: false, error: "The CFO is currently reviewing other portfolios. Market is closed." };
  }
}
