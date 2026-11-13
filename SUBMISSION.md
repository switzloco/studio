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
   - Upgraded `firebase` to `^13.3.0` and initialized `getAI(firebaseApp, { backend: new GoogleAIBackend() })`.
   - Enforced Chrome's user-activation rule so `getGenerativeModel(ai, ...)` is exclusively invoked inside end-user click/submit handlers.
   - Wired **Hybrid Structured Output** (`Schema.object(...)`) simultaneously into `inCloudParams.generationConfig.responseSchema` and `onDeviceParams.promptOptions.responseConstraint`.
2. **Firebase App Check & Remote Config (`src/firebase/app-check.ts`, `src/firebase/remote-config.ts`)**:
   - Added `initializeAppCheck` with `ReCaptchaEnterpriseProvider` plus automatic `FIREBASE_APPCHECK_DEBUG_TOKEN` support so hackathon judges and local testers never get blocked.
   - Added `firebase/remote-config` with offline-safe `fetchAndActivate` and defaults for `cfo_cloud_model` (`"gemini-3.8-flash"`), `cfo_persona_strictness` (`"ruthless_wall_street"`), and `hybrid_default_mode` (`"PREFER_ON_DEVICE"`), plus a sanitizer blocking retired `gemini-2.0-*` models.
3. **Offline-First Firestore Persistence & Zero-Network USDA Reconciler (`src/firebase/sdk.ts`, `src/lib/health-service.ts`, `src/lib/usda-local-reconciler.ts`)**:
   - Configured `initializeFirestore` with `persistentLocalCache({ tabManager: persistentMultipleTabManager() })` and non-blocking IndexedDB write commits (`commitFirestoreWrite`) so logging food/workouts and recalculating the VF Equity Score work instantaneously with Chrome DevTools set to **Offline**.
   - Built a client-side USDA FoodData Central + Compendium METs deterministic reconciler (`src/lib/usda-local-reconciler.ts`) so on-device Gemini Nano parses are grounded against reference nutrition density and CFO double-entry classifications with zero network calls.
4. **Chrome Origin Trial & Top-Bar Local AI Telemetry (`src/app/layout.tsx`, `src/components/local-ai-telemetry-bar.tsx`, `src/components/execution-receipt-badge.tsx`)**:
   - Added `<meta http-equiv="origin-trial">` in the root `<head>` for production Prompt API support on `cfofitness.app`.
   - Built the Bloomberg CRT **Local AI Telemetry Bar** featuring `window.LanguageModel?.availability()` detection, a 1-click **`WARM LOCAL NANO ENGINE`** button (`LanguageModel.create({ monitor })` with live `DOWNLOADING NANO: XX%` -> `NANO ENGINE: ONLINE` progress bar), and live **`[EXEC: ON_DEVICE // GEMINI NANO // XXXms // $0.00 GAS]`** vs **`[EXEC: IN_CLOUD // GEMINI CLOUD // XXXms // FALLBACK]`** execution receipt badges driven by `result.response.inferenceSource`.
