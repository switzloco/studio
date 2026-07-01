import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse, after } from 'next/server';
import { handleInboundChannelMessage } from '@/lib/messaging/gateway';
import { markChannelEventProcessed } from '@/lib/messaging/links';
import { splitMessage, toWhatsAppFormatting, WHATSAPP_MAX_MESSAGE_LEN } from '@/lib/messaging/format';

/**
 * @fileOverview Meta WhatsApp Cloud API webhook — lets clients chat with the
 * CFO over WhatsApp. See docs/MESSAGING_CHANNELS.md for setup.
 *
 *   GET  /api/webhooks/whatsapp  → Meta's one-time verification handshake.
 *   POST /api/webhooks/whatsapp  → inbound messages (HMAC-signed by Meta).
 *
 * Env: WHATSAPP_VERIFY_TOKEN (handshake), WHATSAPP_APP_SECRET (signature),
 * WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID (sending replies).
 *
 * Meta redelivers on slow responses, so POST acks immediately and does the
 * AI turn in after(); duplicate deliveries are deduped by message id (wamid).
 */

const GRAPH_API_VERSION = 'v21.0';

interface WhatsAppTextMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
}

interface WhatsAppWebhookBody {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        messages?: WhatsAppTextMessage[];
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
      };
    }>;
  }>;
}

function isValidSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const given = signatureHeader.slice('sha256='.length);
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'));
  } catch {
    return false;
  }
}

async function sendWhatsAppText(to: string, text: string): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.error('[WhatsAppWebhook] Cannot reply — WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID unset.');
    return;
  }

  for (const chunk of splitMessage(toWhatsAppFormatting(text), WHATSAPP_MAX_MESSAGE_LEN)) {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: chunk },
      }),
    });
    if (!res.ok) {
      console.error(`[WhatsAppWebhook] Send failed (${res.status}):`, await res.text());
      return; // don't spray remaining chunks after a failure
    }
  }
}

/** Meta's webhook verification handshake (done once when registering the URL). */
export async function GET(req: Request) {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const { searchParams } = new URL(req.url);
  if (
    verifyToken &&
    searchParams.get('hub.mode') === 'subscribe' &&
    searchParams.get('hub.verify_token') === verifyToken
  ) {
    return new NextResponse(searchParams.get('hub.challenge') ?? '', { status: 200 });
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

export async function POST(req: Request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: 'WhatsApp webhook not configured (WHATSAPP_APP_SECRET unset).' }, { status: 503 });
  }

  const rawBody = await req.text();
  if (!isValidSignature(rawBody, req.headers.get('x-hub-signature-256'), appSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: WhatsAppWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (body.object !== 'whatsapp_business_account') {
    return NextResponse.json({ received: true });
  }

  // Ack immediately (Meta retries slow webhooks); run the AI turn after the response.
  after(async () => {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue; // status callbacks etc.
        const value = change.value;
        for (const message of value?.messages ?? []) {
          try {
            const firstTime = await markChannelEventProcessed('whatsapp', message.id);
            if (!firstTime) continue;

            if (message.type !== 'text' || !message.text?.body) {
              await sendWhatsAppText(message.from, 'The WhatsApp desk handles text only for now — describe the meal or workout in words and I\'ll log it. Photo intake lives in the app.');
              continue;
            }

            const contact = value?.contacts?.find((c) => c.wa_id === message.from) ?? value?.contacts?.[0];
            const reply = await handleInboundChannelMessage({
              channel: 'whatsapp',
              externalUserId: message.from,
              displayName: contact?.profile?.name,
              text: message.text.body,
            });
            await sendWhatsAppText(message.from, reply);
          } catch (err: unknown) {
            console.error('[WhatsAppWebhook] Message processing failed:', (err as Error)?.message ?? String(err));
          }
        }
      }
    }
  });

  return NextResponse.json({ received: true });
}
