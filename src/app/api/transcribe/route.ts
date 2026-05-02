import { NextResponse } from 'next/server';
import { ai, SAFETY_SETTINGS } from '@/ai/genkit';
import { verifyAuthHeader } from '@/firebase/admin';

// ~5 MB of raw audio encodes to ~6.7 MB base64; cap the data URI at 7 MB.
const MAX_AUDIO_DATA_URI_BYTES = 7 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const uid = await verifyAuthHeader(req);
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { audioDataUri } = await req.json();

    if (!audioDataUri || typeof audioDataUri !== 'string') {
      return NextResponse.json({ error: 'audioDataUri is required' }, { status: 400 });
    }

    if (audioDataUri.length > MAX_AUDIO_DATA_URI_BYTES) {
      return NextResponse.json({ error: 'Audio too large (max ~5 MB)' }, { status: 413 });
    }

    const { text } = await ai.generate({
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
