# #BuildHybridAI 2026 — Official Devpost Submission Guide
## Project: `the CFO | Chief Fitness Officer` (`cfofitness.app`)

- **Live Production App**: `https://cfofitness.app`
- **Open-Source License**: [`Apache-2.0`](./LICENSE)
- **Primary SDKs**: `firebase@13.3.0` (`firebase/ai`, `firebase/app-check`, `firebase/remote-config`, `firebase/firestore`, `firebase/auth`) + Chrome Built-in AI (`LanguageModel` Prompt API & Multimodal Prompt API)

---

## 1. Existing App Disclosure (Required by Official Rules)

### Core Value Proposition of `cfofitness.app`
`the CFO` (**Chief Fitness Officer**) reframes personal health and visceral fat loss as an institutional financial portfolio. Instead of guilt-driven calorie counting, users manage a daily **Biometric Balance Sheet**:
- **Dietary Protein & Key Micronutrients** are booked as **Capital Asset Inflows**.
- **Strength & Conditioning** sessions are booked as **Capital CapEx Injections** (adjusted by realistic wearable burn tiers).
- **Alcohol, Seed Oils, and Surplus Refined Carbohydrates** are flagged as **Toxic Balance-Sheet Liabilities**.
- Each day settles into a deterministic **Visceral Fat (VF) Equity Score** bounded by the physiologically grounded **Alpert Fat-Oxidation Ceiling** (`computeAlpertNumber` in `src/lib/vf-scoring.ts`).

### What Existed Prior to November 11, 2026
Prior to the **#BuildHybridAI 2026** submission period, `cfofitness.app` operated strictly as a **100% cloud-dependent** Next.js + Genkit web application:
- Core deterministic VF scoring math (`src/lib/vf-scoring.ts`), Sprint/Level tracker (`src/lib/level-tracker.ts`), manual food/exercise log tables, Fitbit/Google Health OAuth sync, and server-only Genkit chat actions (`src/app/actions.ts`).
- **Limitations before this hackathon**: Every meal log, nutrition lookup, photo analysis, and coaching question required a server round-trip (`1.5s–6.0s` latency), incurred per-token cloud inference cost, failed completely when offline (e.g., in basement gyms, subways, or airplane mode), and required users to transmit sensitive biometric weight/body-fat notes to cloud servers.

### Summary of What Was Built During the Submission Period (Nov 11–30, 2026)
During the **#BuildHybridAI 2026** submission window, we re-architected `the CFO` into an **offline-first, privacy-locked Hybrid AI Bloomberg Terminal** powered by **Firebase AI Logic (`firebase/ai` v13.3.0)**:

1. **Firebase AI Logic Hybrid Inference Engine (`src/firebase/ai.ts`, `src/lib/hybrid-ai.ts`)**:
   - Upgraded `firebase` to `^13.3.0` and initialized `getAI(firebaseApp, { backend: new GoogleAIBackend() })` with resilient `AgentPlatformBackend('global')` failover and 6-hour `localStorage` route memoization.
   - Enforced Chrome's user-activation rule so `getGenerativeModel(ai, ...)` is exclusively invoked inside end-user click/focus/submit handlers, while caching `GenerativeModel` singletons and pinning the warmed `LanguageModel` session in GPU/VRAM (`prewarmHybridEntryOnFocus`).
   - Wired compact **Hybrid Structured Output** (`Schema.object(...)`) simultaneously into `inCloudParams.generationConfig.responseSchema` (with `ThinkingLevel.MINIMAL` for low-latency JSON extraction) and `onDeviceParams.promptOptions.responseConstraint`.
2. **Unified Single-Hub `[ ⚡ Entry | 🧠 Coach ]` Composer (`src/components/chat-interface.tsx`)**:
   - Replaced cluttered separate AI terminals with a single segmented switch in the main Coach composer that defaults to **`⚡ Entry`** (`firebase/ai` `PREFER_ON_DEVICE` · Free & Unlimited) with a live `≤200 chars` counter.
   - **1-Step Optimistic Auto-Log + `↩ Undo`**: Hitting Send in `⚡ Entry` parses food/workouts via `firebase/ai`, pre-allocates Firestore doc IDs synchronously (`0ms`), immediately renders an itemized receipt bubble with a 1-tap **`↩ Undo`** button, and flushes all Firestore writes in parallel (`Promise.all`).
   - **Soft 200-Char Auto-Flip**: Typing, pasting, or dictating past `200` characters automatically flips the switch from `⚡ Entry` to **`🧠 Coach`** (full Cloud Genkit CFO with 12-turn memory & live wearable tools).
