# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- **Genkit 1.28** with Gemini 2.0 Flash for AI coaching
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
- Firebase config is hardcoded in `src/firebase/config.ts`

### Build Notes
- `next.config.ts` ignores TypeScript and ESLint errors during builds
- Server action body size limit is 20MB (for health data payloads)
- Deployed via Firebase App Hosting (`apphosting.yaml`, max 1 instance)
