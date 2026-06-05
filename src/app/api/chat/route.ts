import { NextResponse } from 'next/server';
import { cfoChatPrompt, PersonalizedAICoachingInput } from '@/ai/flows/personalized-ai-coaching';
import { verifyAuthHeader, getAdminFirestore } from '@/firebase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { adminHealthService } from '@/lib/health-service-admin';
import type { ChatMessage } from '@/lib/food-exercise-types';

/**
 * Cap on how many prior messages we feed back into the model each turn. We
 * STORE the full day's transcript for visibility, but only RESEND a sliding
 * window — real memory lives in the structured food/exercise logs, so a short
 * window keeps token cost flat regardless of how chatty the day gets.
 */
const MAX_SENT_HISTORY = 12;

/**
 * Persist a single turn to the day's transcript (fire-and-forget). Photos are
 * recorded as a marker only — base64 is never stored. The `__init__` sentinel
 * the client sends to trigger the greeting is not a real user message, so it is
 * not stored; the greeting itself (model reply) is.
 */
async function persistChatTurn(
  uid: string,
  date: string,
  userMessage: string,
  hasPhotos: boolean,
  modelText: string,
): Promise<void> {
  const now = Date.now();
  const msgs: ChatMessage[] = [];
  if (userMessage && userMessage !== '__init__') {
    msgs.push({ role: 'user', content: userMessage, ...(hasPhotos ? { hasImages: true } : {}), ts: now });
  }
  if (modelText.trim()) {
    msgs.push({ role: 'model', content: modelText, ts: now + 1 });
  }
  if (msgs.length === 0) return;
  try {
    await adminHealthService.appendChatMessages(getAdminFirestore(), uid, date, msgs);
  } catch (err: any) {
    console.error('[ChatRoute] Failed to persist transcript:', err?.message ?? String(err));
  }
}

export async function POST(req: Request) {
  try {
    const uid = await verifyAuthHeader(req);
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const limit = await checkRateLimit(uid, 'chat');
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Rate limit hit (${limit.scope}). Try again in ${limit.retryAfter}s.` },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      );
    }

    const body = await req.json();
    const { message, chatHistory, currentHealth, userName, localDate, localTime, photoDataUris, photoTimestamps, photoDates } = body;

    const resolvedDate = localDate || new Date().toISOString().split('T')[0];
    const [yr, mo, dy] = resolvedDate.split('-').map(Number);
    const currentDay = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date(yr, mo - 1, dy));

    const isNewDay = currentHealth?.lastActiveDate !== resolvedDate;
    const sanitizedHealth = isNewDay
      ? { ...currentHealth, dailyProteinG: 0, dailyCaloriesIn: 0, dailyCarbsG: 0 }
      : currentHealth;

    // Only resend the most recent slice of the conversation to the model.
    const trimmedHistory = Array.isArray(chatHistory)
      ? chatHistory.slice(-MAX_SENT_HISTORY)
      : chatHistory;

    const input: PersonalizedAICoachingInput = {
      userId: uid,
      userName,
      message,
      currentDay,
      localDate: resolvedDate,
      localTime: localTime || new Date().toLocaleTimeString('en-US'),
      chatHistory: trimmedHistory,
      currentHealth: sanitizedHealth,
      photoDataUris,
      photoTimestamps,
      photoDates,
    };

    let stream;
    try {
      const result = await cfoChatPrompt.stream(input, { maxTurns: 15 });
      stream = result.stream;
    } catch (err: any) {
      console.warn('[ChatRoute] Primary model failed, trying fallback model (gemini-2.0-flash):', err?.message ?? String(err));
      try {
        const result = await cfoChatPrompt.stream(input, {
          model: 'googleai/gemini-2.0-flash',
          maxTurns: 15,
        });
        stream = result.stream;
      } catch (fallbackErr: any) {
        console.error('[ChatRoute] Fallback model also failed:', fallbackErr?.message ?? String(fallbackErr));
        
        // Return a friendly system error message directly as a successful stream so it renders in the chat
        const encoder = new TextEncoder();
        const readableStream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `⚠️ **System Interruption**\n\n` +
                `Partner, the Gemini neural ledger is currently experiencing high demand or is temporarily unavailable (503 Service Unavailable).\n\n` +
                `I have received your message: *"${message}"*.\n\n` +
                `**Recommendation:**\n` +
                `* Your logs/details are safe in this chat history, but I cannot process them or run calculations right now.\n` +
                `* Please try again in a minute, or ask me to check the ledger again once the API recovers.`
              )
            );
            controller.close();
          },
        });

        return new NextResponse(readableStream, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      }
    }

    const encoder = new TextEncoder();
    const hasPhotos = Array.isArray(photoDataUris) && photoDataUris.length > 0;
    const readableStream = new ReadableStream({
      async start(controller) {
        let fullText = '';
        try {
          for await (const chunk of stream) {
            if (chunk.text) {
              fullText += chunk.text;
              controller.enqueue(encoder.encode(chunk.text));
            }
          }
        } catch (err: any) {
          console.error('[ChatRoute] Error during stream playback:', err?.message ?? String(err));
          controller.enqueue(
            encoder.encode(
              `\n\n⚠️ **Stream Disrupted** — *The connection to the AI engine was lost mid-generation. Please resend your message or try again.*`
            )
          );
        } finally {
          controller.close();
          // Persist the completed turn for daily visibility. Fire-and-forget —
          // the response has already streamed, so this never blocks the user.
          void persistChatTurn(uid, resolvedDate, message, hasPhotos, fullText);
        }
      },
    });

    return new NextResponse(readableStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('[ChatRoute] Error:', error?.message ?? String(error));
    return NextResponse.json({ error: error?.message ?? String(error) }, { status: 500 });
  }
}