5. **Four End-to-End Hybrid Product Features**:
   - **Feature A — Instant "Ticker Tape" Macro & Workout Parser (`InferenceMode.PREFER_ON_DEVICE`)** in Metrics & Ledger (`src/components/hybrid-ticker-terminal.tsx`).
   - **Feature B — Multimodal "Expense Receipt" Meal & Nutrition Label Photo Auditor (`InferenceMode.PREFER_ON_DEVICE`)** using normalized `image/jpeg` / `image/png` `inlineData` (`src/components/hybrid-ticker-terminal.tsx`, `src/lib/hybrid-ai.ts`).
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
| **Offline Non-Blocking Ledger Commits** | [`src/lib/health-service.ts`](./src/lib/health-service.ts) | `L134–L179`, `L593–L670` | `commitFirestoreWrite`, `getDocOfflineSafe`, `getDocsOfflineSafe` |
| **Chrome Origin Trial `<meta>` Tag** | [`src/app/layout.tsx`](./src/app/layout.tsx) | `L45–L51` | `<meta httpEquiv="origin-trial" content={...} />` |
| **Gemini Nano Availability Probe & 1-Click Warmup Monitor** | [`src/lib/hybrid-ai.ts`](./src/lib/hybrid-ai.ts) | `L113–L176` | `window.LanguageModel.availability()`, `LanguageModel.create({ monitor })`, `model.initializeDeviceModel` |
| **Execution Receipt Badge Formatter (`inferenceSource`)** | [`src/lib/hybrid-ai.ts`](./src/lib/hybrid-ai.ts) | `L180–L220` | `InferenceSource.ON_DEVICE`, `result.response.inferenceSource`, `formatExecutionBadge` |
| **Hybrid Structured Output Schemas (`Schema.object`)** | [`src/lib/hybrid-ai.ts`](./src/lib/hybrid-ai.ts) | `L469–L555` | `ledgerEntrySchema`, `expenseReceiptSchema`, `earningsCallSchema` |
| **Feature A — Ticker Tape Parser (`PREFER_ON_DEVICE`)** | [`src/lib/hybrid-ai.ts`](./src/lib/hybrid-ai.ts) | `L596–L672` | `getGenerativeModel`, `InferenceMode.PREFER_ON_DEVICE`, `responseSchema` + `responseConstraint` |
| **Feature B — Multimodal Expense Receipt (`PREFER_ON_DEVICE`)** | [`src/lib/hybrid-ai.ts`](./src/lib/hybrid-ai.ts) | `L687–L732`, `L784–L878` | `normalizeImageFileForHybrid`, `inlineData` (`image/jpeg`/`image/png`), `expectedInputs: [{ type: 'image' }, { type: 'text' }]` |
| **Feature C — SEC Insider Privacy Lock (`ONLY_ON_DEVICE`)** | [`src/lib/hybrid-ai.ts`](./src/lib/hybrid-ai.ts) | `L222–L235`, `L893–L982` | `InferenceMode.ONLY_ON_DEVICE`, `SecPrivacyLockBlockedError`, `buildSecComplianceAlert` |
| **Feature D — 30-Day Earnings Call (`PREFER_IN_CLOUD`)** | [`src/lib/hybrid-ai.ts`](./src/lib/hybrid-ai.ts) | `L1003–L1139` | `InferenceMode.PREFER_IN_CLOUD` with automatic offline Nano fallback |
| **Local USDA & Compendium METs Reconciler** | [`src/lib/usda-local-reconciler.ts`](./src/lib/usda-local-reconciler.ts) | `L348–L559` | `classifyCfoEntry`, `reconcileParsedFoodItem`, `reconcileParsedWorkout` |
| **UI Components (Bloomberg / CRT Terminal)** | [`src/components/local-ai-telemetry-bar.tsx`](./src/components/local-ai-telemetry-bar.tsx)<br>[`src/components/hybrid-ticker-terminal.tsx`](./src/components/hybrid-ticker-terminal.tsx)<br>[`src/components/quarterly-earnings-modal.tsx`](./src/components/quarterly-earnings-modal.tsx)<br>[`src/components/execution-receipt-badge.tsx`](./src/components/execution-receipt-badge.tsx) | Full files | Top Telemetry Bar, Ticker & Photo Receipt Terminal, Earnings Call Modal, Execution Badges & SEC Alert |

---

## 3. Judge Testing Instructions (Zero-Login 1-Click Entry)

Judges can test `the CFO` immediately with **zero account registration** via 1-click Anonymous Auth (**"Start Your Audit"** on the landing screen).

### Path 1 — Instant Test in Any Browser (Automatic Cloud Fallback)
1. Open `https://cfofitness.app` (or run `npm run dev` -> `http://localhost:9002`).
2. Click **"Start Your Audit"** (creates an instant anonymous session; skip or close the quick welcome modal if shown).
3. Observe the top **Bloomberg CRT Telemetry Bar**: if Gemini Nano is not enabled in your browser, it cleanly reports `NANO ENGINE: CLOUD FALLBACK`.
4. Go to **Metrics** or **Ledger** -> in the **Instant Ticker Tape** input, click a preset chip or type:
   `3 eggs, 1 cup oats, black coffee, and 35 min heavy squats` -> click **`PARSE`**.
