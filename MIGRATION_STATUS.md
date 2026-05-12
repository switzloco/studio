# Google Health API Migration & Verification Plan

## Overview
This project is migrating from the legacy Fitbit Web API to the **Google Health API (v4 REST)**. The decommissioning deadline for Fitbit is September 2026. We are currently in a "Dual-Provider" state.

## 1. Technical Architecture
We use a provider-agnostic wrapper in `fitbit-service.ts`.
- **Provider Key:** Stored in Firestore at `users/{uid}/preferences/fitbit_tokens`.
- **Field:** `provider` (Values: `'fitbit'` or `'google'`).
- **Auth Flow:** Standard OAuth 2.0. Google Health requires Restricted Scopes.

### Key Files
- `src/lib/fitbit-service.ts`: Dynamic routing for OAuth and REST fetches (steps, sleep, HRV).
- `src/lib/fitbit-sync.ts`: Background synchronization logic.
- `src/components/dashboard-cards.tsx`: UI for connection status and migration banner.
- `apphosting.yaml`: Environment variable configuration for Firebase App Hosting.

## 2. Google OAuth Verification Status
The app is currently in **Testing** mode in the Google Cloud Console.

### Verification Requirements Checklist:
- [x] **Privacy Policy:** Created at `/privacy`. Linked in global footer.
- [x] **Terms of Service:** Created at `/terms`. Linked in global footer.
- [x] **Support Link:** Added to footer (mailto:nicholas.switzer@gmail.com).
- [x] **Branding:** App name should be set to "The CFO" in Google Cloud Console.
- [x] **Domain Ownership:** Complete. Verification file added to `/public` and meta tag added to `layout.tsx`.
- [x] **Verification Submission:** In Progress. Branding matches and ownership is configured. Pushing final layout changes to ensure visibility during manual review.

## 3. How to Sync Data
- The system checks the `provider` field.
- If `'google'`, it calls `googleHealthFetch` with specific data stream filters.
- If `'fitbit'`, it uses the legacy Fitbit REST API.

## 4. Current Workstream for Next Agents
1. **Logs Monitoring:** Monitor Cloud Run logs for `[syncFitbitData]` and `[FitbitService]` markers to debug token refresh failures (401/403).
2. **Verification File:** Ensure `public/googlee89a7536a417e453.html` is accessible at the root. If 404 persists, verify build inclusion.
3. **Restricted Scope Verification:** Monitor any feedback from the Google Trust & Safety team regarding "Limited Use" requirements.
