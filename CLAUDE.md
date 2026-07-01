# CLAUDE.md

This file provides guidance to Antigravity when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server with Turbopack on port 9002
npm run genkit:dev   # Start Genkit AI development server
npm run genkit:watch # Start Genkit with watch mode (auto-restarts)
npm run build        # Production build
npm run typecheck    # TypeScript type checking (tsc --noEmit)
npm run lint         # ESLint via Next.js
```

Test framework: Vitest. Run with `npm run test` / `npm run test:watch` / `npm run test:coverage`.

## Architecture

**CFO Fitness** is a Next.js 15 + Firebase + Genkit AI health coaching app that uses financial portfolio metaphors (visceral fat = "liabilities", protein = "assets", etc.).

### Stack
- **Next.js 15** with App Router and Turbopack, **React 19**, **TypeScript**
- **Firebase**: Firestore (database) + Auth (Google OAuth + Anonymous)
- **Genkit 1.x** with **Gemini 2.5 Flash** (`googleai/gemini-2.5-flash`, env-overridable via `CFO_MODEL`) for AI coaching
- **Arize Phoenix** (optional, env-gated) for LLM-reasoning observability + MCP-based trace introspection
- **Shadcn/UI** + **Tailwind CSS** for styling

### Key Data Flow

1. User authenticates via Firebase Auth (anonymous or Google)
2. User profile and health metrics are stored in Firestore at `/users/{userId}`
3. The AI coach (Genkit flow) reads/writes Firestore via LLM-callable tools
4. The UI subscribes to Firestore via custom hooks (`useDoc`, `useCollection`)

### Firestore Structure
```
/users/{userId}
  ├── /preferences/settings   # Training schedule, equipment, targets
  ├── /logs/{logId}           # Activity/health logs
  └── /chat_sessions/{chatId} # Chat history
```

### AI Coaching (`src/ai/flows/personalized-ai-coaching.ts`)
The Genkit flow defines 8 LLM-callable tools:
- `get_user_context` / `update_preferences` / `complete_onboarding`
- `log_nutrition` / `log_workout` / `log_vanity_metrics`
- `nutrition_lookup` — USDA FoodData Central API (free, authoritative macros; falls back to `DEMO_KEY`)
- `web_search` — Serper.dev Google Search (fitness research, supplements, programming)

**Research policy:** The LLM is instructed to call `nutrition_lookup` proactively whenever a food is mentioned, and fall back to `web_search` if USDA has no match. Macro values are never guessed.

**Data trust policy:** Only accept steps/HRV/sleep data when `isDeviceVerified=true` (Fitbit OAuth). Self-reported exercise, height, and weight are always accepted.

### Observability — Arize Phoenix (`src/ai/observability/`)
Optional, fully **env-gated on `PHOENIX_ENABLED=true`** (hackathon integration; leave off to disable).
- `phoenix.ts` — registers a global OpenTelemetry tracer provider that exports Genkit's spans (prompt I/O, every tool call, sub-flows) to Phoenix over OTLP. Imported first in `genkit.ts` and via Next.js `src/instrumentation.ts` so it loads before Genkit. No-op + fail-safe when disabled.
- `span.ts` — `recordReasoningSpan()` wraps deterministic logic (the VF scoring engine in `score_daily_vf`) in its own span so the inputs + scoring breakdown are inspectable next to the model's tool calls.
- `phoenix-mcp.ts` — connects to the **Arize Phoenix MCP server** (`@arizeai/phoenix-mcp`) as a Genkit MCP client. Backs the `inspect_reasoning_trace` tool, which lets the CFO pull its own recorded traces back and explain/audit how a score was produced.

### Messaging Channels (`src/lib/messaging/`, `src/app/api/webhooks/`)
WhatsApp (Meta Cloud API) and Discord (Interactions endpoint) webhooks feed a channel-agnostic gateway (`gateway.ts`) that runs the same coaching flow, rate limits, and per-day transcript as the in-app chat. Account linking is chat-first: the in-app CFO mints a one-time code via the `create_channel_link_code` tool; the user sends `LINK <code>` from the channel. Links/codes/dedupe live in admin-only Firestore collections (`channel_links`, `channel_link_codes`, `channel_events`). Setup: `docs/MESSAGING_CHANNELS.md`.

### Firebase Integration (`src/firebase/`)
- `sdk.ts` — Firebase SDK initialization (safe for server actions)
- `provider.tsx` — React Context with auth state
- `firestore/use-doc.tsx` and `use-collection.tsx` — Realtime Firestore hooks

### Server Actions vs Client Components
- `src/app/actions/chat.ts` — Server action that calls the Genkit AI flow
- Most UI components use `'use client'`; layouts/pages are Server Components
- Import alias: `@/*` maps to `src/*`

### Environment Variables
- `GOOGLE_GENAI_API_KEY` — Required for Genkit/Gemini
- `NEXT_PUBLIC_FITBIT_CLIENT_ID` — Fitbit OAuth (optional, has mock fallback)
- `SERPER_API_KEY` — Serper.dev key for `web_search` tool (optional; tool throws a clear error if missing)
- `USDA_FOOD_API_KEY` — USDA FoodData Central key for `nutrition_lookup` (optional; falls back to `DEMO_KEY` at 100 req/hr)
- `CFO_MODEL` — Override the coaching model (default `googleai/gemini-2.5-flash`)
- `PHOENIX_ENABLED` — Set `true` to enable Arize Phoenix tracing + MCP trace introspection (default off)
- `PHOENIX_COLLECTOR_ENDPOINT` — Phoenix OTLP base URL (default `https://app.phoenix.arize.com`; self-hosted `http://localhost:6006`)
- `PHOENIX_API_KEY` — Phoenix Cloud API key (required when `PHOENIX_ENABLED=true`)
- `PHOENIX_PROJECT_NAME` / `PHOENIX_CLIENT_HEADERS` — optional Phoenix project name and extra OTLP headers
- `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_APP_SECRET` / `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` — WhatsApp channel (optional; webhook returns 503 when unset)
- `DISCORD_PUBLIC_KEY` — Discord interactions endpoint (optional; webhook returns 503 when unset)
- Firebase config is read from `NEXT_PUBLIC_FIREBASE_*` env vars in `src/firebase/config.ts`

### Build Notes
- `next.config.ts` ignores TypeScript and ESLint errors during builds
- Server action body size limit is 20MB (for health data payloads)
- Deployed via Firebase App Hosting (`apphosting.yaml`, max 1 instance)

## Pre-Commit Rules for Antigravity

**Always run `npm run build` before committing and pushing.** The build catches errors that TypeScript alone misses, including:
- `'use server'` files exporting non-async-function values (constants, types at runtime, etc.)
- Next.js App Router violations
- Missing or misconfigured server actions

`npm run typecheck` alone is NOT sufficient — Next.js semantic errors only surface during `npm run build`.

### `'use server'` file rules
Files with `'use server'` may ONLY export `async function`s. Never export:
- Constants (`export const X = ...`)
- Plain objects or arrays
- Type-only exports at runtime (use `export type { T }` which is erased, not `export { T }`)

