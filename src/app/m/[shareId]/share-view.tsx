'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Briefcase, Check, Link2, Share2, Users } from 'lucide-react';
import Link from 'next/link';
import type { SharedMealItem } from '@/lib/food-exercise-types';

export interface ShareDTO {
  id: string;
  title: string;
  createdByName?: string;
  items: SharedMealItem[];
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number; fiberG: number };
  logCount: number;
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
  const [copied, setCopied] = useState(false);
  // Resolve native-share support after mount to avoid a hydration mismatch.
  const [canNativeShare, setCanNativeShare] = useState(false);
  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && 'share' in navigator);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const handleNativeShare = async () => {
    if (canNativeShare) {
      try {
        await navigator.share({
          title: share.title,
          text: `${share.createdByName ? `${share.createdByName} shared ` : ''}a meal: ${share.title}`,
          url: window.location.href,
        });
      } catch {
        /* user cancelled — no-op */
      }
    } else {
      handleCopy();
    }
  };

  const attribution = share.createdByName ? `${share.createdByName} shared this meal` : 'Shared with you';

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-8">
      <div className="flex items-center gap-2 text-primary">
        <Briefcase className="h-5 w-5" />
        <span className="text-sm font-semibold tracking-tight">the CFO</span>
      </div>

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

          {share.logCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span>{share.logCount} {share.logCount === 1 ? 'person has' : 'people have'} logged this</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        {/* "Log this to my day" lands in step 3 — interactive logging + anon auth. */}
        <Button onClick={canNativeShare ? handleNativeShare : handleCopy} className="w-full" size="lg">
          {canNativeShare ? <Share2 className="mr-2 h-4 w-4" /> : <Link2 className="mr-2 h-4 w-4" />}
          Share this meal
        </Button>
        <Button onClick={handleCopy} variant="outline" className="w-full">
          {copied ? <Check className="mr-2 h-4 w-4" /> : <Link2 className="mr-2 h-4 w-4" />}
          {copied ? 'Link copied' : 'Copy link'}
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Track your nutrition like a portfolio.{' '}
        <Link href="/" className="font-medium text-primary hover:underline">Open the CFO →</Link>
      </p>
    </main>
  );
}