3. **Firebase App Check & Remote Config (`src/firebase/app-check.ts`, `src/firebase/remote-config.ts`)**:
   - Added `initializeAppCheck` with `ReCaptchaEnterpriseProvider` plus automatic `FIREBASE_APPCHECK_DEBUG_TOKEN` support so hackathon judges and local testers never get blocked.
   - Added `firebase/remote-config` with offline-safe `fetchAndActivate` and defaults for `cfo_cloud_model` (`"gemini-3.8-flash"`), `cfo_persona_strictness` (`"ruthless_wall_street"`), and `hybrid_default_mode` (`"PREFER_ON_DEVICE"`), plus a sanitizer blocking retired `gemini-2.0-*` models.
4. **Offline-First Firestore Persistence & Zero-Network USDA Reconciler (`src/firebase/sdk.ts`, `src/lib/health-service.ts`, `src/lib/usda-local-reconciler.ts`)**:
   - Configured `initializeFirestore` with `persistentLocalCache({ tabManager: persistentMultipleTabManager() })` and non-blocking IndexedDB write commits (`commitFirestoreWrite`) so logging food/workouts and recalculating the VF Equity Score work instantaneously with Chrome DevTools set to **Offline**.
   - Built a client-side USDA FoodData Central + Compendium METs deterministic reconciler (`src/lib/usda-local-reconciler.ts`) so on-device Gemini Nano parses are grounded against reference nutrition density and CFO double-entry classifications with zero network calls.
5. **Chrome Origin Trial & Top-Bar Local AI Telemetry (`src/app/layout.tsx`, `src/components/local-ai-telemetry-bar.tsx`, `src/components/execution-receipt-badge.tsx`)**:
   - Conditionally renders `<meta http-equiv="origin-trial">` in the root `<head>` when configured for production Prompt API support on `cfofitness.app`.
   - Built the Bloomberg CRT **Local AI Telemetry Bar** featuring `window.LanguageModel?.availability()` detection, a 1-click **`WARM LOCAL NANO ENGINE`** button (`LanguageModel.create({ monitor })` with live `DOWNLOADING NANO: XX%` -> `NANO ENGINE: ONLINE` progress bar), and live **`[EXEC: ON_DEVICE // GEMINI NANO // XXXms // $0.00 GAS]`** vs **`[EXEC: IN_CLOUD // GEMINI CLOUD // XXXms // FALLBACK]`** execution receipt badges driven by `result.response.inferenceSource`.
6. **Four End-to-End Hybrid Product Features**:
   - **Feature A — Instant Fast Entry Macro & Workout Auto-Logger (`InferenceMode.PREFER_ON_DEVICE`)** in the main Coach **`⚡ Entry`** composer (`src/components/chat-interface.tsx`, `src/lib/hybrid-ai.ts`).
   - **Feature B — Multimodal "Expense Receipt" Meal & Nutrition Label Photo Auditor (`InferenceMode.PREFER_ON_DEVICE`)** via camera/gallery/paste right inside **`⚡ Entry`**, normalized to single-tile `<= 768px` `image/jpeg` `inlineData` (`src/components/chat-interface.tsx`, `src/lib/hybrid-ai.ts`).
   - **Feature C — "SEC Insider Privacy Lock" (`InferenceMode.ONLY_ON_DEVICE`)** guaranteeing sensitive single-turn biometric audits never leave the browser, with a custom CRT SEC compliance alert when Gemini Nano is unavailable (`src/components/chat-interface.tsx`, `src/components/execution-receipt-badge.tsx`).
   - **Feature D — "Quarterly Earnings Call" 30-Day Portfolio Forecast (`InferenceMode.PREFER_IN_CLOUD`)** demonstrating intentional upward cloud routing for multi-week ledger synthesis with seamless offline Nano fallback (`src/components/quarterly-earnings-modal.tsx`).

