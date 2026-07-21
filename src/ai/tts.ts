/**
 * @fileOverview Google Cloud Text-to-Speech — narrates the Campaign Mode
 * Daily Brief. Uses Application Default Credentials, the same mechanism
 * firebase-admin already relies on in src/firebase/admin.ts (no separate
 * service account key needed on Firebase App Hosting), provided the Cloud
 * Text-to-Speech API is enabled on the project and the App Hosting service
 * account has permission to call it.
 */

import { TextToSpeechClient, protos } from '@google-cloud/text-to-speech';

let client: TextToSpeechClient | null = null;

function getClient(): TextToSpeechClient {
  if (!client) client = new TextToSpeechClient();
  return client;
}

/** Synthesizes text to speech in a deep, measured "Chronicler" narrator voice. Returns base64-encoded MP3 audio. */
export async function synthesizeCampaignBrief(text: string): Promise<string> {
  const request: protos.google.cloud.texttospeech.v1.ISynthesizeSpeechRequest = {
    input: { text },
    voice: { languageCode: 'en-GB', name: 'en-GB-Neural2-D', ssmlGender: 'MALE' },
    audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95, pitch: -2 },
  };

  const [response] = await getClient().synthesizeSpeech(request);
  if (!response.audioContent) {
    throw new Error('Cloud Text-to-Speech returned no audio content.');
  }
  return Buffer.from(response.audioContent as Uint8Array).toString('base64');
}
