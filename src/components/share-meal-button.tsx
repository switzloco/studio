'use client';

import React, { useEffect, useState } from 'react';
import { Share2, Link2, Loader2, Check } from 'lucide-react';
import { useUser } from '@/firebase';
import { toast } from '@/hooks/use-toast';
import { createMealShare } from '@/app/actions/share-meal';
import { shareUrl } from '@/lib/site';
import { shareMealText } from '@/lib/share-text';

/**
 * Shares one or more food-log entries as a public link. Creates the snapshot
 * via the server action, then hands the resulting /m/{shareId} URL to the
 * native share sheet (mobile) or the clipboard (desktop).
 */
export function ShareMealButton({
  foodLogIds,
  label = 'Share meal',
  mealName,
}: {
  foodLogIds: string[];
  label?: string;
  mealName?: string;
}) {
  const { user } = useUser();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Resolve native-share support after mount to avoid a hydration mismatch.
  const [canNativeShare, setCanNativeShare] = useState(false);
  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && 'share' in navigator);
  }, []);

  const handleShare = async (e: React.MouseEvent) => {
    // Ledger rows toggle expand on click — don't let that fire from the button.
    e.stopPropagation();
    if (busy || !user) return;

    setBusy(true);
    try {
      const userName = user.displayName ?? undefined;
      const res = await createMealShare(user.uid, foodLogIds, userName);
      if (!res.success) {
        toast({ variant: 'destructive', title: 'Could not share', description: res.error });
        return;
      }

      const url = shareUrl(res.shareId);
      const shareText = shareMealText({ mealName });

      if (canNativeShare) {
        try {
          await navigator.share({ title: 'the CFO', text: shareText, url });
        } catch {
          /* user cancelled the share sheet — leave it at that */
        }
      } else {
        await navigator.clipboard.writeText(url);
        toast({ title: 'Link copied', description: 'Share link is on your clipboard.' });
      }

      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not share', description: err?.message ?? 'Unknown error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={handleShare}
      disabled={busy || !user}
      title="Share this meal as a link"
      className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full transition-all text-muted-foreground hover:text-foreground hover:bg-muted ring-1 ring-border disabled:opacity-50"
    >
      {busy ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : done ? (
        <Check className="w-3.5 h-3.5 text-emerald-600" />
      ) : canNativeShare ? (
        <Share2 className="w-3.5 h-3.5" />
      ) : (
        <Link2 className="w-3.5 h-3.5" />
      )}
      {done ? 'Shared' : label}
    </button>
  );
}
