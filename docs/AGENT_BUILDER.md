# Google Cloud Agent Builder Integration

This document explains how the **CFO Fitness Agent** is exposed for Google Cloud
Agent Builder / Vertex AI Agent Engine, and how to register it.

## What the wrapper is

The agent's reasoning loop is a Genkit flow (`personalizedAICoaching`) running on
**Gemini 3 Flash**, with the full CFO tool suite (log nutrition/exercise, score
the day, audit reasoning) and **Arize Phoenix** tracing via MCP.

`src/app/api/agent/route.ts` exposes that loop as a stable, server-to-server
HTTP agent surface — the contract an Agent Builder agent registers as its custom
reasoning backend or that an A2A orchestrator invokes:

| Method | Path           | Purpose                                            |
| ------ | -------------- | -------------------------------------------------- |
| `GET`  | `/api/agent`   | Returns the **agent card** (capabilities + skills) |
| `POST` | `/api/agent`   | **Invokes** the agent                              |

A static A2A discovery card is also served at
`/.well-known/agent.json`.

## Auth

Set `AGENT_API_KEY` in the deploy environment. Callers authenticate with:

```
Authorization: Bearer <AGENT_API_KEY>
```

If `AGENT_API_KEY` is unset the endpoint returns `503` (secure by default).

## Invoke contract

Request body:

```json
{
  "message": "Log lunch: grilled chicken breast and rice",
  "userId": "user-123",
  "userName": "Nick",
  "sessionId": "optional-conversation-id",
  "chatHistory": [{ "role": "user", "content": "..." }],
  "timezoneOffsetMinutes": -480
}
```

Response:

```json
{ "response": "Logged. Today's totals → Protein: ...", "sessionId": "..." }
```

Quick test:

```bash
curl -s -X POST "$BASE_URL/api/agent" \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message":"what is my VF score today?","userId":"demo-user"}'
```

## Registering in Vertex AI Agent Builder

1. **Deploy** the app (Firebase App Hosting / Cloud Run). Note the base URL.
2. In the Google Cloud console open **Agent Builder → Agents** and create an
   agent. For the agent's tool/backend, add an **OpenAPI / HTTP tool** (or
   register the agent via the A2A card) pointing at `POST <BASE_URL>/api/agent`.
3. Provide the `Authorization: Bearer <AGENT_API_KEY>` header in the tool's auth
   config.
4. Map the orchestrator's user turn to the `message` field and thread `userId` /
   `sessionId` for stateful, per-user coaching.
5. Grounding & oversight: because every invocation traces to **Arize Phoenix**
   (set `PHOENIX_ENABLED=true`), you can inspect each multi-step run — the
   Gemini tool calls and the VF-scoring span — in Phoenix, and the agent itself
   can replay its reasoning through the `inspect_reasoning_trace` tool.

## Notes

- The wrapper reuses the exact in-app reasoning loop, so behavior and tooling are
  identical between the web UI and the Agent Builder surface.
- Phoenix tracing is fully optional and env-gated (`PHOENIX_ENABLED`); the agent
  endpoint works with it on or off.
