# Capacitor Wrapper & Launch Plan

CFO Fitness → iOS + Android via Capacitor, optimized for a solo developer who needs the app to help people lose fat without bankrupting them on Google Cloud bills.

---

## Review (2026-06-27) — Is Capacitor still the right call?

**Yes — and the PWA problems you're seeing are the exact reason.** Reviewed against the latest `main` (meal-share viral loop, `/api/agent` endpoint, error boundaries, USDA key + Phoenix now wired into `apphosting.yaml`). Nothing on main changes the recommendation; a couple of things strengthen it.

### Your actual problem

The complaints are: *users are used to regular apps, want notifications, and the PWA is awkward — especially on iPhone.* Those aren't bugs you can patch. They're the structural ceiling of an iOS PWA:

| PWA pain you're hitting | Why it can't be fixed in the PWA | Capacitor (hosted-hybrid) fix |
|---|---|---|
| "Feels awkward, not a real app" on iPhone | iOS has no install prompt API — install is a manual Safari-only "Share → Add to Home Screen" dance. You've already built an elaborate 3-step coaching card (`add-to-home-prompt.tsx`) to paper over this. That UI *is* the smell. | Real App Store install, real icon, real splash. Zero coaching needed. |
| Notifications | iOS web push only works *after* a manual home-screen install, is flaky, and many of your users will never complete the install. No reliable re-engagement channel. | Native APNs/FCM via `@capacitor/push-notifications`. Works like every other app. This alone justifies the wrapper. |
| Users randomly logged out / data gone | iOS evicts all PWA storage (IndexedDB, localStorage, the SW cache) after **7 days of non-use**. For a fitness app people check a few times a week, this silently wipes Firebase Auth sessions. | App-container storage is persistent. No 7-day eviction. |
| Google sign-in glitches | Firebase Auth popup flow is blocked in iOS standalone display mode; the redirect flow drops results. | Native auth plugin (`@capacitor-firebase/authentication`) sidesteps the WebView entirely. |
| Meal-share *receiving* doesn't work on iPhone | The `share_target` in `manifest.json` is Web Share Target — **Android/Chrome only**. iOS ignores it. | iOS native share extension delivers shares into the same `/incoming-share` flow. |

### What changed on main that the plan must account for

- **Viral meal-share loop** (`/m/[shareId]`, `opengraph-image.tsx`, `share-meal.ts`). This is web-first by design — shared links must open in a browser with OG previews. The hosted-hybrid model is *perfect* for this: links open the site for non-users (growth), and Universal Links / App Links route them into the app for users who have it. A fully-native rewrite would have fought this. **New deep-link requirement added to Phase 3 below.**
- **`/api/agent` + `.well-known/agent.json` + server actions everywhere.** Reconfirms: static export is impossible. Hosted-hybrid is the only Capacitor shape that works.
- **`USDA_FOOD_API_KEY` and Phoenix now set in `apphosting.yaml`.** The USDA 429 cost item in Part 4 is **done** — checklist updated. Phoenix is now `PHOENIX_ENABLED=true` in prod; note it adds per-request trace export latency/egress — fine for now, but it's a hackathon toggle, consider turning off post-submission to save a little.
- **`minInstances: 1` / `maxInstances: 10` confirmed on main.** Keeping min at 1 per your call. Still recommend dropping max to 3 until ≥100 DAU.

### Bottom line

