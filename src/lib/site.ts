/**
 * @fileOverview Canonical, branded base URL for the app.
 *
 * Share links and OpenGraph/social metadata are built against this instead of
 * `window.location.origin`, so they never leak the raw Firebase App Hosting
 * domain (studio--…hosted.app) — a link shared from anywhere always reads
 * https://thecfo.app/m/…. Override via NEXT_PUBLIC_SITE_URL (no trailing slash).
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://thecfo.app').replace(/\/+$/, '');

/** Absolute, branded URL for a shared meal. */
export function shareUrl(shareId: string): string {
  return `${SITE_URL}/m/${shareId}`;
}
