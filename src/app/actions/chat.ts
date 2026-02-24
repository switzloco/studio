
'use server';

import { personalizedAICoaching } from '@/ai/flows/personalized-ai-coaching';
import { initializeFirebase } from '@/firebase/sdk';

/**
 * @fileOverview Server Action for sending chat messages to the CFO AI Coach.
 */

export async function sendChatMessage(
  message: string, 
  chatHistory: { role: 'user' | 'model', content: string }[],
  currentHealth: any,
  photoDataUri?: string,
  userId?: string,
  userName?: string
) {
  try {
    if (!userId) throw new Error("Anonymous UID required for audit.");

    // Get current day of the week for the AI context
    const currentDay = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date());

    const response = await personalizedAICoaching({
      userId,
      userName,
      message,
      currentDay,
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