---

## 2. Hybrid Architecture & Exact Runtime Code Pointers

Every requirement in the **#BuildHybridAI 2026** rubric maps directly to verifiable runtime TypeScript modules:

| Requirement / Feature | File Path | Exact Lines | Runtime Symbols Used |
| :--- | :--- | :--- | :--- |
| **Firebase AI Logic Initialization** | [`src/firebase/ai.ts`](./src/firebase/ai.ts) | `L4–L9`, `L21–L40` | `getAI(firebaseApp, { backend: new GoogleAIBackend() })`, `AgentPlatformBackend('global')` |
| **Firebase App Check (`ReCaptchaEnterpriseProvider` + Debug Token)** | [`src/firebase/app-check.ts`](./src/firebase/app-check.ts) | `L4–L8`, `L56–L101` | `self.FIREBASE_APPCHECK_DEBUG_TOKEN`, `initializeAppCheck`, `ReCaptchaEnterpriseProvider` |
| **Firebase Remote Config (`gemini-3.8-flash` + Retired Model Guard)** | [`src/firebase/remote-config.ts`](./src/firebase/remote-config.ts) | `L4–L10`, `L27–L47`, `L67–L169` | `getRemoteConfig`, `fetchAndActivate`, `getValue`, `sanitizeCloudModelName` |
| **Offline-First Firestore Persistent Cache** | [`src/firebase/sdk.ts`](./src/firebase/sdk.ts) | `L4–L10`, `L20–L41` | `initializeFirestore`, `persistentLocalCache`, `persistentMultipleTabManager` |
| **Offline Non-Blocking Ledger Commits** | [`src/lib/health-service.ts`](./src/lib/health-service.ts) | `L39–L95`, `L402–L445` | `commitFirestoreWrite`, `getDocOfflineSafe`, `getDocsOfflineSafe` |
| **Chrome Origin Trial `<meta>` Tag** | [`src/app/layout.tsx`](./src/app/layout.tsx) | `L42–L54` | Conditional `<meta httpEquiv="origin-trial" content={originTrialToken} />` |
| **Gemini Nano Availability Probe, VRAM Warmup & Focus Pre-Warm** | [`src/lib/hybrid-ai.ts`](./src/lib/hybrid-ai.ts) | `L116–L258` | `window.LanguageModel.availability()`, `LanguageModel.create({ monitor })`, `prewarmHybridEntryOnFocus`, `model.initializeDeviceModel` |
| **Execution Receipt Badge Formatter (`inferenceSource`)** | [`src/lib/hybrid-ai.ts`](./src/lib/hybrid-ai.ts) | `L263–L303` | `InferenceSource.ON_DEVICE`, `result.response.inferenceSource`, `formatExecutionBadge` |
| **Hybrid Structured Output Schemas (`Schema.object`)** | [`src/lib/hybrid-ai.ts`](./src/lib/hybrid-ai.ts) | `L781–L862` | `ledgerEntrySchema`, `expenseReceiptSchema`, `earningsCallSchema` |
| **Feature A — Fast Entry Auto-Logger (`PREFER_ON_DEVICE`)** | [`src/lib/hybrid-ai.ts`](./src/lib/hybrid-ai.ts)<br>[`src/components/chat-interface.tsx`](./src/components/chat-interface.tsx) | `L906–L982`<br>`L552–L751`, `L902–L948` | `getGenerativeModel`, `InferenceMode.PREFER_ON_DEVICE`, `ThinkingLevel.MINIMAL`, `ENTRY_CHAR_THRESHOLD = 200`, `handleUndoHybridReceipt` |
| **Feature B — Multimodal Expense Receipt (`PREFER_ON_DEVICE`)** | [`src/lib/hybrid-ai.ts`](./src/lib/hybrid-ai.ts) | `L1000–L1233` | `normalizeImageFileForHybrid`, `downscaleDataUriForHybrid` (`768px` JPEG), `auditMealPhotoReceiptHybrid`, `inlineData`, `expectedInputs` |
| **Feature C — SEC Insider Privacy Lock (`ONLY_ON_DEVICE`)** | [`src/lib/hybrid-ai.ts`](./src/lib/hybrid-ai.ts) | `L305–L318`, `L1250–L1338` | `InferenceMode.ONLY_ON_DEVICE`, `SecPrivacyLockBlockedError`, `buildSecComplianceAlert`, `runHybridCoachTurn` |
| **Feature D — 30-Day Earnings Call (`PREFER_IN_CLOUD`)** | [`src/lib/hybrid-ai.ts`](./src/lib/hybrid-ai.ts) | `L1363–L1498` | `InferenceMode.PREFER_IN_CLOUD` (`runQuarterlyEarningsCallHybrid`) with automatic offline Nano fallback |
| **Local USDA & Compendium METs Reconciler** | [`src/lib/usda-local-reconciler.ts`](./src/lib/usda-local-reconciler.ts) | `L326–L560` | `classifyFoodItemCfo`, `reconcileParsedFoodItem`, `reconcileParsedWorkout` |
| **UI Components (Bloomberg / CRT Terminal & Unified Composer)** | [`src/components/chat-interface.tsx`](./src/components/chat-interface.tsx)<br>[`src/components/local-ai-telemetry-bar.tsx`](./src/components/local-ai-telemetry-bar.tsx)<br>[`src/components/quarterly-earnings-modal.tsx`](./src/components/quarterly-earnings-modal.tsx)<br>[`src/components/execution-receipt-badge.tsx`](./src/components/execution-receipt-badge.tsx) | Full files | `[ ⚡ Entry \| 🧠 Coach ]` Composer + 1-Step Undo, Top Telemetry Bar, Earnings Call Modal, Execution Badges & SEC Alert |

