'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Briefcase, Check, Link2, Loader2, LogIn, Share2, TrendingUp, Users,
} from 'lucide-react';
import Link from 'next/link';
import { getAuth, signInAnonymously, linkWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { useUser } from '@/firebase';
import { logSharedMeal } from '@/app/actions/share-meal';
import { shareUrl } from '@/lib/site';
import type { SharedMealItem } from '@/lib/food-exercise-types';

export interface ShareDTO {
  id: string;
  title: string;
  createdByName?: string;
  items: SharedMealItem[];
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number; fiberG: number };
  logCount: number;
}

type LogState = 'idle' | 'busy' | 'done' | 'error';

function MacroStat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-muted/50 px-3 py-2">
      <span className="text-lg font-semibold tabular-nums">{Math.round(value)}{unit}</span>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

export function ShareView({ share }: { share: ShareDTO }) {
  const { user } = useUser();
  const [logState, setLogState] = useState<LogState>('idle');
  const [logError, setLogError] = useState('');
  const [finalLogCount, setFinalLogCount] = useState(share.logCount);
  const [copied, setCopied] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [upgraded, setUpgraded] = useState(false);
  // Resolve native-share support after mount to avoid a hydration mismatch.
  const [canNativeShare, setCanNativeShare] = useState(false);
  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && 'share' in navigator);
  }, []);

  const handleLog = async () => {
    if (logState !== 'idle') return;
    setLogState('busy');
    setLogError('');

    try {
      const auth = getAuth();
      let uid = auth.currentUser?.uid;

      // Sign in anonymously if the visitor has no account yet — this is the
      // frictionless conversion step that seeds the viral loop.
      if (!uid) {
        const cred = await signInAnonymously(auth);
        uid = cred.user.uid;
      }

      const localDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
      const res = await logSharedMeal(uid, share.id, localDate);

      if (!res.success) {
        setLogError(res.error);
        setLogState('error');
        return;
      }

      setFinalLogCount(res.logCount);
      setLogState('done');
    } catch (err: any) {
      setLogError(err?.message ?? 'Something went wrong.');
      setLogState('error');
    }
  };

  const handleUpgrade = async () => {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    setUpgrading(true);
    try {
      await linkWithPopup(currentUser, new GoogleAuthProvider());
      setUpgraded(true);
    } catch {
      /* user cancelled or already has an account — no-op */
    } finally {
      setUpgrading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(share.id));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  };

  const handleNativeShare = async () => {
    if (canNativeShare) {
      try {
        await navigator.share({
          title: share.title,
          text: `${share.createdByName ? `${share.createdByName} shared ` : ''}a meal: ${share.title}`,
          url: shareUrl(share.id),
        });
      } catch { /* user cancelled */ }
    } else {
      handleCopy();
    }
  };

  const attribution = share.createdByName
    ? `${share.createdByName} shared this meal`
    : 'Shared with you';

  // Is the signed-in user still anonymous (no Google linkage)?
  const isAnonymous = user?.isAnonymous ?? getAuth().currentUser?.isAnonymous ?? false;
  const showUpgradeNudge = logState === 'done' && isAnonymous && !upgraded;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-8">
      {/* Wordmark */}
      <div className="flex items-center gap-2 text-primary">
        <Briefcase className="h-5 w-5" />
        <span className="text-sm font-semibold tracking-tight">the CFO</span>
      </div>

      {/* Meal card */}
      <Card className="overflow-hidden border-primary/10">
        <CardContent className="flex flex-col gap-5 p-5">
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{attribution}</span>
            <h1 className="text-xl font-bold leading-tight">{share.title}</h1>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <MacroStat label="Cal" value={share.totals.calories} unit="" />
            <MacroStat label="Protein" value={share.totals.proteinG} unit="g" />
            <MacroStat label="Carbs" value={share.totals.carbsG} unit="g" />
            <MacroStat label="Fat" value={share.totals.fatG} unit="g" />
          </div>

          {share.items.length > 1 && (
            <ul className="flex flex-col divide-y rounded-lg border">
              {share.items.map((it, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="truncate">{it.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {Math.round(it.calories)} cal · {Math.round(it.proteinG)}g P
                  </span>
                </li>
              ))}
            </ul>
          )}

          {finalLogCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span>
                {finalLogCount} {finalLogCount === 1 ? 'person has' : 'people have'} logged this
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Primary CTA — Log to my day */}
      <div className="flex flex-col gap-2">
        {logState === 'done' ? (
          <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <Check className="h-4 w-4" />
            Logged to today&apos;s ledger
          </div>
        ) : (
          <Button
            size="lg"
            className="w-full"
            onClick={handleLog}
            disabled={logState === 'busy'}
          >
            {logState === 'busy' ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Logging…</>
            ) : (
              <><TrendingUp className="mr-2 h-4 w-4" />Log this to my day</>
            )}
          </Button>
        )}

        {logState === 'error' && (
          <p className="text-center text-xs text-destructive">{logError}</p>
        )}

        {logState !== 'done' && (
          <p className="text-center text-[11px] text-muted-foreground">
            No account required — one tap and it&apos;s in your ledger.
          </p>
        )}
      </div>

      {/* Upgrade nudge — shown after an anonymous user logs a meal */}
      {showUpgradeNudge && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-bold">Lock in your data</p>
              <p className="text-xs text-muted-foreground">
                You&apos;re on a temporary account. Link Google to keep your nutrition history and
                access the full CFO dashboard.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full border-amber-300 bg-white hover:bg-amber-50"
              onClick={handleUpgrade}
              disabled={upgrading}
            >
              {upgrading
                ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Linking…</>
                : <><LogIn className="mr-2 h-3.5 w-3.5" />Link Google account</>
              }
            </Button>
          </CardContent>
        </Card>
      )}

      {upgraded && (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200">
          <Check className="h-4 w-4" />
          Google account linked — your data is saved.
        </div>
      )}

      {/* Share / copy row */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={canNativeShare ? handleNativeShare : handleCopy}
        >
          {canNativeShare
            ? <><Share2 className="mr-2 h-4 w-4" />Share</>
            : <><Link2 className="mr-2 h-4 w-4" />{copied ? 'Copied' : 'Copy link'}</>
          }
        </Button>
        {canNativeShare && (
          <Button variant="outline" className="flex-1" onClick={handleCopy}>
            <Link2 className="mr-2 h-4 w-4" />
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        )}
      </div>

      {logState === 'done' && (
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/" className="font-medium text-primary hover:underline">
            View in your CFO dashboard →
          </Link>
        </p>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Track your nutrition like a portfolio.{' '}
        <Link href="/" className="font-medium text-primary hover:underline">Open the CFO →</Link>
      </p>
    </main>
  );
}
