'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Briefcase, Check, Link2, Loader2, LogIn, Pencil, RotateCcw, Send, Share2, Sparkles, TrendingUp, Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getAuth, signInAnonymously, linkWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { useUser } from '@/firebase';
import { logSharedMeal, logEditedMeal } from '@/app/actions/share-meal';
import { editSharedMeal } from '@/app/actions/edit-shared-meal';
import { shareUrl } from '@/lib/site';
import { shareMealText } from '@/lib/share-text';
import { assessSharedMeal } from '@/app/actions/welcome-assessment';
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

interface EditMessage {
  role: 'user' | 'assistant';
  text: string;
}

function sumItems(items: SharedMealItem[]) {
  return items.reduce(
    (acc, it) => ({
      calories: acc.calories + it.calories,
      proteinG: acc.proteinG + it.proteinG,
      carbsG: acc.carbsG + it.carbsG,
      fatG: acc.fatG + it.fatG,
      fiberG: acc.fiberG + (it.fiberG ?? 0),
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  );
}

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
  const router = useRouter();
  const [logState, setLogState] = useState<LogState>('idle');
  const [logError, setLogError] = useState('');
  const [finalLogCount, setFinalLogCount] = useState(share.logCount);
  const [copied, setCopied] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [upgraded, setUpgraded] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  // Welcome CFO assessment — a playful, low-pressure greeting generated once on open.
  const [welcome, setWelcome] = useState<string | null>(null);
  const [welcomeLoading, setWelcomeLoading] = useState(true);

  // Edit chat state
  const [editOpen, setEditOpen] = useState(false);
  const [editInput, setEditInput] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editMessages, setEditMessages] = useState<EditMessage[]>([]);
  const [editedItems, setEditedItems] = useState<SharedMealItem[] | null>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && 'share' in navigator);
  }, []);

  useEffect(() => {
    if (editOpen) editInputRef.current?.focus();
  }, [editOpen]);

  // Generate the CFO welcome once, against the original (unedited) shared meal.
  useEffect(() => {
    let cancelled = false;
    assessSharedMeal({
      title: share.title,
      createdByName: share.createdByName,
      totals: share.totals,
      items: share.items.map(i => ({
        name: i.name,
        calories: i.calories,
        proteinG: i.proteinG,
        carbsG: i.carbsG,
        fatG: i.fatG,
      })),
    })
      .then(res => {
        if (cancelled) return;
        if (res.success) setWelcome(res.assessment);
      })
      .finally(() => {
        if (!cancelled) setWelcomeLoading(false);
      });
    return () => { cancelled = true; };
  }, [share.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayItems = editedItems ?? share.items;
  const displayTotals = editedItems ? sumItems(editedItems) : share.totals;
  const isEdited = editedItems !== null;

  const handleLog = async () => {
    if (logState !== 'idle') return;
    setLogState('busy');
    setLogError('');

    try {
      const auth = getAuth();
      let uid = auth.currentUser?.uid;

      if (!uid) {
        const cred = await signInAnonymously(auth);
        uid = cred.user.uid;
      }

      const localDate = new Date().toLocaleDateString('en-CA');

      const res = isEdited
        ? await logEditedMeal(uid, editedItems!, localDate)
        : await logSharedMeal(uid, share.id, localDate);

      if (!res.success) {
        setLogError(res.error ?? 'Something went wrong.');
        setLogState('error');
        return;
      }

      if ('logCount' in res) setFinalLogCount(res.logCount);
      setLogState('done');
      // They opted in by logging — drop them into the real app, where the meal
      // is already in their ledger and the CFO is waiting. Brief beat so the
      // "Logged" confirmation registers before the route change.
      setTimeout(() => router.push('/'), 1100);
    } catch (err: any) {
      setLogError(err?.message ?? 'Something went wrong.');
      setLogState('error');
    }
  };

  const handleEdit = async () => {
    const prompt = editInput.trim();
    if (!prompt || editBusy) return;

    setEditBusy(true);
    setEditInput('');
    setEditMessages(prev => [...prev, { role: 'user', text: prompt }]);

    const res = await editSharedMeal(displayItems, prompt);

    if (res.success) {
      setEditedItems(res.items);
      setEditMessages(prev => [...prev, { role: 'assistant', text: res.summary }]);
    } else {
      setEditMessages(prev => [...prev, { role: 'assistant', text: `Could not apply edit: ${res.error}` }]);
    }
    setEditBusy(false);
    setTimeout(() => editInputRef.current?.focus(), 50);
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
          text: shareMealText({ mealName: share.title, proteinG: displayTotals.proteinG }),
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
            <MacroStat label="Cal" value={displayTotals.calories} unit="" />
            <MacroStat label="Protein" value={displayTotals.proteinG} unit="g" />
            <MacroStat label="Carbs" value={displayTotals.carbsG} unit="g" />
            <MacroStat label="Fat" value={displayTotals.fatG} unit="g" />
          </div>

          {displayItems.length > 1 && (
            <ul className="flex flex-col divide-y rounded-lg border">
              {displayItems.map((it, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="truncate">{it.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {Math.round(it.calories)} cal · {Math.round(it.proteinG)}g P
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Edit toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setEditOpen(v => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <Pencil className="h-3 w-3" />
              {editOpen ? 'Close editor' : 'Edit portions'}
            </button>
            {isEdited && (
              <button
                type="button"
                onClick={() => { setEditedItems(null); setEditMessages([]); }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
            )}
          </div>

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

      {/* Welcome CFO — playful, low-pressure read on the meal */}
      {(welcomeLoading || welcome) && (
        <div className="flex gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex flex-1 flex-col gap-1 rounded-2xl rounded-tl-sm bg-muted px-4 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              the CFO
            </span>
            {welcomeLoading ? (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Sizing up this meal…
              </span>
            ) : (
              <p className="text-sm leading-relaxed">{welcome}</p>
            )}
          </div>
        </div>
      )}

      {/* Edit chat panel */}
      {editOpen && (
        <Card className="border-primary/10">
          <CardContent className="flex flex-col gap-3 p-4">
            {editMessages.length > 0 && (
              <div className="flex flex-col gap-2">
                {editMessages.map((m, i) => (
                  <div
                    key={i}
                    className={`rounded-lg px-3 py-2 text-sm ${
                      m.role === 'user'
                        ? 'ml-6 bg-primary text-primary-foreground'
                        : 'mr-6 bg-muted text-foreground'
                    }`}
                  >
                    {m.text}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Textarea
                ref={editInputRef}
                value={editInput}
                onChange={e => setEditInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEdit(); }
                }}
                placeholder={'e.g. "I only had half the butter chicken"'}
                rows={2}
                className="resize-none text-sm"
                disabled={editBusy}
              />
              <Button
                size="icon"
                onClick={handleEdit}
                disabled={!editInput.trim() || editBusy}
                className="shrink-0 self-end"
              >
                {editBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Primary CTA — Log to my day */}
      <div className="flex flex-col gap-2">
        {logState === 'done' ? (
          <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <Loader2 className="h-4 w-4 animate-spin" />
            Logged — opening your CFO…
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
