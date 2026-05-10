'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Loader2, CheckCircle2, AlertCircle, Share2, Briefcase, ArrowLeft, FileText, Zap, Activity, Target, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase';
import { getAuth } from 'firebase/auth';
import Link from 'next/link';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ParsedData {
  domain: string;
  category: string;
  summary: string;
  totalAttempts?: number;
  totalMakes?: number;
  totalMisses?: number;
  shootingPct?: number;
  caloriesBurned?: number;
  durationMin?: number;
  avgHeartRate?: number;
  steps?: number;
  distanceKm?: number;
  activityName?: string;
  notes?: string;
  drillBreakdown?: Array<{
    drillName: string;
    attempts?: number;
    makes?: number;
    pct?: number;
  }>;
}

interface IngestResult {
  success: boolean;
  documentId?: string;
  parsed?: ParsedData;
  error?: string;
}

type IngestStatus = 'idle' | 'loading' | 'success' | 'error' | 'no-data' | 'not-authenticated';

// ─── Domain badge styling ───────────────────────────────────────────────────

function getDomainStyle(domain: string) {
  switch (domain) {
    case 'performance':
      return { bg: 'bg-amber-500/10', text: 'text-amber-600', border: 'border-amber-500/20', icon: Target, label: 'Performance' };
    case 'metabolic':
      return { bg: 'bg-emerald-500/10', text: 'text-emerald-600', border: 'border-emerald-500/20', icon: Activity, label: 'Metabolic' };
    case 'mixed':
      return { bg: 'bg-blue-500/10', text: 'text-blue-600', border: 'border-blue-500/20', icon: Zap, label: 'Mixed' };
    default:
      return { bg: 'bg-zinc-500/10', text: 'text-zinc-500', border: 'border-zinc-500/20', icon: FileText, label: 'Unknown' };
  }
}

// ─── Inner component that reads search params ───────────────────────────────

