import { NextResponse } from 'next/server';
import { cfoChatPrompt, PersonalizedAICoachingInput } from '@/ai/flows/personalized-ai-coaching';
import { runWithShareOffer, getShareOffer } from '@/ai/flows/share-offer-context';
import { verifyAuthHeader, getAdminFirestore } from '@/firebase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { adminHealthService } from '@/lib/health-service-admin';
import type { ChatMessage } from '@/lib/food-exercise-types';
import { SHARE_OFFER_SENTINEL } from '@/lib/share-offer';

/**
 * Cap on how many prior messages we feed back into the model each turn. We
 * STORE the full day's transcript for visibility, but only RESEND a sliding
 * window — real memory lives in the structured food/exercise logs, so a short
 * window keeps token cost flat regardless of how chatty the day gets.
 */
const MAX_SENT_HISTORY = 12;

function extractContentType(dataUri: string): string {
  const match = dataUri.match(/^data:([^;]+);/);
  return match?.[1] ?? 'image/jpeg';
}

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
      photoDataUris: Array.isArray(photoDataUris)
        ? photoDataUris.map((uri: string) => ({ url: uri, contentType: extractContentType(uri) }))
        : undefined,
      photoTimestamps,
      photoDates,
    };

    // Creates the model stream with a fallback model. Kept inside the ALS scope
    // (see below) so any tool calls that fire during generation can record a
    // share offer for this turn.
    const openStream = async () => {
      try {
        const result = await cfoChatPrompt.stream(input, { maxTurns: 15 });
        return result.stream;
      } catch (err: any) {
        console.warn('[ChatRoute] Primary model failed, trying fallback model (gemini-2.0-flash):', err?.message ?? String(err));
        const result = await cfoChatPrompt.stream(input, {
          model: 'googleai/gemini-2.0-flash',
          maxTurns: 15,
        });
        return result.stream;
      }
    };

    const encoder = new TextEncoder();
    const hasPhotos = Array.isArray(photoDataUris) && photoDataUris.length > 0;
    const readableStream = new ReadableStream({
      async start(controller) {
        // One share-offer scope per chat turn — tools called during streaming
        // write into it; we read it back once the text finishes.
        await runWithShareOffer(async () => {
          let fullText = '';
          try {
            const stream = await openStream();
            for await (const chunk of stream) {
              if (chunk.text) {
                fullText += chunk.text;
                controller.enqueue(encoder.encode(chunk.text));
              }
            }

            // The agent may have surfaced a "share this meal" chip via the
            // offer_meal_share tool. Append it AFTER the text as a sentinel the
            // client parses and strips — never persisted to the transcript.
            const offer = getShareOffer();
            if (offer) {
              controller.enqueue(encoder.encode(`${SHARE_OFFER_SENTINEL}${JSON.stringify(offer)}`));
            }
          } catch (err: any) {
            const detail = err?.message ?? String(err);
            console.error('[ChatRoute] Stream failed:', detail, err?.stack ?? '');
            // Mid-generation failures and total model failures both land here —
            // render a friendly message inline so the chat never hangs.
            controller.enqueue(
              encoder.encode(
                fullText
                  ? `\n\n⚠️ **Stream Disrupted** — *The connection to the AI engine was lost mid-generation.*\n\n\`\`\`\n${detail}\n\`\`\``
                  : `⚠️ **System Interruption**\n\nPartner, the Gemini neural ledger could not be reached.\n\n` +
                    `I have received your message: *"${message}"*.\n\n**Diagnostics:** \`${detail}\`\n\nPlease try again in a minute.`
              )
            );
          } finally {
            controller.close();
            // Persist the completed turn for daily visibility. Fire-and-forget —
            // the response has already streamed, so this never blocks the user.
            void persistChatTurn(uid, resolvedDate, message, hasPhotos, fullText);
          }
        });
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
