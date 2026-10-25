import { NextResponse } from 'next/server';
import { ai, SAFETY_SETTINGS } from '@/ai/genkit';
import { verifyAuthHeaderDetails } from '@/firebase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkServerEntitlement } from '@/lib/entitlements-server';

// ~5 MB of raw audio encodes to ~6.7 MB base64; cap the data URI at 7 MB.
const MAX_AUDIO_DATA_URI_BYTES = 7 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const auth = await verifyAuthHeaderDetails(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { uid } = auth;

    const entitlement = await checkServerEntitlement(auth);
    if (!entitlement.allowed) {
      return NextResponse.json(
        {
          error: `Voice dictation requires an active CFO Retainer after your ${entitlement.freeLimit} complimentary AI audits.`,
          code: 'PAYWALL_LIMIT_REACHED',
          entitlement,
        },
        { status: 402 },
      );
    }

    const limit = await checkRateLimit(uid, 'transcribe');
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Rate limit hit (${limit.scope}). Try again in ${limit.retryAfter}s.` },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      );
    }

    const { audioDataUri } = await req.json();

    if (!audioDataUri || typeof audioDataUri !== 'string') {
      return NextResponse.json({ error: 'audioDataUri is required' }, { status: 400 });
    }

    if (audioDataUri.length > MAX_AUDIO_DATA_URI_BYTES) {
      return NextResponse.json({ error: 'Audio too large (max ~5 MB)' }, { status: 413 });
    }

    // Use gemini-2.5-flash-lite for pure speech-to-text (cuts transcription cost by 72%)
    const { text } = await ai.generate({
      model: 'googleai/gemini-2.5-flash-lite',
      config: { safetySettings: SAFETY_SETTINGS },
      prompt: [
        { media: { url: audioDataUri } },
        { text: 'Transcribe the audio exactly as spoken. Return only the transcription text, nothing else.' },
      ],
    });

    return NextResponse.json({ text: text?.trim() ?? '' });
  } catch (error: any) {
    console.error('[TranscribeRoute] Error:', error?.message ?? String(error));
    return NextResponse.json({ error: error?.message ?? String(error) }, { status: 500 });
  }
}
