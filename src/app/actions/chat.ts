'use server';

import { personalizedAICoaching } from '@/ai/flows/personalized-ai-coaching';

export async function sendChatMessage(
  message: string, 
  chatHistory: { role: 'user' | 'model', content: string }[],
  currentHealth: any,
  photoDataUri?: string
) {
  try {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const currentDay = dayNames[new Date().getDay()];

    const response = await personalizedAICoaching({
      message,
      photoDataUri,
      chatHistory,
      visceral_fat_points: currentHealth.visceral_fat_points,
      protein_g: currentHealth.protein_g,
      recoveryStatus: currentHealth.recoveryStatus,
      currentDay,
      history: currentHealth.history,
    });

    return { success: true, response: response.response, commands: response.commands };
  } catch (error) {
    console.error("Chat flow error:", error);
    return { success: false, error: "The CFO is reviewing other portfolios. Market is closed." };
  }
}
