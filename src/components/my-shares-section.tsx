'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Link2, Loader2, Share2, Trash2, Users } from 'lucide-react';
import { useUser } from '@/firebase';
import { toast } from '@/hooks/use-toast';
import { getMyShares, revokeShare } from '@/app/actions/share-meal';
import { shareUrl } from '@/lib/site';

type ShareRow = {
  id: string;
  title: string;
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number; fiberG: number };
  logCount: number;
  viewCount: number;
  revoked?: boolean;
};

export function MySharesSection() {
  const { user } = useUser();
  const [rows, setRows] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const res = await getMyShares(user.uid);
    if (res.success) setRows(res.shares as ShareRow[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const handleCopy = async (shareId: string) => {
    const url = shareUrl(shareId);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(shareId);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast({ variant: 'destructive', title: 'Could not copy', description: 'Copy the URL manually.' });
    }
  };

  const handleRevoke = async (shareId: string) => {
    if (!user || revoking) return;
    setRevoking(shareId);
    const res = await revokeShare(user.uid, shareId);
    if (res.success) {
      setRows(prev => prev.map(r => r.id === shareId ? { ...r, revoked: true } : r));
      toast({ title: 'Link revoked', description: 'Nobody can access this share anymore.' });
    } else {
      toast({ variant: 'destructive', title: 'Could not revoke', description: res.error });
    }
    setRevoking(null);
  };

  const active = rows.filter(r => !r.revoked);
  const revoked = rows.filter(r => r.revoked);

  if (!user || loading) {
    return loading ? (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    ) : null;
  }

  if (rows.length === 0) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.2em] italic px-1">
        Shared Links
      </h3>

      {active.length > 0 && (
        <div className="space-y-3">
          {active.map(share => (
            <Card key={share.id} className="border-none shadow-sm bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <p className="text-sm font-bold truncate">{share.title}</p>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="tabular-nums">{Math.round(share.totals.calories)} cal · {Math.round(share.totals.proteinG)}g P</span>
                      {share.logCount > 0 && (
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {share.logCount} logged
                        </span>
                      )}
                      {share.viewCount > 0 && (
                        <span>{share.viewCount} views</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleCopy(share.id)}
                      title="Copy share link"
                      className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    >
                      {copied === share.id
                        ? <Link2 className="w-3.5 h-3.5 text-emerald-600" />
                        : <Link2 className="w-3.5 h-3.5" />
                      }
                    </button>
                    <button
                      onClick={() => handleRevoke(share.id)}
                      disabled={revoking === share.id}
                      title="Revoke link"
                      className="p-2 rounded-lg hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-600 disabled:opacity-50"
                    >
                      {revoking === share.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />
                      }
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {revoked.length > 0 && (
        <div className="space-y-2">
          {revoked.map(share => (
            <div key={share.id} className="flex items-center gap-3 px-4 py-2.5 rounded-xl ring-1 ring-border opacity-40">
              <Share2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground truncate line-through">{share.title}</span>
              <span className="text-[10px] text-muted-foreground ml-auto shrink-0">Revoked</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
