import { NextResponse } from 'next/server';
import { shareIngestionFlow } from '@/ai/flows/share-ingestion';
import { verifyAuthHeader } from '@/firebase/admin';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * POST /api/ingest-share
 * Receives raw shared text from the /incoming-share page,
 * runs it through the Coach LLM parser, and writes to Firestore.
 *
 * Request body: { rawText, sourceTitle?, sourceUrl?, localDate, localTime }
 * Auth: Bearer token (Firebase ID token)
 */
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
    const { rawText, sourceTitle, sourceUrl, localDate, localTime } = body;

    if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
      return NextResponse.json({ error: 'Missing or empty rawText.' }, { status: 400 });
    }

    const result = await shareIngestionFlow({
      userId: uid,
      rawText: rawText.trim(),
      sourceTitle: sourceTitle || undefined,
      sourceUrl: sourceUrl || undefined,
      localDate: localDate || new Date().toISOString().split('T')[0],
      localTime: localTime || new Date().toTimeString().slice(0, 5),
    });

    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (error: any) {
    console.error('[IngestShare] Error:', error?.message ?? String(error));
    return NextResponse.json({ error: error?.message ?? String(error) }, { status: 500 });
  }
}
