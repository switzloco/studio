'use server';

import { personalizedAICoaching } from '@/ai/flows/personalized-ai-coaching';
import { initializeFirebase } from '@/firebase';

export async function sendChatMessage(
  message: string, 
  chatHistory: { role: 'user' | 'model', content: string }[],
  currentHealth: any,
  photoDataUri?: string,
  userId?: string
) {
  try {
    if (!userId) throw new Error("Anonymous UID required for audit.");

    const response = await personalizedAICoaching({
      userId,
      message,
      photoDataUri,
      chatHistory,
      currentHealth,
    });

    return { success: true, response: response.response };
  } catch (error: any) {
    console.error("CFO Audit Interrupted:", error);
    return { success: false, error: "The CFO is reviewing other portfolios. Market is closed." };
  }
}