5. Inspect the double-entry breakdown (`ASSET INFLOW`, `OPERATING FUEL`, `CAPEX BURN`), the **`[EXEC: IN_CLOUD // GEMINI CLOUD // XXXms // FALLBACK]`** receipt badge, and click **`COMMIT TO AUDIT LEDGER`**.
6. Toggle **`SEC LOCK: ON`** in the top bar and click **`PARSE`** again: verify that `InferenceMode.ONLY_ON_DEVICE` mathematically blocks cloud transmission and renders the **`SEC INSIDER PRIVACY LOCK // ON-DEVICE ENGINE REQUIRED`** compliance panel. Click **`Switch to Hybrid Fallback (PREFER_ON_DEVICE)`** to unlock.
7. Click **`30D EARNINGS CALL`** in the top bar -> click **`EXECUTE 30-DAY FORECAST`** to run `InferenceMode.PREFER_IN_CLOUD` and view your Market Rating, Metabolic Break-Even kcal, and Capital Directives.

### Path 2 — Full On-Device Gemini Nano + 100% Offline DevTools Test (Chrome Desktop v138+)
1. In Chrome Desktop, enable both flags and relaunch Chrome:
   - `chrome://flags/#optimization-guide-on-device-model` -> **Enabled BypassPerfRequirement**
   - `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` -> **Enabled**
2. Open `https://cfofitness.app` (or `http://localhost:9002`) and click **"Start Your Audit"**.
3. If the top telemetry bar shows **`WARM LOCAL NANO ENGINE`**, click it once to trigger `LanguageModel.create({ monitor })` and watch the CRT progress bar reach **`NANO ENGINE: ONLINE`**.
4. **The Offline Proof**: Open **Chrome DevTools (`F12`) -> Network tab -> change throttling dropdown to `Offline`**.
   - Notice the top telemetry bar immediately displays **`OFFLINE LEDGER`**.
   - In the **Ticker Tape** bar, enter `"8oz wild salmon, 1 avocado, 5g creatine, 40 min kettlebell swings"` and click **`PARSE`**.
   - Even with **zero network connectivity**, `firebase/ai` executes locally on Gemini Nano and renders:
     **`[EXEC: ON_DEVICE // GEMINI NANO // XXXms // $0.00 GAS]`**
   - Click **`COMMIT TO AUDIT LEDGER`** — Firestore's `persistentLocalCache` commits the entries to IndexedDB immediately, recalculates your daily VF Equity Score, and displays the `[EXEC: ON_DEVICE ...]` badge right on the logged Ledger items!
