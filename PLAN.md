# Architectural Debt Refactor Plan

## Sub-Agent Coordination Strategy

Six tasks are grouped into two waves based on file overlap and dependencies. Wave 1 agents run in parallel (they touch non-overlapping files). Wave 2 runs after Wave 1 is merged, because strict type-checking must see the final state of the codebase, and tests must be written against the final validated logic.

---

## Wave 1 — Parallel (independent files, no conflicts)

### Sub-Agent A: Secrets + Scaling (Tasks 3 & 5)
**Files touched:** `src/firebase/config.ts`, `.env.local` (new), `.gitignore`, `apphosting.yaml`

**Task 3 — Secret Management:**
- Read `src/firebase/config.ts` — it has 6 hardcoded Firebase values
- Create `.env.local` with:
  ```
  NEXT_PUBLIC_FIREBASE_PROJECT_ID=studio-4236902803-c4aa9
  NEXT_PUBLIC_FIREBASE_APP_ID=1:170458557546:web:947afaf1c4c2ddd9fe2e13
  NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyCoQZbgbIU7v_76jh38CxwDIqThX6_7c3U
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=studio-4236902803-c4aa9.firebaseapp.com
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=170458557546
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=
  ```
- Rewrite `src/firebase/config.ts` to read from `process.env.NEXT_PUBLIC_*`
- Verify `.env.local` is already in `.gitignore` (it should be by Next.js default); if not, add it
- Create `.env.local.example` with the same keys but empty values

**Task 5 — Scale Configuration:**
- Update `apphosting.yaml`: set `maxInstances: 10`, add `minInstances: 0`
- Add inline comments explaining Cloud Run billing model (per instance-hour) and the cost implication of raising this value

---

### Sub-Agent B: Zod Validation Layer (Task 4)
**Files touched:** `src/ai/flows/personalized-ai-coaching.ts`

Current state: Genkit tools have input schemas for type shape only — no business-logic range guards. The `updates: any` pattern in tool handlers passes raw LLM output straight to Firestore.

**Changes:**
- For each tool, add a runtime validation step inside the handler body (after Genkit's type check, before any Firestore call). Use `z.safeParse()` so errors throw a descriptive message rather than writing bad data.
- Specific guards:
  - `log_nutrition`: `proteinG` must be `z.number().positive().max(500)` (>500g in one sitting is implausible)
  - `log_workout`: `pointsDelta` must be `z.number().min(-500).max(500)`; `workoutDetails` must be non-empty string
  - `log_vanity_metrics`: `heightCm` must be `z.number().min(50).max(300)` if present; `weightKg` must be `z.number().min(20).max(500)` if present
  - `update_preferences`: if `targets` provided, `proteinGoal` and `fatPointsGoal` must be positive numbers; `equipment` must be array of non-empty strings
  - `complete_onboarding` / `get_user_context`: `userId` must be non-empty string (already guaranteed by Genkit but explicit guard is cheap)
- Replace all `updates: any` typed locals with `Partial<HealthData>` or `Partial<UserPreferences>` (already imported from health-service)
- On validation failure: throw an `Error` with a message that the AI can read and relay to the user (e.g., `"Invalid protein value: must be between 0 and 500g"`)

---

### Sub-Agent C: Fitbit Auth Audit (Task 6)
**Files touched:** `src/app/api/auth/fitbit/callback/route.ts`, `src/lib/fitbit-service.ts`

Current state: The callback is a simulation — it sets `isDeviceVerified: true` unconditionally without performing any real OAuth token exchange. The `state` param (userId) falls back to `'anonymous_auditor'` if missing.

**Problems to fix:**
1. **No state validation** — `state` is silently defaulted; any request can trigger verification for any user
2. **No real token exchange** — `isDeviceVerified` is set regardless of whether Fitbit actually authorized the user
3. **Silent failure path** — if `code` is missing, we redirect but `isDeviceVerified` may already be `true` from a previous half-complete flow

**Changes to `route.ts`:**
- Require `state` to be present and non-empty; redirect to `/?error=fitbit_missing_state` if not
- Structure the flow so `isDeviceVerified` is only set to `true` after a successful token exchange
- Add a real (or clearly-stubbed-with-TODO) token exchange call to `fitbitService.exchangeCodeForTokens(code, redirectUri)`
- If the exchange call throws or returns a falsy result, redirect to `/?error=fitbit_token_exchange_failed` and do NOT write `isDeviceVerified: true`
- Log the failure path to Firestore with `verified: false`

**Changes to `fitbit-service.ts`:**
- Add `exchangeCodeForTokens(code: string, redirectUri: string): Promise<{ accessToken: string; userId: string } | null>` method
- Day-1 implementation: make the real Fitbit token endpoint POST call using `FITBIT_CLIENT_SECRET` env var; if the env var is absent (dev/mock mode), return a mock success result but log a warning
- Add `FITBIT_CLIENT_SECRET` to `.env.local.example` (coordinate with Sub-Agent A)

---

## Wave 2 — Sequential (depends on Wave 1 completing first)

### Sub-Agent D: Strict Type Safety (Task 1)
**Files touched:** `next.config.ts`, then whatever files have type/lint errors

**Steps:**
1. Remove `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true` from `next.config.ts`
2. Run `npm run typecheck` — capture all errors
3. Run `npm run lint` — capture all errors
4. Fix each error:
   - `any` types in tool handlers are already fixed by Sub-Agent B
   - Common expected errors: untyped Firestore snapshots, implicit `any` in catch blocks, missing return types on async functions, React component prop types
   - If a fix requires changing a function signature, update all call sites
5. Re-run `npm run typecheck` and `npm run lint` until both pass clean

---

### Sub-Agent E: Test Infrastructure (Task 2)
**Files touched:** `package.json`, `vitest.config.ts` (new), `src/lib/__tests__/` (new directory)

**Setup:**
- Install dev dependencies: `vitest`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`
- Add `vitest.config.ts` with jsdom environment, `@/` path alias, and setup file
- Add `"test": "vitest run"` and `"test:watch": "vitest"` to `package.json` scripts

**Tests to write (`src/lib/__tests__/scoring.test.ts`):**

*Protein Liquidity scoring* (from `logNutritionTool` logic):
- `currentDailyProteinG + proteinG` produces correct cumulative total
- Adding protein to a zero baseline returns the input value
- Comparison against `proteinGoal` correctly identifies surplus/deficit

*Visceral Fat scoring* (from `logWorkoutTool` logic):
- `visceralFatPoints + pointsDelta` with positive delta produces "Bullish" status
- Negative delta produces "Correction" status
- Zero delta at starting equity (1250) produces correct equity event
- `HistoryEntry` shape is correctly constructed

*Validation layer* (from Sub-Agent B's changes):
- `proteinG: 600` is rejected by the validator
- `proteinG: 150` passes
- `heightCm: 400` is rejected
- `pointsDelta: 1000` is rejected

**Note:** Tests should mock Firestore calls (vi.mock) so they test pure scoring logic, not database I/O.

---

## Execution Order

```
Wave 1:  [Sub-Agent A] ──┐
         [Sub-Agent B] ──┤─── all complete ──► Wave 2: [Sub-Agent D] ──► [Sub-Agent E]
         [Sub-Agent C] ──┘
```

Wave 1 agents work on non-overlapping files so can run in parallel git worktrees. Their changes are committed before Wave 2 begins. Sub-Agent D (type safety) must see the final codebase state (including B's `any` type removals) before running typecheck. Sub-Agent E (tests) must run after D so that tests run in a clean-typed environment.