Don't rewrite native, and don't keep fighting the iOS PWA. **Wrap the existing hosted app in Capacitor**, with **push notifications and native auth as the two must-have plugins** (they're what your users are actually asking for). Keep the PWA alive for desktop/Android web and for the share-link landing pages — it costs nothing to leave it on.

### Optional: interim PWA patches while you build the wrapper (≈half a day)

If you want to reduce pain *this week* before the 5-7 day wrapper lands:

1. **Bump the SW cache on deploy.** `CACHE_NAME = 'cfo-v1'` in `public/sw.js` is hardcoded and never changes, so the `activate` cleanup never runs and the precached `/` shell can go stale. Tie it to the build ID (you already expose `NEXT_PUBLIC_BUILD_ID`).
2. **Warn iPhone users about the 7-day eviction** — a gentle "open the app weekly so you don't get logged out" note, or nudge them to install to home screen (which slightly delays eviction).
3. **Verify Google sign-in uses redirect, not popup, in standalone mode** and that `getRedirectResult` runs on load. This is the single most common "PWA login is broken on iPhone" cause.

These are stopgaps. They do not deliver notifications or the native feel — only the wrapper does.

---

## Part 1 — Architecture decision

### The constraint

This app is **not** statically exportable. It uses:

- Next.js **server actions** (`src/app/actions/chat.ts` for AI coaching)
- API routes for **OAuth callbacks** (`/api/auth/fitbit`, `/api/auth/oura`, `/api/auth/withings`)
- **Cron endpoints** (`/api/cron/*-sync`, `/api/cron/weekly-summary`)
- **Genkit flows** that hit Gemini server-side (API key must not ship to clients)
- A **Web Share Target** route (`/incoming-share`) that depends on the server

Trying to `next export` strips all of this. Don't go that direction.

### The chosen pattern: **"Hosted Hybrid"**

Keep the entire Next.js app on Firebase App Hosting (Cloud Run). Capacitor ships a near-empty native shell that:

1. Loads `https://app.cfofitness.com` (or whatever prod URL) directly in the WebView via `server.url`.
2. Adds **native plugins** for things you cannot do on the web:
   - Apple HealthKit / Android Health Connect (steps, HRV, sleep, weight)
   - Native auth (Google Sign-In via `@codetrix-studio/capacitor-google-auth` or `@capacitor-firebase/authentication`)
   - Push notifications (FCM / APNs)
   - Photo capture for food logging
   - Share target (receive shared text/images from other apps)
3. Bridges native data into the existing Firestore/Genkit pipeline through a small JS API the WebView exposes on `window`.

**Why this works for a solo dev:**

- Zero duplication of business logic. One Next.js codebase serves web + iOS + Android.
- Updates ship instantly via App Hosting redeploy — no App Store review needed for content/UI changes.
- App Store review only matters when you change *native* code (plugins, permissions). That's rare.
- Apple's "minimum bar" — apps that are just a website wrapper get rejected. The HealthKit integration is the bar-clearer; it's a real native capability that a PWA cannot do.

### What this is NOT

- **Not** a PWA-only strategy. Health apps need HealthKit on iOS, and PWAs cannot access HealthKit. Capacitor is necessary, not optional, if you want serious iOS engagement.
- **Not** a fully offline app. If the user is offline, the WebView shows a cached shell with a "reconnect" screen. Don't promise offline logging in v1.

---

## Part 2 — Capacitor wrapper plan

### Phase 0 — Pre-flight (½ day)

- [ ] **Domain: `cfofitness.app` (Porkbun) — DECIDED.** Point it at Firebase App Hosting before first binary. The `server.url` is baked into the binary on each release — changing it requires an App Store update.
- [ ] Bundle IDs: `app.cfofitness` (iOS) and `app.cfofitness` (Android) — matches the domain convention.
- [ ] Enroll in Apple Developer Program ($99/yr) and Google Play Developer ($25 one-time) **before** writing any code — Apple enrollment can take 1-7 days.
- [ ] Audit `next.config.ts` for any `same-origin`-only cookies. Capacitor's WebView runs on `capacitor://localhost` (iOS) and `https://localhost` (Android) by default, but with `server.url` it runs on the real origin — confirm Firebase Auth domain restrictions allow it.

### Phase 1 — Bootstrap (1 day)

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "CFO Fitness" app.cfofitness --web-dir=public
npm install @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android
```

`capacitor.config.ts`:

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.cfofitness',
  appName: 'CFO Fitness',
  webDir: 'public',
  server: {
    // Domain: cfofitness.app (Porkbun)
    // Must be pointed at Firebase App Hosting BEFORE the first binary ships —
    // server.url is baked in and changing it later requires a full App Store update.
    url: 'https://cfofitness.app',
    cleartext: false,
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: true, // forces app-bound-domains plist entry
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0a0a0a',
    },
  },
};

export default config;
```

**Critical:** `limitsNavigationsToAppBoundDomains: true` + the iOS `WKAppBoundDomains` Info.plist entry are what unlocks `localStorage`, cookies, and service workers inside the WebView. Without them, Firebase Auth persistence breaks.

### Phase 2 — Native plugins (2-3 days)

Install only what you actually need:

| Capability | Plugin | Why |
|---|---|---|
| Apple Health / Health Connect | `capacitor-health` (community) or `@perfood/capacitor-healthkit` + a separate Health Connect plugin | The differentiator vs PWA |
| Google Sign-In native | `@capacitor-firebase/authentication` | Avoids OAuth round-trip in WebView |
| Push | `@capacitor/push-notifications` + Firebase Cloud Messaging | Re-engagement |
| Camera | `@capacitor/camera` | Food photo → Genkit vision |
| Share extension (receive) | `@capacitor/share` + iOS share extension | Already have `/incoming-share` |
| Status bar / SafeArea | `@capacitor/status-bar` + CSS env(safe-area-inset-*) | Notch handling |
| App URL open | `@capacitor/app` | OAuth deep links from Fitbit/Oura/Withings |

**Bridge pattern** for HealthKit data → server:

```ts
// In a client-only component loaded by the hosted Next.js app
import { Capacitor } from '@capacitor/core';
import { Health } from 'capacitor-health';

if (Capacitor.isNativePlatform()) {
  const samples = await Health.queryHKitSampleType({ ... });
  // Post to existing server action — reuse the trust policy:
  // isDeviceVerified=true because HealthKit signed it.
  await fetch('/api/ingest-health', {
    method: 'POST',
    body: JSON.stringify({ source: 'healthkit', samples }),
  });
}
```

Add a thin `/api/ingest-health` route that mirrors the Fitbit ingest path with `isDeviceVerified: true` (matches the data trust policy in CLAUDE.md).

### Phase 3 — OAuth deep links (1 day)

Your Fitbit/Oura/Withings flows redirect to `/api/auth/<provider>` — fine in a browser. In a WebView wrapping a hosted URL, the OAuth provider may open Safari/Chrome Custom Tabs and lose the session.

Fix:

- Configure each provider's redirect URL to `https://app.cfofitness.com/api/auth/<provider>` (server completes the exchange, sets the cookie, redirects to `/`).
- Add `intent-filter` for Android and `CFBundleURLSchemes` + Universal Links for iOS so the app catches the redirect.
- Use `@capacitor/app` `appUrlOpen` listener to re-focus the WebView on the right path after the OS returns from the browser.

**Also wire the meal-share deep links (added on main).** The viral loop lives at `/m/[shareId]` with OG images. For users who have the app installed, these links should open *in the app*, not the browser:

- Register **Universal Links** (iOS, via an `apple-app-site-association` file served from the site root) and **App Links** (Android, via `assetlinks.json`) for the `/m/*` and `/incoming-share` paths.
- Non-users still get the web page with the OG preview — that's the growth mechanic; don't break it.
- In the WebView, the `appUrlOpen` handler routes an incoming `/m/<id>` to the in-app share view.

### Phase 4 — Native-only UI polish (1 day)

- Splash screen + adaptive icon (use `@capacitor/assets` to generate from a single 1024×1024 source).
- Disable WebView bounce on iOS (`contentInset: 'always'` plus CSS `overscroll-behavior: none`).
- Status bar color matches app theme on both platforms.
- Handle Android hardware back button via `App.addListener('backButton', ...)` — pop the in-app router, don't kill the process.
- Honor safe-area insets in the hosted CSS (`padding: env(safe-area-inset-top)` etc.) — easiest to gate behind a `body.capacitor` class set on `Capacitor.isNativePlatform()`.

### Phase 5 — CI/CD (½ day)

- iOS: GitHub Actions with `cap sync ios && xcodebuild archive` → upload to TestFlight via `xcrun altool` or Fastlane. Apple ID + app-specific password as secrets.
- Android: `cap sync android && ./gradlew bundleRelease` → upload AAB to Play Console internal track via `r0adkll/upload-google-play`.
- Tag-driven: pushing `v1.2.3` triggers both pipelines.

### Phase 6 — Release artifacts (½ day)

- App Store screenshots (6.7", 6.5", 5.5" iPhone + 12.9" iPad). Use real screens, not marketing mockups.
- Play Store screenshots (phone + 7" tablet + 10" tablet).
- Privacy policy URL (`/privacy` already exists — confirm it covers HealthKit data per Apple's specific HealthKit clause).
- App Store privacy questionnaire — be honest about Firestore, Gemini API, third-party OAuth.

**Total estimate: 5-7 days of focused solo work** to get both stores into review.

---

## Part 3 — Test plan (Are they ready?)

A vibe-coded app on real users' phones has different failure modes than a hosted website. Test in this order.

### 3.1 — Smoke (must pass before TestFlight)

| # | Test | Pass criteria |
|---|---|---|
| 1 | Cold launch on iOS + Android | App opens in <3s, splash fades cleanly to the hosted UI |
| 2 | Firebase Anonymous Auth from native shell | User doc created in Firestore, persists across kill+relaunch |
| 3 | Google Sign-In native flow | Returns to app, session persists, no "popup blocked" |
| 4 | Send one chat message to the coach | Gemini responds, message stored in `/chat_sessions` |
| 5 | Log a workout via chat | `log_workout` tool fires, log appears in Firestore |
| 6 | Background → foreground → chat still works | No "session expired" stale state |
| 7 | Force-quit → relaunch | Lands on last screen or home; doesn't crash |
| 8 | Airplane mode | Shows a clear offline state, doesn't spin forever |

### 3.2 — Native integrations

| # | Test | Pass criteria |
|---|---|---|
| 9 | HealthKit permission prompt | Appears once, choices honored, can revisit in iOS Settings |
| 10 | Pull last 7 days of steps from HealthKit | Numbers match Apple Health app exactly |
| 11 | Pull HRV / sleep from HealthKit | Stored with `isDeviceVerified: true` |
| 12 | Android Health Connect equivalent | Same as #10/#11 on a real Pixel or modern Samsung |
| 13 | Fitbit OAuth from inside the app | Returns to app, not stuck in Safari/Chrome |
| 14 | Oura OAuth from inside the app | Same |
| 15 | Withings OAuth from inside the app | Same |
| 16 | Camera → food photo → log | Photo uploads, macros come back |
| 17 | Push notification (weekly summary) | Arrives, deep-links to the summary view |
| 18 | Share-from-another-app target | Receives text/image, opens `/incoming-share` |

### 3.3 — Device matrix (minimum)

- iOS: iPhone SE 2nd gen (smallest viable screen), iPhone 14, latest iOS + iOS −1.
- Android: Pixel 6a (mid-range), Samsung Galaxy A-series (popular cheap device), Android 11 minimum.
- Borrow devices or use BrowserStack App Live ($39/mo, cancel after launch).

### 3.4 — Cost & abuse tests (the part most solo devs skip)

| # | Test | Pass criteria |
|---|---|---|
| 19 | One test user sends 200 chat messages in 5 min | Per-user rate limit triggers; Gemini bill doesn't move noticeably |
| 20 | One test user uploads 50 food photos in 1 min | Photo upload rate-limited; storage bill bounded |
| 21 | Sustained 10 concurrent users | App Hosting stays at ≤2 instances, no runaway scaling |
| 22 | Genkit token budget per session | Average <5k tokens/turn; >20k turns log a warning |
| 23 | Serper.dev calls per user per day | Capped (e.g. 20/day) — fail closed with a clear message |
| 24 | Firestore reads on dashboard load | <50 reads per page load (use the Firestore profiler) |
| 25 | Cron job execution | Each `/api/cron/*` completes under 60s, doesn't double-fire |

### 3.5 — Store-readiness gates

- [ ] Privacy policy mentions HealthKit data explicitly.
- [ ] All third-party SDKs disclosed in App Store privacy questionnaire (Firebase, Gemini, Fitbit, Oura, Withings, Serper).
- [ ] No console errors visible to users on any flow.
- [ ] No "lorem ipsum", placeholder images (`placehold.co` is in `next.config.ts` — fine for dev, remove from any production-visible UI), or TODO copy.
- [ ] All deep links survive a fresh install + open from email.
- [ ] App can be deleted and reinstalled with the same Firebase user.
- [ ] App works on a phone with the default font size set to "largest" (accessibility).
- [ ] Tapping a notification with the app force-closed lands in the right place.

### 3.6 — What to skip in v1

- Don't try to make the app work fully offline. Show a clean reconnect screen instead.
- Don't ship Apple Watch / Wear OS companions in v1.
- Don't ship in-app purchases. If you need to monetize, do it in v2 with RevenueCat.
- Don't internationalize. English-only ships fast.

---

## Part 4 — Launch checklist for a solo vibe-coded app

### 4.1 — Cost guardrails (do these BEFORE inviting users)

This is the section that will save the project. Going broke on Google Cloud is the single most common way a solo health app dies.

#### Firebase App Hosting

- [ ] Keep `minInstances: 1`. Cold starts on a chat app feel broken — the first message after a long pause would hang ~2s while the LLM spins up the container, on top of Gemini latency. Worth the ~$15-25/mo idle cost for perceived quality. Revisit only if the bill becomes a real problem.
- [ ] `maxInstances: 3` until you have ≥100 DAU. Currently set to 10 — that's a 10x abuse ceiling.
- [ ] Cloud Run budget alert at $20/mo, hard cap at $50/mo (`gcloud billing budgets create`).
- [ ] Set up GCP "Billing alerts" → email at 50%, 90%, 100% of budget.

#### Gemini / Genkit

- [ ] Per-user daily token cap (e.g. 50k tokens/day) enforced server-side before each `ai.generate()` call. Store usage in `/users/{uid}/usage/{YYYY-MM-DD}` and increment atomically.
- [ ] Per-user per-minute message cap (e.g. 10/min).
- [ ] Global daily token ceiling (e.g. 5M tokens/day). When hit, return "the coach is taking a break" — don't keep paying.
- [ ] Use Gemini **Flash** (cheap) for default; reserve Pro for explicit upgrade paths. You're already on Flash — good.
- [ ] Truncate chat history sent to Gemini to last N=20 turns. The Genkit flow loop balloons cost otherwise.

#### Firestore

- [ ] Indexes minimal. Audit `firestore.indexes.json` for unused composite indexes.
- [ ] Realtime listeners scoped tightly — never `onSnapshot` on a collection you only need once.
- [ ] `firestore.rules` deny reads on `/users/{uid}` from anyone but `uid` (you have this — double-check).
- [ ] TTL on `chat_sessions` older than 90 days, or move to cold storage.

#### Third-party APIs

- [ ] Serper.dev: prepay $5, set per-user daily quota = 20 calls. Refuse beyond that.
- [x] USDA: `USDA_FOOD_API_KEY` set (not `DEMO_KEY`) — **done**, now wired as a secret in `apphosting.yaml`. This was the source of the 429s.
- [ ] Resend (email): free tier 3k/mo. Throttle weekly-summary cron to skip inactive users.
- [ ] Phoenix: now `PHOENIX_ENABLED=true` in prod. Tracing exports every span to Arize over OTLP — small per-request latency + egress. Fine for the hackathon; consider flipping to `false` afterward if you don't need live trace introspection.

#### Crons

- [ ] Every `/api/cron/*` checks `Authorization: Bearer $CRON_SECRET`. Currently in place — confirm.
- [ ] Each cron logs cost-relevant metrics (tokens used, API calls made) so you can attribute spikes.
- [ ] Use Cloud Scheduler with retries=0. A retrying cron silently doubles cost.

### 4.2 — Operational (you ARE the on-call)

- [ ] Sentry or Firebase Crashlytics wired into the native shell. Free tier on both is fine for solo.
- [ ] Uptime check on `/api/health` from a free external (Better Uptime, UptimeRobot). Pings every 5 min.
- [ ] One Telegram/Slack/Discord webhook that fires on: billing alert, uptime fail, Crashlytics new-issue. Don't read GCP dashboards daily — let alerts find you.
- [ ] A status page (`status.cfofitness.com`) — even a static GitHub Pages one. When things break, users want signal, not silence.
- [ ] A "kill switch" Remote Config flag `coach_enabled` that you can flip to false to stop all Gemini calls instantly.

### 4.3 — Legal / store / trust

- [ ] Privacy policy explicitly lists: Firebase Auth, Firestore, Cloud Functions, Gemini, HealthKit, Fitbit, Oura, Withings, Resend, Serper, USDA.
- [ ] Terms of service includes a **medical disclaimer**: "Not medical advice; consult a doctor before changing your diet/exercise; we are not a healthcare provider." Health/fitness apps without this get pulled.
- [ ] HealthKit-specific privacy clause per Apple's HealthKit guidelines (data is not sold, not used for advertising, stays in user's account).
- [ ] Account deletion flow accessible from inside the app, not just email. Apple requires this since iOS 16.
- [ ] Data export (JSON dump of all user data) accessible in-app. Nice-to-have, but also smart GDPR/CCPA hygiene.
- [ ] Age gate: 17+ on App Store unless you want to deal with COPPA. Fat-loss content is adult content per Apple.

### 4.4 — Launch sequencing (the actual launch)

**Week -2:** TestFlight + Play internal track to 5 friends. Fix everything they hit.
**Week -1:** TestFlight external (up to 10k) + Play closed beta (20 testers). Focus on iOS — that's where reviews matter.
**Day 0:** Submit to App Store + Play. Apple review = 24-72h typical. Play review = 12-48h.
**Day 1:** Both approved → don't release yet. Pre-warm: post on r/SoloDevs, your own X account, your existing email list. Don't pay for ads.
**Day 2:** Release. Monitor Crashlytics, billing dashboard, and Firestore reads obsessively for 48h.
**Day 7:** First retention check. If D7 retention <15%, fix product before doing any growth work.

### 4.5 — Growth on a solo budget

- [ ] One landing page (the hosted Next.js app already serves it) with App Store + Play badges and a 30-second demo video.
- [ ] App Store Optimization: focus on long-tail keywords ("metabolic coach", "AI fitness coach", "fat loss tracker") — competing for "fitness" is hopeless.
- [ ] One Reddit post in r/loseit (with mod approval, follow self-promo rules) explaining the philosophy. No "check out my app" — show the white paper you already wrote (`METABOLIC_WHITE_PAPER.md`).
- [ ] One X thread on what makes the financial-metaphor framing different.
- [ ] Direct DM to 20 people you actually know who want to lose fat. That's your real launch audience.
- [ ] Do NOT buy Facebook/Google ads pre-PMF. CAC on health apps is $30-60. You can't afford to learn that lesson on $1k.

### 4.6 — Kill criteria (when to pull the plug)

Decide these now, when you're not emotionally attached:

- If monthly spend exceeds **$100/mo** with <50 active users, you have a unit-economics problem. Pause growth, fix cost.
- If D30 retention is <5% after two iteration cycles, the product isn't working. Pivot or stop.
- If Apple rejects twice with "minimum functionality" or "spam" rationale, the native plugins aren't doing enough. Add real HealthKit features before retrying.

---

## Part 5 — Open decisions to make now

Before any code:

1. **Domain & bundle ID.** What URL will `server.url` point at? This is permanent-ish — write it down.
2. **Native auth provider.** Stick with Firebase Auth via `@capacitor-firebase/authentication`, or use Sign In with Apple natively? (Apple requires Sign In with Apple if you offer any third-party social login on iOS.)
3. **One store or both first?** Solo recommendation: ship iOS first. Android can wait two weeks. Halves the review/QA load at launch.
4. **Push notification strategy.** Weekly summary only (cheap, low-risk) or daily nudges (engagement, but notification-fatigue risk)?
5. **Monetization timing.** Free in v1 with a "support the dev" link? Subscription in v1 via RevenueCat? Free + paid coach upgrade in v2?

---

## Summary

- **Architecture:** Capacitor wrapper around the hosted Next.js URL with HealthKit/Health Connect as the bar-clearing native feature. Don't try to static-export — server actions and API routes make that impossible.
- **Test:** Smoke → native integrations → cost/abuse → store gates. Cost tests are the ones solo devs skip and regret.
- **Launch:** Cost guardrails before users. Alerts before dashboards. Direct DMs before ads. Set kill criteria before launch so you don't hold on to a money-losing app out of sentiment.
