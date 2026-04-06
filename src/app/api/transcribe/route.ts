import { NextResponse } from 'next/server';
import { ai } from '@/ai/genkit';

export async function POST(req: Request) {
  try {
    const { audioDataUri } = await req.json();

    if (!audioDataUri || typeof audioDataUri !== 'string') {
      return NextResponse.json({ error: 'audioDataUri is required' }, { status: 400 });
    }

    const { text } = await ai.generate({
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