---

## 3. Judge Testing Instructions (Zero-Login 1-Click Entry)

Judges can test `the CFO` immediately with **zero account registration** via 1-click Anonymous Auth (**"Start Your Audit"** on the landing screen).

### Path 1 — Instant Test in Any Browser (Automatic Cloud Fallback)
1. Open `https://cfofitness.app` (or run `npm run dev` -> `http://localhost:9002`).
2. Click **"Start Your Audit"** (creates an instant anonymous session; skip or close the quick welcome modal if shown).
3. Observe the top **Bloomberg CRT Telemetry Bar**: if Gemini Nano is not enabled in your browser, it cleanly reports `LOCAL AI: CLOUD HYBRID`.
4. Stay right in the main **Coach** tab — notice the composer switch defaults to **`⚡ Entry`** (`Fast Entry · Free & Unlimited`, `≤200 chars`). Type or paste:
   `3 eggs, 1 cup oats, black coffee, and 35 min heavy squats` -> press **Enter** / **Send**.
5. Inspect the instant **1-step auto-logged receipt bubble** (`ASSET INFLOW`, `OPERATING FUEL`, `CAPEX BURN`), the **`[EXEC: IN_CLOUD // GEMINI CLOUD // XXXms // FALLBACK]`** receipt badge, and test the 1-tap **`↩ Undo`** button.
6. **Test the 200-Char Auto-Flip**: Paste a long multi-sentence coaching question (`> 200` characters) into the box and watch the green **`⚡ Entry`** pill automatically flip to **`🧠 Coach`** (Cloud Genkit CFO).
7. Toggle **`SEC LOCK: ON`** in the top bar (or Settings) and send a message in **`⚡ Entry`** or **`🧠 Coach`**: verify that `InferenceMode.ONLY_ON_DEVICE` mathematically blocks cloud transmission and renders the **`SEC INSIDER PRIVACY LOCK // ON-DEVICE ENGINE REQUIRED`** compliance panel. Click **`Switch to Hybrid Fallback (PREFER_ON_DEVICE)`** to unlock.
8. Click **`30D CALL`** in the top bar -> click **`EXECUTE 30-DAY FORECAST`** to run `InferenceMode.PREFER_IN_CLOUD` and view your Market Rating, Metabolic Break-Even kcal, and Capital Directives.

### Path 2 — Full On-Device Gemini Nano + 100% Offline DevTools Test (Chrome Desktop v138+)
1. In Chrome Desktop, enable both flags and relaunch Chrome:
   - `chrome://flags/#optimization-guide-on-device-model` -> **Enabled BypassPerfRequirement**
   - `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` -> **Enabled**
