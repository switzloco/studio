'use client';

import { useEffect, useState } from 'react';
import { X, CalendarCheck } from 'lucide-react';

// Shown at most once per calendar day. We store the last date we surfaced the
// reminder (local YYYY-MM-DD) so it never nags twice in the same day.
const LAST_SHOWN_KEY = 'cfo_daily_reminder_v1';
// Wait this long after load before surfacing, so it doesn't compete with the
// first paint, onboarding, or the add-to-home prompt.
const SHOW_DELAY_MS = 6000;

// Custom event the app shell listens for to switch to the "Today" ledger tab.
export const NAVIGATE_TAB_EVENT = 'cfo:navigate-tab';

function localDateKey(): string {
  const d = new Date();
  // Local date (not UTC) so "today" matches what the user sees.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // Only nudge people who actually installed the app — real users, not
  // first-time marketing-page visitors. This also neatly complements the
  // add-to-home prompt, which only shows when NOT installed.
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function alreadyShownToday(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(LAST_SHOWN_KEY) === localDateKey();
}

export function DailyReminder() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isStandalone()) return;
    if (alreadyShownToday()) return;

    const t = setTimeout(() => {
      // Re-check at fire time in case the day rolled over while the app sat open.
      if (alreadyShownToday()) return;
      window.localStorage.setItem(LAST_SHOWN_KEY, localDateKey());
      setShow(true);
    }, SHOW_DELAY_MS);

    return () => clearTimeout(t);
  }, []);

  const dismiss = () => setShow(false);

  const handleReview = () => {
    window.dispatchEvent(new CustomEvent(NAVIGATE_TAB_EVENT, { detail: 'daily' }));
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-20 z-40 px-4 sm:bottom-6 pointer-events-none">
      <div className="mx-auto max-w-sm pointer-events-auto rounded-2xl border bg-card shadow-xl shadow-black/10 p-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <CalendarCheck className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-extrabold text-foreground leading-snug">Close today&apos;s books</p>
            <p className="text-[12.5px] text-muted-foreground mt-1.5 leading-relaxed">
              Take 30 seconds to log today&apos;s numbers with your CFO. Consistent entries keep your <strong>daily ledger</strong> accurate.
            </p>
            <div className="mt-4 flex gap-2.5">
              <button
                onClick={handleReview}
                className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-[12px] font-bold uppercase tracking-wider hover:opacity-90 active:scale-[0.98] transition-all"
              >
                Review Today
              </button>
              <button
                onClick={dismiss}
                className="h-10 px-4 rounded-xl border text-[12px] font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted/50 active:scale-[0.98] transition-all"
              >
                Later
              </button>
            </div>
          </div>
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 w-7 h-7 -mr-2 -mt-2 flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
