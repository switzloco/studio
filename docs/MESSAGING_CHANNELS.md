# Messaging Channels — WhatsApp & Discord

The CFO answers messages from WhatsApp and Discord using the exact same Genkit
flow, tools, rate limits, and per-day transcript as the in-app chat. A meal
texted from WhatsApp lands in the same ledger and shows up in the app
immediately. WhatsApp is the primary channel; Discord ships alongside it and
the gateway is channel-agnostic, so more channels can be added by writing one
webhook adapter.

## Architecture

```
WhatsApp Cloud API ──▶ POST /api/webhooks/whatsapp ─┐
                                                     ├─▶ handleInboundChannelMessage()   src/lib/messaging/gateway.ts
Discord Interactions ─▶ POST /api/webhooks/discord ─┘        │
                                                             ├─ resolves channel_links/{channel}:{externalId} → Firebase uid
                                                             ├─ rate-limits (same 'chat' bucket as /api/chat)
                                                             ├─ replays today's chat_sessions transcript as history
                                                             ├─ runs personalizedAICoaching (full CFO tool suite)
                                                             └─ persists the turn back to chat_sessions/{date}
```

Both webhooks ACK immediately and do the AI turn in Next.js `after()` —
Meta redelivers after ~10s of silence and Discord requires an ack within 3s,
both far shorter than a coaching turn. Redeliveries are deduped in
`channel_events` (docs carry an `expiresAt` field; optionally enable a
Firestore TTL policy on it).

### Account linking

Linking is chat-first — no settings UI needed:

1. In the app, the client tells the CFO **"link my WhatsApp"** (or Discord).
2. The `create_channel_link_code` tool mints a one-time 6-char code
   (`channel_link_codes/{CODE}`, 15-minute TTL, single use). The client's
   timezone offset is estimated from the turn's localDate/localTime and stored
   with the code so day boundaries are right in the external channel.
3. The client sends `LINK <code>` from WhatsApp (or `/cfo message: LINK <code>`
   in Discord). The webhook consumes the code atomically and writes
   `channel_links/{channel}:{externalUserId}` → uid.
4. `UNLINK` from the channel disconnects it.

All three collections are Admin-SDK-only; Firestore security rules deny all
client access by default.

## WhatsApp setup (Meta WhatsApp Cloud API)

1. Create a Meta app at <https://developers.facebook.com> and add the
   **WhatsApp** product. The test number works for development; register a real
   business number for production.
2. Set env vars:
   - `WHATSAPP_VERIFY_TOKEN` — any random string you choose; used once in the
     webhook verification handshake.
   - `WHATSAPP_APP_SECRET` — App Settings → Basic → App Secret. Used to verify
     the `X-Hub-Signature-256` HMAC on every delivery.
   - `WHATSAPP_ACCESS_TOKEN` — a System User token with `whatsapp_business_messaging`
     permission (the dashboard's temporary token works for dev).
   - `WHATSAPP_PHONE_NUMBER_ID` — WhatsApp → API Setup → Phone number ID.
3. In WhatsApp → Configuration, set the webhook callback URL to
   `https://<your-domain>/api/webhooks/whatsapp` with your verify token, and
   subscribe to the **messages** webhook field.
4. Text the number. First message returns linking instructions; after
   `LINK <code>` the CFO takes over.

Notes:
- Only **text** messages are handled; media messages get a polite "text only
  for now" reply (photo intake stays in the app).
- Replies are chunked to WhatsApp's 4096-char cap and the CFO's markdown is
  down-converted (`**bold**` → `*bold*`).
- WhatsApp's 24-hour customer-service window applies: the bot can always reply
  to an inbound message, but proactive outbound (e.g. a future daily-audit
  nudge) would require an approved template message.

## Discord setup (Interactions endpoint — no gateway bot)

1. Create an application at <https://discord.com/developers/applications>.
2. Set env var `DISCORD_PUBLIC_KEY` (General Information → Public Key).
3. Set **Interactions Endpoint URL** to
   `https://<your-domain>/api/webhooks/discord`. Discord sends a signed PING;
   the route must be deployed first.
4. Register the `/cfo` slash command (once, global):

   ```bash
   curl -X POST "https://discord.com/api/v10/applications/<APPLICATION_ID>/commands" \
     -H "Authorization: Bot <BOT_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "cfo",
       "description": "Talk to your CFO fitness coach",
       "options": [{
         "type": 3, "name": "message", "required": true,
         "description": "What do you want to tell the CFO?"
       }],
       "integration_types": [0, 1],
       "contexts": [0, 1, 2]
     }'
   ```

5. Install the app to a server (or as a user app) and run
   `/cfo message: LINK <code>`.

Notes:
- The interactions endpoint means no persistent bot process — it fits
  Firebase App Hosting's serverless model. Requests are verified with the
  app's ed25519 public key.
- Replies over Discord's 2000-char cap are sent as follow-up messages.

## Security model

- **WhatsApp**: every POST is HMAC-SHA256 verified against `WHATSAPP_APP_SECRET`
  (timing-safe compare); the GET handshake checks `WHATSAPP_VERIFY_TOKEN`.
- **Discord**: every POST is ed25519-verified against `DISCORD_PUBLIC_KEY`.
- Unconfigured channels return 503 and process nothing.
- External identities only reach a ledger through a code minted *inside* an
  authenticated app session; codes are single-use, 15-minute TTL, unambiguous
  alphabet, ~1e9 space.
- Channel traffic shares the per-user `chat` rate-limit bucket, so a hijacked
  channel identity can't burn more quota than the app itself allows.
