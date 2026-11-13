# the CFO | Chief Fitness Officer (`cfofitness.app`)

**Manage your body like a high-stakes institutional portfolio.**

`the CFO` (**Chief Fitness Officer**) is a Hybrid AI metabolic portfolio manager built with **Next.js 15**, **Firebase AI Logic (`firebase/ai` v13.3+)**, **Chrome Built-in AI (Gemini Nano)**, **Firestore Offline Persistence**, **Firebase Remote Config**, and **Firebase App Check**.

In `the CFO`'s double-entry biometric accounting engine:
- **Dietary Protein & Micronutrients** = *Capital Asset Inflows*
- **Strength & Conditioning Sessions** = *Capital CapEx Injections*
- **Refined Sugar, Alcohol & Seed Oils** = *Toxic Balance-Sheet Liabilities*
- **Visceral Fat Equity Score** = *Daily compounded net return bounded by the Alpert fat-oxidation ceiling (`computeAlpertNumber`)*

---

## Hybrid AI Architecture (`#BuildHybridAI 2026`)

Built for Google's **#BuildHybridAI 2026** hackathon, `the CFO` routes every user interaction across **On-Device Gemini Nano** (via Chrome's Prompt API + Multimodal Prompt API) and **Cloud Gemini** (`gemini-3.8-flash` configured dynamically via Firebase Remote Config) using a single unified `firebase/ai` Web SDK surface:

| Capability | `InferenceMode` | Why Hybrid / On-Device Wins |
| :--- | :--- | :--- |
| **Top-Bar Local AI Telemetry & Warmup** | `LanguageModel.availability()` + `create({ monitor })` | 1-click **`WARM LOCAL NANO ENGINE`** downloads/warms Gemini Nano weights with a live CRT progress bar (`DOWNLOADING NANO: 68%` -> `NANO ENGINE: ONLINE`). |
| **Feature A — Instant "Ticker Tape" Macro & Workout Parser** | `InferenceMode.PREFER_ON_DEVICE` | Sub-second natural-language shorthand parsing (`"3 eggs, 1 cup oats, black coffee, and 35 min heavy squats"`) at **`$0.00 GAS`** and **100% offline**, using `Schema.object(...)` passed simultaneously to `onDeviceParams.promptOptions.responseConstraint` and `inCloudParams.generationConfig.responseSchema`, reconciled locally against an embedded USDA FoodData Central + Compendium METs engine. |
| **Feature B — Multimodal "Expense Receipt" Meal & Label Auditor** | `InferenceMode.PREFER_ON_DEVICE` | Converts meal/label photos to normalized `image/jpeg` or `image/png` `inlineData` (`<= 960px`), running locally on Chrome's Multimodal Prompt API when enabled and seamlessly falling back to Cloud Gemini otherwise. |
| **Feature C — "SEC Insider Privacy Lock"** | `InferenceMode.ONLY_ON_DEVICE` | Mathematical zero-cloud guarantee for single-turn biometric & visceral-fat audits (`< 6,000` tokens). Raw health notes never leave the browser; if Gemini Nano is unavailable, issues an institutional CRT compliance alert with exact remediation steps. |
| **Feature D — "Quarterly Earnings Call" 30-Day Forecast** | `InferenceMode.PREFER_IN_CLOUD` | Intentional upward routing to Cloud Gemini (`cfo_cloud_model` from Remote Config) for long-context 30-day Audit Ledger synthesis and metabolic break-even forecasting—while automatically falling back to on-device Gemini Nano when offline. |
| **Cryptographic-Style Execution Receipts** | `result.response.inferenceSource` | Every AI response and committed ledger item renders a live monospace badge: `[EXEC: ON_DEVICE // GEMINI NANO // XXXms // $0.00 GAS]` or `[EXEC: IN_CLOUD // GEMINI CLOUD // XXXms // FALLBACK]`. |

See [**`SUBMISSION.md`**](./SUBMISSION.md) for the complete **#BuildHybridAI 2026** Existing App Disclosure, exact runtime file/line code pointers, Judge Testing Instructions, and 2m30s Demo Video Script.

---

## Tech Stack

- **Framework**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS (`Inter` + `JetBrains Mono` Bloomberg CRT theme)
- **Hybrid Inference**: Firebase AI Logic Web SDK (`firebase/ai` `^13.3.0`, `GoogleAIBackend`, `InferenceMode`, `Schema.object`, `result.response.inferenceSource`) + Chrome Built-in AI (`window.LanguageModel`)
- **Security & Dynamic Config**: Firebase App Check (`firebase/app-check` with `ReCaptchaEnterpriseProvider` + local/judge debug token support) & Firebase Remote Config (`firebase/remote-config`)
- **Offline-First State**: Cloud Firestore (`initializeFirestore` with `persistentLocalCache` + `persistentMultipleTabManager`) + 1-click Anonymous Guest Auth (`signInAnonymously`) + Google OAuth
- **Server Agent Loop & Observability**: Genkit 1.x multi-tool coaching backend + optional Arize Phoenix OTLP tracing

---

## Quick Start

```bash
cp .env.example .env.local   # Configure Firebase web config + optional App Check / Origin Trial keys
npm install
npm run dev                  # Launches http://localhost:9002
```

### Verification Commands

```bash
npm run typecheck            # TypeScript strict check (tsc --noEmit)
npm run lint                 # Next.js ESLint check
npm run test                 # Vitest unit test suite (199 tests including Hybrid AI & USDA reconciler)
npm run build                # Production Next.js build
```

### Enabling Chrome On-Device Gemini Nano (Optional — Cloud Fallback Works Everywhere)

1. Open **Chrome Desktop (v138+)** on macOS, Windows, or Linux (22 GB+ free disk, 4 GB+ VRAM or 16 GB+ RAM).
2. Enable On-Device Model: `chrome://flags/#optimization-guide-on-device-model` -> **Enabled BypassPerfRequirement**.
3. Enable Multimodal Prompt API: `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` -> **Enabled**.
4. Relaunch Chrome, open `http://localhost:9002` (or `https://cfofitness.app`), click **Start Your Audit**, and click **`WARM LOCAL NANO ENGINE`** in the top CRT telemetry bar.

---

## Documentation

- [**`SUBMISSION.md`**](./SUBMISSION.md) — **#BuildHybridAI 2026** Devpost submission package, Existing App Disclosure, runtime code pointers, judge offline test guide, and 2m30s video script
- [**`CLAUDE.md`**](./CLAUDE.md) — Codebase architecture & engineering conventions
- [**`.env.example`**](./.env.example) — Documented environment variables (zero hardcoded secrets)

## License

Licensed under the [**Apache License, Version 2.0**](./LICENSE).
