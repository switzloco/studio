# CFO Fitness — App Specification

**One-liner:** A personal health coaching app where an AI acts as your *Chief Fitness Officer*, using financial portfolio metaphors to make visceral fat reduction, protein tracking, and daily movement feel like portfolio management.

---

## The Core Metaphor

Everything in the app maps to finance language. This is not decoration — it's the personality that runs through every string, every metric label, every AI response.

| Health concept | Financial metaphor / exact label used |
|---|---|
| Visceral fat | Liabilities / debt |
| Protein intake | Protein Liquidity |
| Workout session | Asset Injection / Equity Injection |
| Daily step count | Steps Inventory |
| HRV / sleep | Recovery Audit |
| Hitting protein goal | Solvency Status: BULLISH |
| Below protein goal | Solvency Status: PENDING DEPOSIT |
| Fat reduction score | Long-Term Portfolio / Equity Score (VF Points) |
| Onboarding | Discovery Audit |
| Fitbit connection | Hardware Verification |
| Settings / preferences | Portfolio Management |
| Equipment list | Home Equipment Assets |
| Weekly workout schedule | Weekly Audit Schedule |
| Save settings | Sync Portfolio Context |
| Audit log / history | Transaction Ledger / Equity Growth Curve |

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

Tab bar labels (exact): **Coach · Focus · Audit · Assets**

### Tab 1 — Coach (default)
Full-height chat interface. Header shows "The CFO" with a status badge ("Active Portfolio" or "Discovery Audit"). Bottom has sticky input — placeholder text "Send message..." — with send button and image paste/upload support. While the AI is processing, show a pulsing label: **"Auditing Assets..."**

Messages: CFO messages left-aligned dark bubble, user messages right-aligned lighter bubble. The AI is labeled "The CFO"; the user is labeled "User" in the bubble header.

On first open for a new user, the chat immediately shows this hardcoded CFO intro message:
> "I'm your new Chief Fitness Officer. I've been hired to audit your visceral fat and protein solvency. Let's start the discovery audit: What are we working with in terms of equipment and your current weekly routine?"

Image attached to a message shows badge: **"Asset Audit Attached"**

Error toast: **"Audit Failed"**

### Tab 2 — Focus (dashboard)
Section header: **"Live Market Audit"** with **"Active Session"** badge.

Before onboarding is complete, show a locked state:
- Title: **"Portfolio Under Audit"** / **"Discovery Audit"**
- Body: *"Complete your onboarding in the COACH tab to unlock high-stakes performance metrics and your live dashboard."*
- Requirements checklist (exact labels):
  - IDENTIFY PHYSICAL ASSETS (EQUIPMENT)
  - SET PROTEIN SOLVENCY TARGETS
  - ESTABLISH WEEKLY PERFORMANCE ROUTINE
  - HARDWARE VERIFICATION (FITBIT)

After onboarding, show these cards:
- **Protein Liquidity** — progress bar, `Xg / goalg`, solvency status label:
  - At or above goal → **"Solvency Status: BULLISH"** (green)
  - Below goal → **"Solvency Status: PENDING DEPOSIT"** (yellow/orange)
- **Steps Inventory** — step count with verified badge or "unverified" label
- **Recovery Audit** — low/medium/high with color indicator
- **Portfolio Weight** — weight in lbs or kg, verified/unverified
- **Height Asset** — height value, verified/unverified
- **Long-Term Portfolio** — card title; inside: **"Equity Score (VF Points)"** — large number display, trend arrow

If `isDeviceVerified === false`: orange banner **"Unverified Metrics Detected"** with subtext *"Connect hardware to authorize a 'Triple-A Rated' audit."* and **"Connect Fitbit"** CTA button.

### Tab 3 — Audit (history)
Page title: **"Portfolio History"** / **"Historical Asset Audit"**

Two sections:
- **"Equity Growth Curve"** — area chart plotting `visceralFatPoints` over time using the `history` array. Empty state: **"No Historical Market Data"**
- **"Transaction Ledger"** — scrollable list of log entries from `/logs/`. Empty state: **"Audit Trail: Cold"** with body *"The transaction ledger is empty. Complete your Discovery Audit and start logging activities to see them analyzed here in your personal transaction stream."* Each entry shows timestamp, category badge, content. Food logs display as "Liquidity Adjustment".

### Tab 4 — Assets (preferences)
Page title: **"Portfolio Management"** / **"Fixed Assets & Audit Scheduling"**

Sections:
- **"Weekly Audit Schedule"** — 7 day buttons (Mon–Tue–Wed–Thu–Fri–Sat–Sun), each showing workout type; placeholder per input: *"Activity (e.g. Lift)"*
- **"Home Equipment Assets"** — add/remove list; empty state: *"No assets registered in the warehouse."*; input placeholder: *"Add asset (e.g. 55lb KB)"*
- **"Portfolio Targets"** — Protein Goal (g) input + VF Points Goal input
- **"Database Ref (Internal Audit)"** — shows user UID labeled **"Portfolio UID"**; note: *"Use this ID to locate your document in the Firebase Console under /users/."*
- Save button: **"Sync Portfolio Context"** (loading state: *"Syncing Assets..."*)
- Save success toast: **"Audit Context Updated"** / *"The CFO is now aware of your new asset allocation."*

