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
      <div className="mx-auto max-w-sm pointer-events-auto rounded-2xl border bg-card shadow-lg shadow-black/10 p-4">
        {!showIosInstructions ? (
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Download className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-foreground">Install the CFO</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                Add to your home screen for one-tap access and a full-screen experience.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleInstall}
                  className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-[11px] font-black uppercase tracking-widest"
                >
                  {deferredPrompt ? 'Install' : 'Show me how'}
                </button>
                <button
                  onClick={dismiss}
                  className="h-9 px-3 rounded-lg border text-[11px] font-black uppercase tracking-widest text-muted-foreground"
                >
                  Not now
                </button>
              </div>
            </div>
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              className="shrink-0 w-7 h-7 -mr-1 -mt-1 flex items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between gap-2">
              <p className="text-[13px] font-bold text-foreground">Add the CFO to your Home Screen</p>
              <button
                onClick={dismiss}
                aria-label="Dismiss"
                className="shrink-0 w-7 h-7 -mr-1 -mt-1 flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="mt-2 space-y-2 text-[12px] text-muted-foreground leading-snug">
              <li className="flex items-center gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-muted text-foreground text-[10px] font-black flex items-center justify-center">
                  1
                </span>
                <span>
                  Tap the <Share className="inline w-3.5 h-3.5 -mt-0.5" /> Share icon in Safari.
                </span>
              </li>
              <li className="flex items-center gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-muted text-foreground text-[10px] font-black flex items-center justify-center">
                  2
                </span>
                <span>
                  Scroll down and tap <Plus className="inline w-3.5 h-3.5 -mt-0.5" /> Add to Home Screen.
                </span>
              </li>
              <li className="flex items-center gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-muted text-foreground text-[10px] font-black flex items-center justify-center">
                  3
                </span>
                <span>Tap Add. The icon now lives on your home screen.</span>
              </li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