5. **Multimodal Expense Receipt Test**: Click **`RECEIPT PHOTO`** in the Ticker Terminal, upload any JPEG/PNG photo of a meal or nutrition label, and click **`AUDIT PHOTO`** (`PREFER_ON_DEVICE` runs locally via Chrome's Multimodal Prompt API when enabled, or seamlessly routes to Cloud Gemini when online).
6. **SEC Privacy Lock Test**: Toggle **`SEC LOCK: ON`**, switch to the **Coach** tab, and ask: *"Audit my current visceral fat liability and protein liquidity."* Verify the coach responds locally with `[EXEC: ON_DEVICE // GEMINI NANO // XXXms // $0.00 GAS]` and zero network requests in DevTools.

---

## 4. 3-Minute YouTube Demo Video Script (Target Runtime: `2:30`)

> **Production Setup Before Recording**:
> - Chrome Desktop v138+ with Gemini Nano warmed (`NANO ENGINE: ONLINE` green dot in top bar).
> - Chrome DevTools docked on the right (`Network` tab open and visible so judges can verify zero outbound requests during offline & SEC Lock segments).
> - Have one sample meal JPEG (`salmon-plate.jpg`) ready on Desktop.

### `[0:00 – 0:25]` 1. Hook — The Biometric Balance Sheet & Equity Score
- **Visual**: Start on `cfofitness.app` -> click **"Start Your Audit"** -> land on the **Metrics** dashboard + Bloomberg CRT **Local AI Telemetry Bar** (`NANO ENGINE: ONLINE`, `SEC LOCK: OFF`, `RC: gemini-3.8-flash`).
- **Narration**:
  *"Most fitness apps fail in two places: they guilt-trip you over raw calories, and they break the moment you lose cell service in a basement gym. Meet **the CFO — Chief Fitness Officer**. We treat your metabolism like an institutional balance sheet: dietary protein is a Capital Asset, strength training is CapEx, refined sugar and alcohol are Liabilities, and every day settles into a scientifically bounded Visceral Fat Equity Score. For **#BuildHybridAI**, we upgraded the CFO onto **Firebase AI Logic's Hybrid Web SDK**."*

### `[0:25 – 1:05]` 2. Instant On-Device Ticker Logging — With Chrome Network Set to `OFFLINE`
- **Visual**: In Chrome DevTools **Network** tab, flip throttling to **`Offline`**. Point cursor to the amber `OFFLINE LEDGER` pill in the top bar. Switch to **Ledger** tab, type `"3 eggs, 1 cup oats, black coffee, and 35 min heavy squats"` into the **Ticker Tape** bar, and click **`PARSE`**.
- **Narration**:
  *"Watch the Chrome Network tab: we are now **100% Offline**. In our Hybrid Ticker Terminal, I type natural shorthand for breakfast and heavy squats and hit Parse. Using `InferenceMode.PREFER_ON_DEVICE` and `Schema.object` structured output, Chrome's built-in **Gemini Nano** extracts every macro and workout locally, reconciles against our embedded USDA engine, and stamps the execution receipt: **`ON_DEVICE // GEMINI NANO // $0.00 GAS`**. One click commits straight into Firestore's persistent IndexedDB cache—zero latency, zero cloud gas, zero internet."*

### `[1:05 – 1:35]` 3. `SEC INSIDER PRIVACY LOCK` (`InferenceMode.ONLY_ON_DEVICE`)
- **Visual**: Click **`SEC LOCK: ON`** in the top CRT bar (badge glows emerald). Switch to **Coach** tab (notice banner: `SEC INSIDER PRIVACY LOCK ACTIVE // STRICT ON-DEVICE`). Send: *"Audit my visceral fat liability and protein target at 22% body fat."* Show DevTools Network tab remaining completely silent while the CFO reply + `[EXEC: ON_DEVICE // GEMINI NANO // ... // $0.00 GAS]` badge appear.
- **Narration**:
  *"Health metrics are your most sensitive insider data. Toggling **SEC Privacy Lock** switches Firebase AI Logic to `InferenceMode.ONLY_ON_DEVICE`. When I ask the CFO to audit my body-fat liability, raw biometrics are mathematically guaranteed never to leave the browser—and if a browser lacks Gemini Nano, our compliance guard blocks cloud transmission and guides the user step-by-step."*

### `[1:35 – 2:02]` 4. Multimodal "Expense Receipt" Meal Photo Audit (`PREFER_ON_DEVICE`)
- **Visual**: Toggle `SEC LOCK: OFF`, click **`RECEIPT PHOTO`** in the Ticker Terminal, drop in `salmon-plate.jpg`, and click **`AUDIT PHOTO`**. Show the `APPROVED_ASSET` verdict, extracted portion grams/macros, CFO Expense Audit commentary, and `[EXEC: ...]` badge, then click **`COMMIT RECEIPT TO AUDIT LEDGER`**.
- **Narration**:
  *"Next, Multimodal Expense Receipts. I snap or upload a meal photo—converted client-side to normalized `inlineData`—and run `PREFER_ON_DEVICE`. With Chrome's multimodal Prompt API enabled it audits locally on Gemini Nano, and on mobile or unsupported browsers it seamlessly falls back to Cloud Gemini without changing a single line of application code."*

### `[2:02 – 2:30]` 5. Intentional Cloud Routing — 30-Day `Quarterly Earnings Call` (`PREFER_IN_CLOUD`)
- **Visual**: In DevTools Network tab, switch **`Offline` -> `No throttling`** (online). Click **`30D EARNINGS CALL`** in the top bar -> click **`EXECUTE 30-DAY FORECAST`**. Show the `STRONG_BUY` / `OUTPERFORM` rating, Projected 30D Equity Delta, Metabolic Break-Even kcal, Capital Directives, and the **`[EXEC: IN_CLOUD // GEMINI CLOUD // XXXms // FALLBACK]`** badge powered by Firebase Remote Config (`gemini-3.8-flash`).
- **Narration**:
  *"Finally, true hybrid architecture means routing upward when deep reasoning matters. Back online, I trigger a **30-Day Quarterly Earnings Call** using `InferenceMode.PREFER_IN_CLOUD`—dynamically configured via **Firebase Remote Config** and protected by **Firebase App Check**—to synthesize weeks of ledger history into an executive break-even forecast, while still falling back to Nano if offline. **the CFO**: institutional metabolic intelligence, instant on-device speed, zero-gas unit economics. Start your audit at `cfofitness.app`."*
