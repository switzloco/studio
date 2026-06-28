/**
 * @fileOverview Canonical base URL for the app.
 *
 * Share links and OpenGraph/social metadata are built against this.
 * Override via NEXT_PUBLIC_SITE_URL (no trailing slash).
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://studio--studio-4236902803-1eba2.us-central1.hosted.app').replace(/\/+$/, '');

/** Absolute, branded URL for a shared meal. */
export function shareUrl(shareId: string): string {
  return `${SITE_URL}/m/${shareId}`;
}
