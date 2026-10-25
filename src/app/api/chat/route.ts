import { NextResponse } from 'next/server';
import { cfoChatPrompt, PersonalizedAICoachingInput } from '@/ai/flows/personalized-ai-coaching';
import { runWithShareOffer, getShareOffer } from '@/ai/flows/share-offer-context';
import { verifyAuthHeaderDetails, getAdminFirestore } from '@/firebase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkServerEntitlement, recordAiAuditTurn } from '@/lib/entitlements-server';
import { adminHealthService } from '@/lib/health-service-admin';
import type { ChatMessage } from '@/lib/food-exercise-types';
import { SHARE_OFFER_SENTINEL } from '@/lib/share-offer';
import { fetchSlimUserContext } from '@/lib/user-context';

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
    const auth = await verifyAuthHeaderDetails(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { uid } = auth;

    const body = await req.json();
    const { message, chatHistory, currentHealth, userName, localDate, localTime, photoDataUris, photoTimestamps, photoDates, modelTier } = body;

    // Input size safety bounds (prevents abusive payloads)
    if (typeof message === 'string' && message.length > 6000) {
      return NextResponse.json({ error: 'Message too long (max 6,000 chars).' }, { status: 400 });
    }
    if (Array.isArray(photoDataUris) && photoDataUris.length > 5) {
      return NextResponse.json({ error: 'Maximum 5 photos per audit.' }, { status: 400 });
    }

    const isInitGreeting = message === '__init__';

    // 1. Check Founder / Pro / Free AI Audit Entitlement
    const entitlement = await checkServerEntitlement(auth, { isInitGreeting });
    if (!entitlement.allowed) {
      return NextResponse.json(
        {
          error: `You've used all ${entitlement.freeLimit} complimentary AI Coach audits. Retain the AI CFO for unlimited coaching, or use the Zero-AI Daily Cockpit & Quick Log free forever.`,
          code: 'PAYWALL_LIMIT_REACHED',
          entitlement,
        },
        { status: 402 },
      );
    }

    // 2. Check abuse rate limit
    const limit = await checkRateLimit(uid, 'chat');
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Rate limit hit (${limit.scope}). Try again in ${limit.retryAfter}s.` },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      );
    }

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

    // Always preload slim user context so the LLM never wastes an 11,500-token
    // tool round-trip calling get_user_context mid-conversation.
    let preloadedContext: string | undefined;
    try {
      const ctx = await fetchSlimUserContext(getAdminFirestore(), uid, resolvedDate);
      preloadedContext = JSON.stringify(ctx);
    } catch (e) {
      console.warn('[ChatRoute] preloadedContext fetch skipped:', e);
    }

    const input: PersonalizedAICoachingInput = {
      userId: uid,
      userName,
      message,
      currentDay,
      localDate: resolvedDate,
      localTime: localTime || new Date().toLocaleTimeString('en-US'),
      preloadedContext,
      chatHistory: trimmedHistory,
      currentHealth: sanitizedHealth,
      photoDataUris: Array.isArray(photoDataUris)
        ? photoDataUris.map((uri: string) => ({ url: uri, contentType: extractContentType(uri) }))
        : undefined,
      photoTimestamps,
      photoDates,
    };

    const selectedModel = modelTier === 'flash-lite'
      ? 'googleai/gemini-2.5-flash-lite'
      : undefined;

    // Creates the model stream with a fallback model. Kept inside the ALS scope
    // (see below) so any tool calls that fire during generation can record a
    // share offer for this turn.
    const openStream = async () => {
      try {
        const result = await cfoChatPrompt.stream(input, {
          ...(selectedModel ? { model: selectedModel } : {}),
          maxTurns: 8,
        });
        return result.stream;
      } catch (err: any) {
        const msg = String(err?.message ?? err ?? '').toLowerCase();
        const status = err?.status || err?.statusCode;
        if (status === 429 || msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('quota')) {
          throw err;
        }
        console.warn('[ChatRoute] Primary model failed, trying fallback model (gemini-2.0-flash):', err?.message ?? String(err));
        const result = await cfoChatPrompt.stream(input, {
          model: 'googleai/gemini-2.0-flash',
          maxTurns: 8,
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
          let streamSucceeded = false;
          try {
            const stream = await openStream();
            for await (const chunk of stream) {
              if (chunk.text) {
                fullText += chunk.text;
                controller.enqueue(encoder.encode(chunk.text));
              }
            }
            streamSucceeded = fullText.trim().length > 0;

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
            // Persist the completed turn for daily visibility and increment free-tier audit counter
            void persistChatTurn(uid, resolvedDate, message, hasPhotos, fullText);
            if (streamSucceeded) {
              void recordAiAuditTurn(auth, isInitGreeting);
            }
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
