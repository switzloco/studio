import { NextResponse } from 'next/server';
import { ledgerAnalystPrompt, PersonalizedAICoachingInput } from '@/ai/flows/personalized-ai-coaching';
import { verifyAuthHeaderDetails, getAdminFirestore } from '@/firebase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkServerEntitlement, recordAiAuditTurn } from '@/lib/entitlements-server';
import { fetchSlimUserContext } from '@/lib/user-context';

export async function POST(req: Request) {
  try {
    const auth = await verifyAuthHeaderDetails(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { uid } = auth;

    // 1. Check Founder / Pro / Free AI Audit Entitlement
    const entitlement = await checkServerEntitlement(auth);
    if (!entitlement.allowed) {
      return NextResponse.json(
        {
          error: entitlement.requiresSignIn
            ? 'Guest preview complete (5 free turns). Sign in free with Google or Email to unlock your full 15-audit starter pack or redeem a Friends & Family credit pass.'
            : `You've used all ${entitlement.freeLimit} complimentary AI audits. Retain the AI CFO to unlock unlimited Ledger Analyst queries, or export your full CSV/JSON ledger free forever.`,
          code: 'PAYWALL_LIMIT_REACHED',
          entitlement,
        },
        { status: 402 },
      );
    }

    const limit = await checkRateLimit(uid, 'chat');
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Rate limit hit (${limit.scope}). Try again in ${limit.retryAfter}s.` },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      );
    }

    const body = await req.json();
    const { message, chatHistory, userName, localDate } = body;

    const resolvedDate = localDate ?? new Date().toISOString().split('T')[0];
    const currentDay = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date());

    let preloadedContext: string | undefined;
    try {
      const ctx = await fetchSlimUserContext(getAdminFirestore(), uid, resolvedDate);
      preloadedContext = JSON.stringify(ctx);
    } catch {
      // Optional preload
    }

    const input: PersonalizedAICoachingInput = {
      userId: uid,
      userName,
      message,
      currentDay,
      localDate: resolvedDate,
      localTime: new Date().toLocaleTimeString('en-US'),
      preloadedContext,
      chatHistory: Array.isArray(chatHistory) ? chatHistory.slice(-10) : chatHistory,
    };

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        let hasOutput = false;
        try {
          const { stream } = await ledgerAnalystPrompt.stream(input, { maxTurns: 8 });
          for await (const chunk of stream) {
            if (chunk.text) {
              hasOutput = true;
              controller.enqueue(encoder.encode(chunk.text));
            }
          }
        } catch (streamErr: any) {
          console.warn('[LedgerChatRoute] SSE stream failed, falling back to non-streaming:', streamErr?.message ?? String(streamErr));
          if (!hasOutput) {
            try {
              const fallback = await ledgerAnalystPrompt(input, { maxTurns: 8 });
              if (fallback?.text) {
                hasOutput = true;
                controller.enqueue(encoder.encode(fallback.text));
              }
            } catch (fbErr: any) {
              controller.enqueue(
                encoder.encode(
                  `⚠️ **Ledger Analyst Interruption**\n\nCould not complete query: \`${fbErr?.message ?? streamErr?.message ?? 'Unknown error'}\`. Please try again.`
                )
              );
            }
          }
        } finally {
          controller.close();
          if (hasOutput) {
            void recordAiAuditTurn(auth, false);
          }
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
    console.error('[LedgerChatRoute] Error:', error?.message ?? String(error));
    return NextResponse.json({ error: error?.message ?? String(error) }, { status: 500 });
  }
}
