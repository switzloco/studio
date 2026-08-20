# App Store Submission — Status & Next Actions

Working doc for the iOS 1.0 rejection and the cleanup that follows it.
Not the hackathon brief (`docs/SUBMISSION_BRIEF.md`) — that is a separate thing.

**Last updated:** 2026-08-20 · **Build:** iOS 1.0 (1) · **Status:** Rejected, remediated in code, awaiting resubmission

---

## 1. What Apple rejected, and why

Build 1.0 (1) was rejected on three guidelines. All three are fixed in code and
deployed to `main`; none of the fixes required a new binary (see §2).

### 2.1.0 — Performance: App Completeness

**Cause.** `signInWithPopup` was the only real way into the app. It asks the host
WebView for a second window; the Capacitor WKWebView ships no `WKUIDelegate`
that can create one, so the call failed instantly with `auth/popup-blocked`. The
reviewer's screenshot shows exactly that error on the "Start Your Audit" button.
**Google sign-in had never worked in the native build** — only in a desktop
browser, which is why it survived to submission.

**Fixed by.**
- `src/lib/auth-environment.ts` (new) — selects the sign-in transport.
- `src/app/page.tsx` — redirect in the native shell / standalone PWA / embedded
  browsers; popup elsewhere with an automatic redirect fallback. User
  cancellations are distinguished from transport failures. `getRedirectResult`
  resolves the return leg on mount.
- `src/components/public-landing.tsx` — guest entry promoted to the primary CTA
  (see §3, this is load-bearing).
- `src/components/dashboard-cards.tsx` — removed the mock device-link paths that
  fabricated steps/sleep/HRV and set `isDeviceVerified: true` when an OAuth
  client ID was missing.

### 2.2.0 — Performance: Beta Testing

**Cause.** A "NOW IN PUBLIC BETA" badge in the landing hero — the first thing
anyone sees. Reinforced by an About-tab card describing the app as "very much in
beta … a sandbox for me", and "if you're testing this out" on the contact form.

**Fixed by.** All three removed (`public-landing.tsx`, `about-view.tsx`). The
Beta Status card is now a "How to Read Your Score" explainer.

### 2.3.8 — Performance: Accurate Metadata

**Cause.** In-app claims that did not match the shipped app:

| Claim | Reality |
|---|---|
| "powered by Gemini 2.0 Flash" | `CFO_MODEL` is `gemini-2.5-flash`; 2.0 is a fallback only |
| "Quick Preview (No Data Save)" | anonymous sessions **do** persist to Firestore |
| "DEXA scan integration" | body fat % is a manually typed field, no integration exists |
| "permanent, encrypted record" | unsubstantiated |
| "Calibration Suite v1.0" in a dashed box | read as an unfinished placeholder |

**Fixed by.** All corrected in `public-landing.tsx` and `about-view.tsx`.

> **Not yet done:** the same claims are probably duplicated in the App Store
> Connect listing, which is not in this repo. See §4.

---

## 2. Architecture fact that shapes everything

`capacitor.config.ts` sets `server.url = https://cfofitness.app`. **The native
shell loads the live site rather than bundled assets.** Consequences:

- Web fixes reach installed builds on the next App Hosting deploy. No rebuild, no
  TestFlight upload, no review queue.
- All three rejection reasons were fixable server-side, so the **existing binary
  can likely be re-reviewed as-is** — reply in Resolution Center rather than
  cutting a new build.
- Conversely: a bad deploy breaks shipped apps instantly. There is no staged
  rollout between `main` and users' phones.
- `limitsNavigationsToAppBoundDomains: false` is deliberate — turning it on
  breaks in-WebView OAuth redirects for Fitbit/Oura/Withings/Google Health.

---

## 3. Constraints — do not regress these

**Guest entry must remain the primary CTA on the landing screen.**
Not cosmetic. 2.1.0 means "the reviewer could not use the app", not "Google
sign-in must work". Guest entry is the only path with no popup and no external
navigation, so it behaves identically in the browser, a standalone PWA and the
native WebView. It is the guarantee that nobody gets stranded on the landing
screen. Both nav buttons route there too — they previously fed the same popup
path, so the reviewer met the dead end whichever button they reached for first.

**Never call `signInWithPopup` / `linkWithPopup` unguarded.**
Route through `shouldUseRedirectSignIn()` in `src/lib/auth-environment.ts`.
Covered by `src/lib/__tests__/auth-environment.test.ts` (mutation-verified:
forcing the popup transport fails exactly the three redirect cases).

**Never fabricate health data.**
Missing OAuth credentials must surface an error, not write plausible-looking
steps/sleep/HRV. The old mock path also set `isDeviceVerified: true`, which fed
fake numbers into the daily score. This is both an App Review flag and a data
integrity bug.

