'use server';

import { personalizedAICoaching } from '@/ai/flows/personalized-ai-coaching';
import { mockHealthService } from '@/lib/health-service';

export async function sendChatMessage(message: string, chatHistory: { role: 'user' | 'model', content: string }[]) {
  try {
    const health = await mockHealthService.getHealthSummary();
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const currentDay = dayNames[new Date().getDay()];

    const response = await personalizedAICoaching({
      message,
      chatHistory,
      visceralFatPoints: health.visceralFatPoints,
      dailyProteinGrams: health.proteinGrams,
      recoveryStatus: health.recoveryStatus,
      currentDay,
      recentWorkoutLoad: "Moderate. Nick had Ultimate Frisbee yesterday and basketball at lunch on Monday.",
    });

    return { success: true, response: response.response };
  } catch (error) {
    console.error("Chat flow error:", error);
    return { success: false, error: "The CFO is currently reviewing other portfolios. Please try again." };
  }
}