2. Open `https://cfofitness.app` (or `http://localhost:9002`) and click **"Start Your Audit"**.
3. If the top telemetry bar shows **`WARM LOCAL NANO ENGINE`**, click it once to trigger `LanguageModel.create({ monitor })` and watch the CRT progress bar reach **`NANO ENGINE: ONLINE // $0.00 GAS`**.
4. **The Offline Proof**: Open **Chrome DevTools (`F12`) -> Network tab -> change throttling dropdown to `Offline`**.
   - Notice the top telemetry bar immediately displays **`OFFLINE LEDGER`**.
   - In the main **`⚡ Entry`** composer, enter `"8oz wild salmon, 1 avocado, 5g creatine, 40 min kettlebell swings"` and press **Send**.
   - Even with **zero network connectivity**, `firebase/ai` executes locally on Gemini Nano and renders:
     **`[EXEC: ON_DEVICE // GEMINI NANO // XXXms // $0.00 GAS]`**
   - Firestore's `persistentLocalCache` commits the entries to IndexedDB immediately with a 1-tap **`↩ Undo`** button, recalculates your daily VF Equity Score, and displays the `[EXEC: ON_DEVICE ...]` badge right on the logged Ledger items!
5. **Multimodal Expense Receipt Test**: While in **`⚡ Entry`**, click the **Camera / Gallery** button (or paste an image directly), attach any meal or nutrition-label photo, and press **Send** (`PREFER_ON_DEVICE` runs locally via Chrome's Multimodal Prompt API when enabled, or seamlessly routes to Cloud Gemini in parallel when online).
6. **SEC Privacy Lock Test**: Toggle **`SEC LOCK: ON`**, switch to **`🧠 Coach`**, and ask: *"Audit my current visceral fat liability and protein liquidity."* Verify the coach responds locally with `[EXEC: ON_DEVICE // GEMINI NANO // XXXms // $0.00 GAS]` and zero network requests in DevTools.

---

## 4. Demo Video Narrative (`1:50` Flagship Cut)

1. **`[0:00 – 0:15]` The Hybrid Unit-Economics Hook** — 85% of messages in a fitness app are simple food/workout logs; shipping `"3 eggs and coffee"` through a massive cloud agent burns latency and money.
2. **`[0:15 – 0:31]` Unified `[ ⚡ Entry | 🧠 Coach ]` Composer** — One clean switch in the main composer defaulting to Free & Unlimited `firebase/ai` Fast Entry alongside the real-time Alpert muscle-protection clock.
3. **`[0:31 – 0:52]` 1-Step Offline Auto-Log + `↩ Undo`** — Chrome DevTools set to `Offline`, Gemini Nano parses `"3 eggs, 1 cup oats, black coffee, 35m heavy squats"` via `PREFER_ON_DEVICE`, reconciles against local USDA baselines, and logs to offline Firestore in 1 step (`$0.00 GAS`) with a 1-tap `↩ Undo` safety net.
4. **`[0:52 – 1:07]` Soft `200`-Char Auto-Flip to Full Coach** — Typing past 200 characters automatically flips `⚡ Entry` → `🧠 Coach` for deep 12-turn Genkit coaching & wearable context.
5. **`[1:07 – 1:22]` Multimodal Receipts & `SEC Privacy Lock`** — Snap/paste meal photos in Entry Mode (`768px` single-tile JPEG), or engage `SEC Privacy Lock` (`ONLY_ON_DEVICE`) so raw visceral-fat biometrics never leave the browser.
6. **`[1:22 – 1:36]` 30-Day Metabolic Earnings Call (`PREFER_IN_CLOUD`)** — Cloud tokens stay reserved for high-leverage 30-day portfolio forecasting, governed by Firebase Remote Config & App Check.
7. **`[1:36 – 1:50]` Desktop + Pixel 10 Pro Unified Shell** — Sub-second local Gemini Nano on Desktop Chrome, crisp native mobile UX with automatic Flash-Lite cloud fallback on Pixel 10 Pro (`https://cfofitness.app`).