**No beta / demo / preview / "testing" language in user-visible copy.**
Guideline 2.2.0 is an automatic rejection. Grep before shipping:
`grep -rniE "\bbeta\b|demo|placeholder|coming soon" src/components src/app`

**Claims in UI copy must match shipped behavior.** See the 2.3.8 table above for
the pattern that got caught.

### Open risk: Google OAuth in the WebView

Redirect fixes `auth/popup-blocked` definitively. It does **not** settle whether
Google serves OAuth to the Capacitor user agent at all — Capacitor's WKWebView
UA omits the `Safari/` token, roughly what Google's embedded-webview block
(`disallowed_useragent`) keys on.

**Unverified.** The project owner has no iPhone and no Mac confirmed, so this
cannot currently be tested on-device. Guest entry is the mitigation; Google
sign-in is upside, not a dependency. If it must be fixed properly, the answer is
`@capacitor-firebase/authentication` with the native Google SDK — a real binary
change. Do not claim it works without a device or simulator confirming it.

**Ways to verify without an iPhone**, cheapest first:
1. Block popups for the site in a desktop browser → reproduces `auth/popup-blocked`
   exactly, exercises the fallback. Validates the plumbing, not the UA question.
2. iOS Simulator (needs a Mac) → real WKWebView, settles both.
3. Cloud device farm (BrowserStack App Live et al.) → real device, no Mac needed.
   Upload the `.ipa` from the `ios-testflight.yml` workflow artifacts.

---

## 4. Remaining actions

Nothing below is in this repo — all of it is App Store Connect web-form work.

- [ ] **Sweep the ASC listing** — description, subtitle, promo text, keywords for
      "beta", "Gemini 2.0", "DEXA integration", "encrypted". *~15 min*
- [ ] **Check store screenshots** for the "NOW IN PUBLIC BETA" badge. If present
      they must be regenerated (needs a simulator). *5 min to check*
- [ ] **Reply in Resolution Center**, addressing all three guidelines by number.
      Request re-review of the existing build; state that the fixes are
      server-side and already live. *~10 min*
- [ ] **Set the ASC app name to "CFO Fitness"** to match `CFBundleDisplayName`.
      The manifest and all in-app copy say "the CFO" — that mismatch is itself a
      2.3.8 risk. Changing the plist instead would force a rebuild for no gain.
      *2 min*

Release builds are cut by pushing a `v*` tag (`.github/workflows/ios-testflight.yml`,
runs on `macos-latest` — no local Mac required).

---

## 5. "Trim the fat" — candidates, not decisions

Baseline: **26,778 LOC** across `src/`. Evidence gathered 2026-08-20. Scope calls
belong to the owner; nothing here should be deleted unilaterally.

**Dead — no ambiguity**
- `src/lib/placeholder-images.ts` + `.json` — **0 importers.**
- `scratch/` — `deploy.bat`, `push.bat`, `backfill_may4.ts`, `audit_history.ts`,
  `test-require.ts`. One-off scripts, not referenced by build or CI.
- `test-model.ts` (repo root) — stray scratch file.

**Hackathon residue — env-gated off in production**
- `src/ai/observability/` (263 LOC) plus `@arizeai/*` and five `@opentelemetry/*`
  packages. `PHOENIX_ENABLED` is `"false"` in `apphosting.yaml`, so this is inert
  in prod but still installed and bundled. Removing it also drops the
  `inspect_reasoning_trace` tool from the coaching flow — check that first.

**Largest genuine surface: four device integrations**
Fitbit, Google Health, Oura, Withings each carry a service + sync module + cron
route (`fitbit-service.ts` alone is 799 LOC; four routes under `src/app/api/cron/`).
`MIGRATION_STATUS.md` notes Fitbit's API is decommissioned **September 2026** and
the codebase is mid-migration to Google Health. Consolidating to one or two
providers is the single biggest available reduction — and the Fitbit deadline
forces the question regardless.

**Feature worth a keep/cut decision**
- Campaign mode — `src/lib/campaign/` + `campaign-view.tsx` ≈ 750 LOC, plus its
  own Genkit flow. Self-contained, so cheap to remove if it is not core.

**Doc sprawl**
Seven root-level `.md` files and five in `docs/`, several overlapping or stale
(`PLAN.md`, `MIGRATION_STATUS.md`, `CAPACITOR_LAUNCH_PLAN.md` at 25 KB). Consider
collapsing into `README.md` + `CLAUDE.md` + this file.

**Note:** `next.config.ts` ignores TypeScript and ESLint errors during builds.
Any trimming pass should run `npm run typecheck` explicitly — the build will not
catch what it hides.
