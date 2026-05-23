'use client';

import { useEffect, useState } from 'react';
import { X, Share, Plus, Download } from 'lucide-react';

// Chrome / Edge / Android fire this before the install prompt is shown. We
// stash the event so a custom button can trigger it on demand.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'cfo_a2hs_dismissed_v1';
// Re-show after this many days if the user dismissed without installing.
const DISMISS_COOLDOWN_DAYS = 14;
// Wait this long after the page loads before surfacing the prompt, so it
// doesn't compete with onboarding / the first paint.
const SHOW_DELAY_MS = 8000;

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari exposes navigator.standalone; everyone else uses the media query.
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  // iPadOS reports as Mac; check touch support to catch it.
  const isIpad = /Macintosh/.test(ua) && 'ontouchend' in document;
  return /iPad|iPhone|iPod/.test(ua) || isIpad;
}

function isIosSafari(): boolean {
  if (!isIos()) return false;
  const ua = window.navigator.userAgent;
  // Exclude in-app browsers (Chrome iOS = CriOS, Firefox iOS = FxiOS, etc.)
  // which can't install PWAs.
  return !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|MiuiBrowser|GSA/.test(ua);
}

function wasRecentlyDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  const raw = window.localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const ts = parseInt(raw, 10);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
}

export function AddToHomePrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [showIosInstructions, setShowIosInstructions] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (wasRecentlyDismissed()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      const t = setTimeout(() => setShow(true), SHOW_DELAY_MS);
      return () => clearTimeout(t);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // iOS Safari never fires beforeinstallprompt — surface the manual instructions
    // path after the same delay if we're on iOS Safari and not installed.
    let iosTimer: ReturnType<typeof setTimeout> | undefined;
    if (isIosSafari()) {
      iosTimer = setTimeout(() => setShow(true), SHOW_DELAY_MS);
    }

    const onInstalled = () => {
      setShow(false);
      setDeferredPrompt(null);
      window.localStorage.removeItem(DISMISS_KEY);
    };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, []);

  const dismiss = () => {
    setShow(false);
    setShowIosInstructions(false);
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  };

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShow(false);
        setDeferredPrompt(null);
        window.localStorage.removeItem(DISMISS_KEY);
      } else {
        dismiss();
      }
      return;
    }
    if (isIosSafari()) {
      setShowIosInstructions(true);
    }
  };

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-20 z-40 px-4 sm:bottom-6 pointer-events-none">
      <div className="mx-auto max-w-sm pointer-events-auto rounded-2xl border bg-card shadow-xl shadow-black/10 p-5">
        {!showIosInstructions ? (
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Download className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-extrabold text-foreground leading-snug">Get the CFO App</p>
              <p className="text-[12.5px] text-muted-foreground mt-1.5 leading-relaxed">
                Add this to your home screen for easy one-tap access. It is <strong>100% free</strong>, takes only 10 seconds, and <strong>requires no passwords</strong>.
              </p>
              <div className="mt-4 flex gap-2.5">
                <button
                  onClick={handleInstall}
                  className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-[12px] font-bold uppercase tracking-wider hover:opacity-90 active:scale-[0.98] transition-all"
                >
                  {deferredPrompt ? 'Install App' : 'Show me how'}
                </button>
                <button
                  onClick={dismiss}
                  className="h-10 px-4 rounded-xl border text-[12px] font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted/50 active:scale-[0.98] transition-all"
                >
                  Not now
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
        ) : (
          <div>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-base font-extrabold text-foreground">Add to Your Home Screen</p>
                <p className="text-[11.5px] text-muted-foreground mt-0.5">Follow these 3 easy steps on your iPhone:</p>
              </div>
              <button
                onClick={dismiss}
                aria-label="Dismiss"
                className="shrink-0 w-7 h-7 -mr-2 -mt-2 flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <ol className="mt-4 space-y-4 text-[13px] text-muted-foreground leading-relaxed font-medium">
              <li className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-extrabold flex items-center justify-center mt-0.5">
                  1
                </span>
                <span>
                  At the bottom of your screen, tap the{' '}
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-foreground font-bold text-[11px] gap-1 mx-0.5 align-middle">
                    <Share className="w-3.5 h-3.5 text-primary" /> Share
                  </span>{' '}
                  button (it looks like a square box with an arrow pointing up).
                </span>
              </li>
              
              <li className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-extrabold flex items-center justify-center mt-0.5">
                  2
                </span>
                <span>
                  Scroll down the menu and tap{' '}
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-foreground font-bold text-[11px] gap-1 mx-0.5 align-middle">
                    <Plus className="w-3.5 h-3.5 text-primary" /> Add to Home Screen
                  </span>{' '}
                  (near the bottom of the list).
                </span>
              </li>
              
              <li className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-extrabold flex items-center justify-center mt-0.5">
                  3
                </span>
                <span>
                  Look in the top-right corner of your screen and tap the word{' '}
                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-primary text-primary-foreground font-extrabold text-[11.5px] mx-0.5 align-middle">
                    Add
                  </span>{' '}
                  to finish!
                </span>
              </li>
            </ol>

            <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-800 dark:text-amber-300 leading-normal flex items-start gap-2">
              <span className="text-sm shrink-0 leading-none">💡</span>
              <span>
                <strong>Not seeing these buttons?</strong> Make sure you are using the <strong>Safari browser</strong> app (the blue compass icon) on your phone, not Chrome or another app.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