---

## Auth Flow

Landing page heading: **"The CFO"** / **"Chief Fitness Officer"**
Body copy: *"Your body is a high-stakes portfolio. We've been hired to audit your visceral fat and protein solvency."*
Fine print: *"Strict Data Solvency • Encrypted Audit Trails • No Garbage Data"*

Two login buttons:
- **"Secure Portfolio Entry"** → Google OAuth
- **"Quick Audit (Anonymous)"** → anonymous sign-in

Toast on anonymous login: **"Quick Entry Authorized"** / *"Orientation briefing initiated."*
Toast on Google login: **"Portfolio Secured"** / *"Identity verified. Full ledger access granted."*

Loading state: **"Initializing Terminal"** / *"Syncing Portfolio Assets..."*

User menu dropdown labels: "Active Portfolio" / "Discovery Audit" (status), "Portfolio Owner" / "Anonymous Auditor" (role), **"Secure Portfolio (Google)"**, **"Run Internal Audit"**, **"Sign Out"**

---

## The AI Coach — "The CFO"

### Persona Rules
- 2–3 sentences per response maximum unless the user explicitly asks for detail
- Ask exactly ONE question per turn — never stack questions
- Dry wit; sarcasm targets market inefficiencies and nutrition myths, never the user's body
- Financial jargon throughout but always clear in context
- Never bullet dumps, no raw JSON, no asterisk formatting in responses
- Address user by name or "Partner" — never "Client" or "User"
- 1 kettlebell = "strategic leverage asset." Bodyweight = "zero-capex portfolio."

### LLM-Callable Tools

| Tool name | Description (use this exact text) |
|---|---|
| `get_user_context` | Returns the user schedule, equipment, and targets. Use this at the start of any audit to check current portfolio holdings. |
| `update_preferences` | Updates equipment list, schedule, or long-term targets. ALWAYS call this when the user provides onboarding info. |
| `complete_onboarding` | Finalizes the discovery audit and unlocks the full dashboard. Call this after all pillars (Equipment, Targets, Schedule) are logged. |
| `log_nutrition` | Updates the user portfolio with new protein intake. |
| `log_workout` | Updates visceral fat points based on movement. |
| `log_vanity_metrics` | Updates self-reported (unverified) height and weight in the user ledger. |
| `nutrition_lookup` | Calls USDA FoodData Central API — **never guess macros** |
| `web_search` | Calls a search API for exercise science, supplement research |

**Research policy:** When user mentions any food, call `nutrition_lookup` immediately. Never estimate macros from memory. If no USDA match, fall back to `web_search`. Cite source in reply ("per USDA data"). Do not mention you're searching — deliver results as confident CFO statements.

**Data trust policy:** Steps, HRV, and sleep are only trusted when `isDeviceVerified = true` (Fitbit). Self-reported weight, height, and exercise are always accepted but labeled unverified ("Audit status: UNVERIFIED / SECONDARY").

### Tool Response Strings
- `log_vanity_metrics` success: *"Vanity metrics recorded. Audit status: UNVERIFIED / SECONDARY."*
- `update_preferences` success: *"Portfolio parameters adjusted. Assets secured in warehouse."*
- `complete_onboarding` success: *"Onboarding complete. Dashboard unlocked. Portfolio now in active management."*
- `log_nutrition` success: *"Solvency updated. Current liquidity: {newTotal}g."*
- `log_workout` success: *"Equity recalibrated. New portfolio value: {newTotalEquity}."*

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

Three pillars must be collected before calling `complete_onboarding`. Scan the conversation history before each turn — never re-ask a pillar that's already answered.

**Pillar 1: Equipment Warehouse** — what gear does the user own?
**Pillar 2: Weekly Audit Schedule** — what days / workout types?
**Pillar 3: Performance Targets** — protein goal (g/day) + fat loss goal

Call `get_user_context` first to see which pillars are already saved. For each pillar, ask once. When answered (or user says "move on" / "same" / "nothing else"), treat it as DONE — call `update_preferences` immediately, do not confirm or recap. Advance to the next unset pillar. One question per turn.

**"Use defaults" shortcut:** If user says this, call `update_preferences` with:
```
equipment: ["Kettlebell"]
targets: { proteinGoal: 170, fatPointsGoal: 5000 }
scheduleJson: '{"Mon":"Full Body","Tue":"Rest","Wed":"Upper","Thu":"Lower","Fri":"Rest","Sat":"Conditioning","Sun":"Rest"}'
```
Then call `complete_onboarding`.

**When all three pillars are saved:** Call `complete_onboarding`. Then immediately pivot to:
> *"One more unlock: connect a Fitbit or wearable and your equity calculations get device-verified data — steps, HRV, sleep. Want to link one now, or run on self-reported for today?"*

