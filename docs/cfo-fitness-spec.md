# CFO Fitness — App Specification

**One-liner:** A personal health coaching app where an AI acts as your *Chief Fitness Officer*, using financial portfolio metaphors to make visceral fat reduction, protein tracking, and daily movement feel like portfolio management.

---

## The Core Metaphor

Everything in the app maps to finance language. This is not decoration — it's the personality that runs through every string, every metric label, every AI response.

| Health concept | Financial metaphor |
|---|---|
| Visceral fat | Liabilities / debt |
| Protein intake | Liquid assets / liquidity |
| Workout session | Equity injection |
| Daily step count | Market activity |
| HRV / sleep | Recovery rate / bond yield |
| Hitting protein goal | Solvency |
| Fat reduction milestone | Portfolio rebalance |
| Onboarding | Discovery audit |
| Fitbit connection | Hardware verification / device audit |

The AI coach is "The CFO." It has dry wit, uses finance jargon, and treats the user's body like a portfolio under management.

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router) + TypeScript | Server components for layout, client components for all interactive UI |
| AI | Gemini 2.0 Flash via `@google/genkit` or `@google/generative-ai` | LLM-callable tools are the core mechanism |
| Database | Firebase Firestore | Realtime subscriptions on the client |
| Auth | Firebase Auth | Anonymous + Google OAuth |
| Styling | Tailwind CSS + Shadcn/UI | Deep blue (#3F51B5) primary, light blue (#E8EAF6) background, purple (#7E57C2) accent |
| Wearable | Fitbit OAuth 2.0 | Optional; sets `isDeviceVerified = true` and unlocks trusted step/sleep/HRV data |
| Hosting | Firebase App Hosting or Cloud Run | Single instance for low-cost personal use |
| Font | Inter | Body and headlines |

---

## Firestore Schema

```
/users/{userId}
  ├── steps: number
  ├── hrv: number
  ├── sleepHours: number
  ├── recoveryStatus: 'low' | 'medium' | 'high'
  ├── dailyProteinG: number
  ├── visceralFatPoints: number          ← the core score; starts at 1250
  ├── weightKg: number (optional)
  ├── heightCm: number (optional)
  ├── isDeviceVerified: boolean          ← true only after Fitbit OAuth success
  ├── onboardingComplete: boolean
  ├── onboardingDay: number
  ├── history: HistoryEntry[]            ← equity event log for the chart
  │
  ├── /preferences/settings
  │   ├── weeklySchedule: JSON string    ← {"Mon":"Full Body","Tue":"Rest",...}
  │   ├── equipment: string[]
  │   └── targets: { proteinGoal: number, fatPointsGoal: number }
  │
  ├── /preferences/fitbit_tokens
  │   ├── accessToken: string
  │   ├── refreshToken: string
  │   ├── fitbitUserId: string
  │   └── expiresAt: number              ← Unix ms timestamp
  │
  ├── /logs/{logId}
  │   ├── category: 'explosiveness' | 'strength' | 'food' | 'recovery' | 'health_sync' | 'vanity_audit'
  │   ├── content: string
  │   ├── metrics: string[]              ← ["protein_g:45", "daily_total:120"]
  │   ├── verified: boolean
  │   └── timestamp: Timestamp
  │
  └── /chat_sessions/{chatId}            ← optional; for persisting chat history
```

---

## App Structure — Four Tabs

### 1. Chat (default tab)
Full-height chat interface. Top shows CFO name and portfolio status badge. Bottom has sticky input with send button and image paste/upload support. Messages alternate left (CFO, blue/dark) and right (user, lighter). AI responses stream in; show a pulsing "auditing..." indicator while the LLM is thinking.

On first open for a new user, the chat immediately shows the CFO's intro message and kicks off the onboarding flow described below.

### 2. Daily (dashboard)
Cards grid. Shown only after onboarding is complete. Includes:
- **Protein Liquidity** — progress bar, `Xg / goalg`, deficit/surplus label, status (Solvent / Deficit / Surplus)
- **Visceral Fat Equity** — the main score, trend arrow, large number with "pts" label
- **Steps** — with verified badge (Fitbit shield icon) or "unverified" label
- **Sleep** — hours, same verified/unverified distinction
- **HRV** — ms, same distinction
- **Recovery Status** — low/medium/high with color indicator
- If `isDeviceVerified === false`: orange banner "Unverified Metrics Detected" with "Connect Fitbit" CTA button

### 3. History (audit log)
Two sections:
- **Equity Chart** — area chart (Recharts or Chart.js) plotting `visceralFatPoints` over time using the `history` array
- **Transaction Ledger** — scrollable list of log entries from `/logs/`, showing timestamp, category badge, and content. Food logs show protein added. Workout logs show points delta.

### 4. Assets (preferences)
- Weekly schedule editor — 7 day buttons (Mon–Sun), tap to cycle through workout types
- Equipment list — add/remove items
- Protein goal slider or input
- Fat points goal input
- User UID shown at bottom for support purposes
- Save button persists to `/preferences/settings`

---

## Auth Flow

1. App loads → Firebase checks auth state
2. If no user → show landing page with two options: **"Start Free Audit" (anonymous)** and **"Sign in with Google"**
3. Anonymous users can use everything; Google sign-in allows cross-device persistence
4. Landing page uses the financial pitch: "Your body is a portfolio. Most people are running it blind."

---

## The AI Coach — "The CFO"

### Persona Rules
- 2–3 sentences per response maximum unless the user explicitly asks for detail
- Ask exactly ONE question per turn — never stack questions
- Dry wit; sarcasm targets market inefficiencies and nutrition myths, never the user's body
- Financial jargon throughout but always clear in context
- Never bullet dumps, no raw JSON, no asterisk formatting in responses
- Address user by name or "Partner" — never "Client" or "User"

### LLM-Callable Tools (define these as Genkit tools or Google AI function calling)

| Tool name | What it does |
|---|---|
| `get_user_context` | Returns preferences/settings from Firestore |
| `update_preferences` | Saves equipment, schedule, or targets to Firestore |
| `complete_onboarding` | Sets `onboardingComplete = true` |
| `log_nutrition` | Adds protein grams to `dailyProteinG`; validates max 500g per meal |
| `log_workout` | Applies `pointsDelta` to `visceralFatPoints`; validates ±500 range; writes history entry |
| `log_vanity_metrics` | Stores self-reported weight/height; marks as unverified |
| `nutrition_lookup` | Calls USDA FoodData Central API — **never guess macros** |
| `web_search` | Calls a search API for exercise science, supplement research |

**Research policy:** When user mentions any food, call `nutrition_lookup` immediately. Never estimate macros from memory. If no USDA match, fall back to `web_search`. Cite source in reply ("per USDA data").

**Data trust policy:** Steps, HRV, and sleep are only trusted when `isDeviceVerified = true` (Fitbit). Self-reported weight, height, and exercise are always accepted but labeled unverified.

### Workout Point Guide
```
Kettlebell swings ×45    → +15 pts  (explosiveness)
Kettlebell swings ×100+  → +30 pts  (explosiveness)
30-min walk              → +10 pts  (recovery)
Heavy strength session   → +40 pts  (strength)
2-hour bike ride         → +35 pts  (recovery/cardio)
Basketball pickup game   → +25 pts  (explosiveness)
Rest day                 → 0 pts
```

---

## Onboarding Flow — The Golden Path

This is the exact linear conversation the CFO must follow for a new user. No branching, no re-asking, no early system explanation.

**Turn 1 — CFO opens:**
> "Hi, I'm your new Chief Fitness Officer. I've been hired to help you with your protein and fat intake, fat reduction goals, and coach you through a lot. We're going to set up a point system, and I'm going to help you track your progress. What's the main thing you want to track?"

**Rules for the onboarding sequence:**
1. After user states goal → acknowledge briefly, ask about weekly workout schedule (one question)
2. After schedule → accept whatever they say without pushing for more workouts, ask about equipment
3. After equipment → acknowledge without suggesting purchases, ask for goal weight + timeline (combined in one question)
4. After goal → ask for current weight + body fat estimate (combined, estimate is fine)
5. After baseline stats → use the numbers to calculate fat mass / lean mass / target BF%, state the point system will beat their timeline by ~1 month, ask if ready to start tracking
6. When user says yes + reports first activity → log it with calorie estimate, then ask about Fitbit/tracker connection

**Three onboarding pillars** (all required before calling `complete_onboarding`):
- Equipment warehouse
- Weekly schedule
- Performance targets (protein goal + fat points goal)

Call `update_preferences` immediately when each pillar is answered. Call `complete_onboarding` after all three are saved.

**Body composition math** (apply when user gives weight + BF%):
```
fatMassLbs   = weightLbs × bodyFatPct
leanMassLbs  = weightLbs − fatMassLbs
newFatMass   = fatMassLbs − fatToLoseLbs
targetBFpct  = newFatMass / (leanMassLbs + newFatMass)
```
Example: 220 lbs at 25% BF → 55 lbs fat, 165 lbs lean. Losing 20 lbs → 35/200 = 17.5% ≈ 18%. State this out loud.

**Timeline design:** If user says "3 months", design the system to hit it in 2 months. Tell them there's a 1-month buffer built in.

**Anti-patterns to avoid:**
- Do NOT ask about equipment more than once
- Do NOT ask about schedule more than once
- Do NOT present the point system before knowing the user's goal and baseline stats
- Do NOT ask about activity tracking and food tracking as two separate questions
- Do NOT collect sleep, stress, supplements, or meal history during onboarding

---

## After Onboarding — Daily Coaching Protocol

Once `onboardingComplete = true`, each session follows this loop:
1. If `dailyProteinG === 0`: ask what they've eaten. Log via `log_nutrition`.
2. Ask what movement they've done today. Log via `log_workout`.
3. Compare logged totals vs. saved targets.
4. If `isDeviceVerified === false`: mention once per session that Fitbit upgrades data trust.
5. Close turn with current equity score + protein balance vs. goal.

---

## Fitbit Integration

**OAuth flow:**
1. User taps "Connect Fitbit" button → redirect to `https://www.fitbit.com/oauth2/authorize` with scopes: `activity heartrate sleep profile`
2. Pass `userId` in the `state` parameter
3. On callback at `/api/auth/fitbit/callback`:
   - Exchange code for tokens (POST to `https://api.fitbit.com/oauth2/token` with Basic auth header: `base64(clientId:clientSecret)`)
   - Store `{ accessToken, refreshToken, fitbitUserId, expiresAt }` in Firestore
   - Fetch today's data from three endpoints:
     - Steps: `GET /1/user/-/activities/date/today.json` → `summary.steps`
     - Sleep: `GET /1.2/user/-/sleep/date/today.json` → `summary.totalMinutesAsleep / 60`
     - HRV: `GET /1/user/-/hrv/date/today.json` → `hrv[0].value.dailyRmssd`
   - Write values to health record, set `isDeviceVerified = true`
4. For subsequent syncs: check `expiresAt`, refresh token if within 5 minutes of expiry

**Environment variables needed:**
```
NEXT_PUBLIC_FITBIT_CLIENT_ID=
FITBIT_CLIENT_SECRET=
GOOGLE_GENAI_API_KEY=
USDA_FOOD_API_KEY=          # optional, falls back to DEMO_KEY
SERPER_API_KEY=             # optional, for web_search tool
```

---

## Calorie Estimation

Use MET-based formula when logging cardio workouts without explicit calorie data:
```
kcal = MET × 3.5 × weightKg × durationMin / 200
```
MET values: moderate cycling ≈ 8.0, walking ≈ 3.5, basketball ≈ 8.0, vigorous cycling ≈ 12.0

---

## UI / Style Details

- **Color palette:** Primary #3F51B5 (deep blue), Background #E8EAF6 (light blue), Accent #7E57C2 (purple), Success #10B981 (emerald), Warning #F97316 (orange)
- **Verified data badge:** emerald shield-check icon next to device-verified metrics
- **Unverified banner:** orange background, pulsing dot, "Unverified Metrics Detected" with Connect Fitbit CTA
- **Equity score:** large number display, trend arrow (up/down), "pts" label
- **Chat bubbles:** CFO messages left-aligned, dark background; user messages right-aligned, lighter
- **Onboarding gate:** Daily/History/Assets tabs are visible but show a locked state until `onboardingComplete = true`
- **Loading skeletons:** use animated gray bars while Firestore data loads
- Typography: Inter, clean weight contrast between metric values (bold/large) and labels (small/muted)

---

## Key Validation Rules

These come from the LLM tool schemas and must be enforced:
- Single meal protein: max 500g (reject as implausible above this)
- Workout `pointsDelta`: must be in range −500 to +500
- Weight: 20–500 kg
- Height: 50–300 cm
- Chat history roles: only `'user'` and `'model'` (not `'assistant'`)
