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

### Google Health API v4 (`src/lib/fitbit-service.ts`)
Replaces the Fitbit Web API for `provider: 'google'` users. Two request shapes,
both easy to get wrong — the details are commented at the top of the Google
Health section in `fitbit-service.ts`:
- `dataPoints:dailyRollUp` (POST) takes a **CivilTimeInterval**:
  `range: { start: { date: {year,month,day} }, end: { date: {...} } }` (end
  exclusive) plus an explicit `windowSizeDays`. `startTime`/`endTime` there
  return HTTP 400 `Unknown name "startTime" at 'range'`.
- `dataPoints:reconcile` / `:list` (GET) take an AIP-160 `filter` supporting
  only `>=` and `<`. Civil-time fields take bare `YYYY-MM-DD` literals (a `Z`
  suffix is rejected): `steps.interval.civil_start_time`,
  `exercise.interval.civil_start_time`, `sleep.interval.civil_end_time` (sleep
  filters on end time only), `weight.sample_time.civil_time`.
- Values: steps `steps.countSum` (int64 **as a string**), calories
  `totalCalories.kcalSum`, sleep `sleep.summary.minutesAsleep`, workouts live
  under the `exercise` data type (there is no `activity-session`).
- **Calorie burn comes from four data types, ranked, not read from one.**
  `total-calories` (BMR + active in one number) LOOKS like the direct answer,
  but a live account proved it can silently drop the basal component for a
  single day with no error: it reported 1,815 kcal for a day independently
  confirmed (Fitbit app, Google Fit) at ~3,100, while the surrounding six days
  in the same 7-day window were all normal (2,679–3,382). Nothing in the
  response marks a day like that as partial — the hourly rollup summed to
  exactly 1,815, meaning the shortfall is in Google's own per-hour data, not a
  partial read on our end.
  `calories-in-heart-rate-zone` (dailyRollUp, sum `caloriesInHeartRateZones[].kcal`
  across zones) — Fitbit's own HR-derived per-minute burn — matched the true
  figure on that broken day to within 7 kcal, so `readGoogleHealthCalories`
  ranks it above `total-calories` whenever it's present and at least as large
  as the day's `active-energy-burned` (guards against IT being the partial
  read, e.g. no continuous HR sensor). Below that: `active-energy-burned` +
  `basal-energy-burned` (list/reconcile only — it has no rollup) as two
  measured halves, then `active-energy-burned` alone. The expensive per-interval
  basal read is only fetched when neither HR-zone nor total looks complete
  against that day's own active burn. A BMR estimate is added ONLY when the
  result is `caloriesBasis: 'active-only'` — never on top of a figure that's
  already a full-day total.

**A missing day is not a zero day.** No rollup bucket means the device never
synced; a real zero comes back as `countSum: "0"`. Sync results carry
`unavailable` flags for metrics that couldn't be read, and every snapshot write
goes through `mergeDailySnapshot` (`src/lib/health-snapshot.ts`) so an empty or
failed sync can never overwrite stored history with zeroes.

### Observability — Arize Phoenix (`src/ai/observability/`)
Optional, fully **env-gated on `PHOENIX_ENABLED=true`** (hackathon integration; leave off to disable).
- `phoenix.ts` — registers a global OpenTelemetry tracer provider that exports Genkit's spans (prompt I/O, every tool call, sub-flows) to Phoenix over OTLP. Imported first in `genkit.ts` and via Next.js `src/instrumentation.ts` so it loads before Genkit. No-op + fail-safe when disabled.
- `span.ts` — `recordReasoningSpan()` wraps deterministic logic (the VF scoring engine in `score_daily_vf`) in its own span so the inputs + scoring breakdown are inspectable next to the model's tool calls.
- `phoenix-mcp.ts` — connects to the **Arize Phoenix MCP server** (`@arizeai/phoenix-mcp`) as a Genkit MCP client. Backs the `inspect_reasoning_trace` tool, which lets the CFO pull its own recorded traces back and explain/audit how a score was produced.

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

## App Store Constraints — Do Not Regress

iOS build 1.0 (1) was rejected under guidelines 2.1.0, 2.2.0 and 2.3.8. Full
context, remaining actions and cleanup candidates: **`docs/APP_STORE_STATUS.md`**.
Read it before touching auth, the landing page, or user-visible copy.

The rules below caused that rejection. They are not style preferences.

**The native shell loads the live site.** `capacitor.config.ts` sets
`server.url = https://cfofitness.app`, so a deploy to `main` reaches installed
iOS/Android apps immediately. There is no staging between `main` and users'
phones. Web fixes need no rebuild; a bad deploy breaks shipped apps.

**Never call `signInWithPopup` / `linkWithPopup` unguarded.** The Capacitor
WKWebView cannot open a popup and fails with `auth/popup-blocked` — this is what
blocked App Review. Route through `shouldUseRedirectSignIn()` in
`src/lib/auth-environment.ts`. Covered by
`src/lib/__tests__/auth-environment.test.ts`. **The bug is invisible in a desktop
browser**, where popups work; do not conclude sign-in is fine from a local test.

**Guest entry stays the primary landing CTA.** It is the only sign-in path with
no popup and no external navigation, so it is the guarantee that a reviewer can
always get into the app. Demoting it re-opens the 2.1.0 rejection.

**Never fabricate health data.** Missing OAuth credentials must raise an error,
never write plausible-looking steps/sleep/HRV or set `isDeviceVerified: true`.

**No beta / demo / preview / "testing" language in user-visible copy** — an
automatic 2.2.0 rejection. Before shipping copy changes:
`grep -rniE "\bbeta\b|demo|placeholder|coming soon" src/components src/app`

**UI claims must match shipped behavior** (guideline 2.3.8). Do not name a model
version, advertise an unbuilt integration, or claim a security property
(encryption, "no data saved") that the code does not implement.