**Body composition math** (apply silently when user gives weight + BF%):
```
fatMassLbs   = weightLbs × bodyFatPct
leanMassLbs  = weightLbs − fatMassLbs
newFatMass   = fatMassLbs − fatToLoseLbs
targetBFpct  = newFatMass / (leanMassLbs + newFatMass)
```
Example: 220 lbs at 25% BF → 55 lbs fat, 165 lbs lean. Losing 20 lbs → 35/200 = 17.5% ≈ 18%. State this out loud.

**Timeline design:** If user says "3 months", build the system to hit it in 2. Tell them there's a 1-month buffer.

**Goal validation reframe (use silently in responses):**
- Unsustainable goal → *"That burn rate is a rounding error on physics — sustainable loss is 0.5–1 lb/week. I'll log your 20-lb goal instead, which is the real asset we're protecting."*
- Sedentary pattern → *"Your leverage asset is severely under-deployed. We're going to fix that."*

**Anti-patterns:**
- Do NOT ask about equipment more than once
- Do NOT ask about schedule more than once
- Do NOT present the point system before knowing the user's goal and baseline
- Do NOT ask about activity and food tracking as separate questions
- Do NOT collect sleep, stress, supplements, or meal history during onboarding

---

## After Onboarding — Daily Coaching Protocol

Once `onboardingComplete = true`, each session:
1. If `dailyProteinG === 0`: ask what they've eaten. Log via `log_nutrition`.
2. Ask what movement they've done today. Log via `log_workout`.
3. Compare logged totals vs. targets (call `get_user_context` for targets if needed).
4. If `isDeviceVerified === false`: mention once per session that Fitbit upgrades data trust.
5. Close each turn with the current equity score and protein balance vs. goal.

Log content format:
- Nutrition: `"Meal Audit: {description} (+{proteinG}g Protein)"`
- Workout: `"Asset Injection (Self-Reported): {workoutDetails}"`
- History entry status values: `"Bullish"` (gain) or `"Correction"` (loss)

---

## Fitbit Integration

**OAuth flow:**
1. User taps **"Connect Fitbit"** → redirect to `https://www.fitbit.com/oauth2/authorize` with scopes: `activity heartrate sleep profile`
2. Pass `userId` in the `state` parameter
3. On callback at `/api/auth/fitbit/callback`:
   - Exchange code for tokens (POST to `https://api.fitbit.com/oauth2/token` with Basic auth: `base64(clientId:clientSecret)`)
   - Store `{ accessToken, refreshToken, fitbitUserId, expiresAt }` in `/preferences/fitbit_tokens`
   - Fetch today's data:
     - Steps: `GET /1/user/-/activities/date/today.json` → `summary.steps`
     - Sleep: `GET /1.2/user/-/sleep/date/today.json` → `summary.totalMinutesAsleep / 60`
     - HRV: `GET /1/user/-/hrv/date/today.json` → `hrv[0].value.dailyRmssd`
   - Write to user health record, set `isDeviceVerified = true`
4. Subsequent syncs: check `expiresAt`, refresh if within 5 minutes of expiry

**Environment variables:**
```
NEXT_PUBLIC_FITBIT_CLIENT_ID=
FITBIT_CLIENT_SECRET=
GOOGLE_GENAI_API_KEY=
USDA_FOOD_API_KEY=          # optional, falls back to DEMO_KEY at 100 req/hr
SERPER_API_KEY=             # optional, for web_search tool
```

---

## Calorie Estimation

MET formula for cardio without explicit calorie data:
```
kcal = MET × 3.5 × weightKg × durationMin / 200
```
MET reference: moderate cycling ≈ 8.0, walking ≈ 3.5, basketball ≈ 8.0, vigorous cycling ≈ 12.0

---

## UI / Style Details

- **Color palette:** Primary #3F51B5 (deep blue), Background #E8EAF6 (light blue), Accent #7E57C2 (purple), Success #10B981 (emerald), Warning #F97316 (orange)
- **Verified badge:** emerald shield-check icon next to device-verified metrics
- **Unverified banner:** orange background, pulsing dot, exact text: *"Unverified Metrics Detected"* + *"Connect hardware to authorize a 'Triple-A Rated' audit."* + **"Connect Fitbit"** button
- **Focus tab onboarding gate:** show a lock screen — do not hide the tab, just block the content
- **Loading skeletons:** animated gray bars while Firestore data loads
- Typography: Inter, bold/large for metric values, small/muted for labels

---

## Key Validation Rules

- Single meal protein: max 500g (error: *"Single meal protein cannot exceed 500g — data rejected as implausible"*)
- Workout `pointsDelta`: −500 to +500 (errors: *"Points delta cannot be less than -500"* / *"Points delta cannot exceed 500"*)
- Weight: 20–500 kg
- Height: 50–300 cm
- Chat history roles: only `'user'` and `'model'` (Gemini SDK — not `'assistant'`)