function IncomingShareInner() {
  const searchParams = useSearchParams();
  const { user, isUserLoading } = useUser();

  const [status, setStatus] = useState<IngestStatus>('idle');
  const [result, setResult] = useState<IngestResult | null>(null);
  const [rawText, setRawText] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  // Extract the shared data from URL params (set by service worker redirect)
  const sharedTitle = searchParams.get('title') || '';
  const sharedText = searchParams.get('text') || '';
  const sharedUrl = searchParams.get('url') || '';

  // Combine all shared fields into a single raw string
  const combinedRaw = [sharedTitle, sharedText, sharedUrl].filter(Boolean).join('\n').trim();

  useEffect(() => {
    setRawText(combinedRaw);
    if (!combinedRaw) setStatus('no-data');
  }, [combinedRaw]);

  // Auto-ingest when we have data + auth
  const doIngest = useCallback(async () => {
    if (!user || !rawText) return;

    setStatus('loading');
    try {
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) {
        setStatus('not-authenticated');
        return;
      }

      const now = new Date();
      const res = await fetch('/api/ingest-share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          rawText,
          sourceTitle: sharedTitle || undefined,
          sourceUrl: sharedUrl || undefined,
          localDate: now.toLocaleDateString('en-CA'),
          localTime: now.toTimeString().slice(0, 5),
        }),
      });

      const data: IngestResult = await res.json();
      setResult(data);
      setStatus(data.success ? 'success' : 'error');
    } catch (err: any) {
      setResult({ success: false, error: err?.message || 'Network error.' });
      setStatus('error');
    }
  }, [user, rawText, sharedTitle, sharedUrl]);

  // Auto-fire ingestion once auth resolves and we have data
  useEffect(() => {
    if (!isUserLoading && user && rawText && status === 'idle') {
      doIngest();
    } else if (!isUserLoading && !user && rawText) {
      setStatus('not-authenticated');
    }
  }, [isUserLoading, user, rawText, status, doIngest]);

  // ── Render states ──

  if (isUserLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto" />
          <p className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground">Authenticating Portfolio</p>
        </div>
      </div>
    );
  }

  if (status === 'not-authenticated') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="p-4 bg-destructive/10 rounded-2xl w-fit mx-auto">
            <AlertCircle className="w-10 h-10 text-destructive" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black uppercase tracking-tight">Access Denied</h1>
            <p className="text-sm text-muted-foreground">You must be logged in to ingest shared data. Open the app and sign in first.</p>
          </div>
          <Link href="/">
            <Button className="rounded-xl font-bold uppercase tracking-wider">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to CFO Terminal
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (status === 'no-data') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="p-4 bg-muted rounded-2xl w-fit mx-auto">
            <Share2 className="w-10 h-10 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black uppercase tracking-tight">No Incoming Data</h1>
            <p className="text-sm text-muted-foreground">
              Share text from another app (Fitbit stats, basketball shooting strings, workout notes) to this app via the OS share sheet.
            </p>
          </div>
          <Link href="/">
            <Button variant="outline" className="rounded-xl font-bold uppercase tracking-wider">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to CFO Terminal
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="p-4 px-6 flex items-center gap-3 border-b bg-card/50 backdrop-blur-md sticky top-0 z-10">
        <Link href="/">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div className="p-2 bg-primary text-white rounded-xl shadow-md">
          <Briefcase className="w-4 h-4" />
        </div>
        <div>
          <h1 className="text-sm font-black uppercase tracking-wider leading-none">Incoming Share</h1>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">Data Ingestion Pipeline</p>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-6 space-y-6">
        {/* Status Card */}
        <div className="rounded-2xl border bg-card p-6 space-y-4">
          {status === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
                <div className="relative p-4 bg-primary/10 rounded-full">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-black uppercase tracking-widest text-foreground">Processing Incoming Data</p>
                <p className="text-xs text-muted-foreground">The Coach is parsing your shared content…</p>
              </div>
            </div>
          )}

          {status === 'success' && result?.parsed && (
            <div className="space-y-5">
              {/* Success header */}
              <div className="flex items-start gap-3">
                <div className="p-2 bg-emerald-500/10 rounded-xl shrink-0">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-black uppercase tracking-wider text-emerald-600">Data Ingested</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">Doc ID: {result.documentId}</p>
                </div>
              </div>

              {/* Domain badge */}
              {(() => {
                const ds = getDomainStyle(result.parsed.domain);
                const Icon = ds.icon;
                return (
                  <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${ds.bg} ${ds.border}`}>
                    <Icon className={`w-3.5 h-3.5 ${ds.text}`} />
                    <span className={`text-[10px] font-black uppercase tracking-widest ${ds.text}`}>{ds.label}</span>
                    <span className="text-[10px] font-bold text-muted-foreground ml-1">· {result.parsed.category}</span>
                  </div>
                );
              })()}

              {/* Summary */}
              <p className="text-sm font-medium text-foreground leading-relaxed">{result.parsed.summary}</p>

              {/* Performance Metrics */}
              {(result.parsed.totalAttempts != null || result.parsed.shootingPct != null) && (
                <div className="rounded-xl border bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">Performance Metrics</p>
                  <div className="grid grid-cols-3 gap-3">
                    {result.parsed.totalAttempts != null && (
                      <div className="text-center">
                        <p className="text-2xl font-black text-foreground">{result.parsed.totalAttempts}</p>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Attempts</p>
                      </div>
                    )}
                    {result.parsed.totalMakes != null && (
                      <div className="text-center">
                        <p className="text-2xl font-black text-emerald-600">{result.parsed.totalMakes}</p>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Makes</p>
                      </div>
                    )}
                    {result.parsed.shootingPct != null && (
                      <div className="text-center">
                        <p className="text-2xl font-black text-primary">{result.parsed.shootingPct.toFixed(1)}%</p>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Accuracy</p>
                      </div>
                    )}
                  </div>

                  {/* Drill Breakdown */}
                  {result.parsed.drillBreakdown && result.parsed.drillBreakdown.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-amber-200/50 dark:border-amber-800/30">
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Drill Breakdown</p>
                      {result.parsed.drillBreakdown.map((drill, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="font-bold text-foreground">{drill.drillName}</span>
                          <span className="font-mono text-muted-foreground">
                            {drill.makes != null && drill.attempts != null
                              ? `${drill.makes}/${drill.attempts}`
                              : '—'}
                            {drill.pct != null && <span className="ml-2 font-bold text-primary">({drill.pct.toFixed(0)}%)</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Metabolic Metrics */}
              {(result.parsed.caloriesBurned != null || result.parsed.durationMin != null || result.parsed.steps != null) && (
                <div className="rounded-xl border bg-emerald-50/50 dark:bg-emerald-950/20 p-4 space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Metabolic Data</p>
                  <div className="grid grid-cols-2 gap-3">
                    {result.parsed.caloriesBurned != null && (
                      <div>
                        <p className="text-xl font-black text-foreground">{result.parsed.caloriesBurned}</p>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Cal Burned</p>
                      </div>
                    )}
                    {result.parsed.durationMin != null && (
                      <div>
                        <p className="text-xl font-black text-foreground">{result.parsed.durationMin}m</p>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Duration</p>
                      </div>
                    )}
                    {result.parsed.avgHeartRate != null && (
                      <div>
                        <p className="text-xl font-black text-foreground">{result.parsed.avgHeartRate}</p>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Avg HR</p>
                      </div>
                    )}
                    {result.parsed.steps != null && (
                      <div>
                        <p className="text-xl font-black text-foreground">{result.parsed.steps.toLocaleString()}</p>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Steps</p>
                      </div>
                    )}
                    {result.parsed.distanceKm != null && (
                      <div>
                        <p className="text-xl font-black text-foreground">{result.parsed.distanceKm.toFixed(1)} km</p>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Distance</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Notes */}
              {result.parsed.notes && (
                <div className="rounded-xl border bg-muted/50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Notes</p>
                  <p className="text-xs text-foreground">{result.parsed.notes}</p>
                </div>
              )}

              {/* Raw text toggle */}
              <button
                onClick={() => setShowRaw(prev => !prev)}
                className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
              >
                <FileText className="w-3 h-3" />
                Raw Input
                {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showRaw && (
                <pre className="text-[11px] text-muted-foreground bg-muted/50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono border">
                  {rawText}
                </pre>
              )}
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-destructive/10 rounded-xl shrink-0">
                  <AlertCircle className="w-6 h-6 text-destructive" />
                </div>
                <div>
                  <p className="text-sm font-black uppercase tracking-wider text-destructive">Ingestion Failed</p>
                  <p className="text-xs text-muted-foreground mt-1">{result?.error || 'Unknown error during parsing.'}</p>
                </div>
              </div>

              <Button onClick={doIngest} className="w-full rounded-xl font-bold uppercase tracking-wider">
                Retry Ingestion
              </Button>

              {/* Show what we tried to parse */}
              <pre className="text-[11px] text-muted-foreground bg-muted/50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono border">
                {rawText}
              </pre>
            </div>
          )}
        </div>

        {/* Nav back */}
        {(status === 'success' || status === 'error') && (
          <div className="flex gap-3">
            <Link href="/" className="flex-1">
              <Button variant="outline" className="w-full rounded-xl font-bold uppercase tracking-wider text-xs h-12">
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to Terminal
              </Button>
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Page wrapper with Suspense boundary for useSearchParams ────────────────

export default function IncomingSharePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
      </div>
    }>
      <IncomingShareInner />
    </Suspense>
  );
}
