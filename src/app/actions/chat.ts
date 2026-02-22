'use server';

import { personalizedAICoaching } from '@/ai/flows/personalized-ai-coaching';
import { mockHealthService } from '@/lib/health-service';

export async function sendChatMessage(
  message: string, 
  chatHistory: { role: 'user' | 'model', content: string }[],
  photoDataUri?: string
) {
  try {
    // RE-FETCH LIVE STATE: This ensures the CFO "sees" the dashboard and history before it speaks.
    const health = await mockHealthService.getHealthSummary();
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const currentDay = dayNames[new Date().getDay()];

    const response = await personalizedAICoaching({
      message,
      photoDataUri,
      chatHistory,
      visceral_fat_points: health.visceral_fat_points,
      protein_g: health.protein_g,
      recoveryStatus: health.recoveryStatus,
      currentDay,
      history: health.history,
      recentWorkoutLoad: "Activity audit: High-intensity assets active. Recent movement identified.",
    });

    return { success: true, response: response.response };
  } catch (error) {
    console.error("Chat flow error:", error);
    return { success: false, error: "The CFO is currently reviewing other portfolios. Market is closed." };
  }
}
