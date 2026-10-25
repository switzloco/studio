'use client';

import React, { useState } from 'react';
import {
  Briefcase,
  Check,
  Sparkles,
  ArrowRight,
  KeyRound,
  Loader2,
  X,
  Zap,
  Camera,
  Mic,
  BarChart3,
  Cloud,
} from 'lucide-react';
import {
  GoogleAuthProvider,
  linkWithPopup,
  linkWithRedirect,
} from 'firebase/auth';
import {
  shouldUseRedirectSignIn,
  isPopupUnavailableError,
  isUserCancelledError,
  isNativeShell,
} from '@/lib/auth-environment';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { CFO_PRICING, FREE_AI_AUDITS_LIMIT } from '@/lib/entitlements';
import { redeemFounderCodeAction } from '@/app/actions/entitlements';
import type { StripeCheckoutPlan } from '@/lib/stripe-server';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToZeroAi?: () => void;
  auditsUsed?: number;
  freeLimit?: number;
}

export function PaywallModal({
  isOpen,
  onClose,
  onSwitchToZeroAi,
  auditsUsed = FREE_AI_AUDITS_LIMIT,
  freeLimit = FREE_AI_AUDITS_LIMIT,
}: PaywallModalProps) {
  const { user } = useUser();
  const { toast } = useToast();

  const [selectedPlan, setSelectedPlan] = useState<StripeCheckoutPlan>('annual');
  const [isActivating, setIsActivating] = useState(false);
  const [isLinkingGoogle, setIsLinkingGoogle] = useState(false);
  const nativeShell = isNativeShell();
  const [showCodeBox, setShowCodeBox] = useState(nativeShell);
  const [founderCode, setFounderCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);

  if (!isOpen) return null;

  const handleLinkGoogleAccount = async (): Promise<boolean> => {
    if (!user || !user.isAnonymous) return true;
    setIsLinkingGoogle(true);
    const provider = new GoogleAuthProvider();

    if (shouldUseRedirectSignIn()) {
      try {
        await linkWithRedirect(user, provider);
        return false; // Redirecting away
      } catch (err: any) {
        toast({
          variant: 'destructive',
          title: 'Account Link Failed',
          description: err?.message || 'Could not link Google account.',
        });
        setIsLinkingGoogle(false);
        return false;
      }
    }

    try {
      await linkWithPopup(user, provider);
      toast({
        title: 'Portfolio Identity Secured',
        description: 'Your guest ledger is now permanently bound to your Google account.',
      });
      setIsLinkingGoogle(false);
      return true;
    } catch (err: any) {
      if (isUserCancelledError(err)) {
        setIsLinkingGoogle(false);
        return false;
      }
      if (isPopupUnavailableError(err)) {
        try {
          await linkWithRedirect(user, provider);
          return false;
        } catch (redirectErr: any) {
          toast({
            variant: 'destructive',
            title: 'Account Link Failed',
            description: redirectErr?.message || 'Could not link Google account.',
          });
          setIsLinkingGoogle(false);
          return false;
        }
      }
      toast({
        variant: 'destructive',
        title: 'Account Link Failed',
        description: err?.message || 'Could not link Google account.',
      });
      setIsLinkingGoogle(false);
      return false;
    }
  };

  const handleActivatePlan = async () => {
    if (!user) return;

    // Layer 1 Orphaned-Retainer Guard: link anonymous account before opening Stripe Checkout
    if (user.isAnonymous) {
      const linked = await handleLinkGoogleAccount();
      if (!linked) return;
    }

    setIsActivating(true);
    try {
      const idToken = await user.getIdToken(true);
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ plan: selectedPlan }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }

      if (res.status === 503 || data.code === 'STRIPE_NOT_CONFIGURED') {
        setShowCodeBox(true);
        toast({
          title: 'Stripe Key Pending — Use Partner Code',
          description:
            data.error ||
            'Add STRIPE_SECRET_KEY to enable card checkout, or enter a Founding Partner code below.',
        });
        return;
      }

      toast({
        variant: 'destructive',
        title: 'Checkout Unavailable',
        description: data.error || 'Please try again.',
      });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Checkout Error',
        description: err?.message || 'Unexpected error.',
      });
    } finally {
      setIsActivating(false);
    }
  };

  const handleRedeemCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !founderCode.trim()) return;
    setIsRedeeming(true);
    try {
      const idToken = await user.getIdToken();
      const res = await redeemFounderCodeAction(idToken, founderCode);
      if (res.success) {
        toast({
          title: 'Founding Partner Immunity Unlocked',
          description: 'Welcome to the tribe. Unlimited AI CFO access is now active on your ledger.',
        });
        setFounderCode('');
        onClose();
      } else {
        toast({
          variant: 'destructive',
          title: 'Code Not Recognized',
          description: res.error || 'Double-check your code or message Nick.',
        });
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Redemption Error',
        description: err?.message || 'Could not verify code.',
      });
    } finally {
      setIsRedeeming(false);
    }
  };

  const planButtonPriceLabel =
    selectedPlan === 'annual'
      ? `$${CFO_PRICING.annualPriceUsd}/yr`
      : selectedPlan === 'monthly'
      ? `$${CFO_PRICING.monthlyPriceUsd}/mo`
      : `$${CFO_PRICING.foundingPartnerLifetimeUsd} Lifetime`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <Card className="w-full max-w-xl border-none shadow-2xl bg-background overflow-hidden my-auto relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors z-10"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Top Executive Header */}
        <div className="bg-slate-900 text-white p-6 sm:p-8 space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300">
            <Briefcase className="w-3.5 h-3.5" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">
              Opening Audit Complete ({Math.min(auditsUsed, freeLimit)}/{freeLimit} Free AI Turns)
            </span>
          </div>
          <h3 className="text-2xl sm:text-3xl font-black italic uppercase tracking-tight leading-none">
            Retain the AI CFO — Or Keep the Cockpit Free Forever
          </h3>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            Most fitness apps hold your own data hostage behind a paywall. We don&apos;t.
            Your deterministic math stays 100% free forever — we only charge when you hire the live AI agent to do the bookkeeping.
          </p>
        </div>

        <CardContent className="p-6 sm:p-8 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Two-Column Honest Comparison */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Left: Free Forever */}
            <div className="p-4 rounded-2xl border bg-muted/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  The Open Terminal
                </span>
                <span className="text-xs font-black uppercase px-2 py-0.5 rounded bg-slate-200 text-slate-800">
                  $0 Forever
                </span>
              </div>
              <p className="text-[11px] font-medium text-muted-foreground leading-relaxed">
                Runs on pure physiological math (`v3.2 Taylor–Joule`) with zero AI token cost:
              </p>
              <ul className="space-y-2 text-xs font-semibold text-foreground">
                {[
                  'Daily VF Score & Alpert Eat Runway',
                  'Zero-AI 3-Day Nutritionist & Glycogen Tank',
                  '1-Tap Ticker Book & Manual Quick Log',
                  'Level Sprint Tracker (500–3,000 pt blocks)',
                  'Fitbit, Google Health, Oura & Withings Sync',
                  'Full CSV & JSON Ledger Export',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Right: Executive Retainer */}
            <div className="p-4 rounded-2xl border-2 border-primary bg-primary/5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-primary">
                  Executive Retainer
                </span>
                <span className="text-xs font-black uppercase px-2 py-0.5 rounded bg-primary text-white">
                  CFO Pro
                </span>
              </div>
              <p className="text-[11px] font-medium text-muted-foreground leading-relaxed">
                Covers live multimodal Gemini 2.5 reasoning, USDA macro lookups & voice transcription:
              </p>
              <ul className="space-y-2 text-xs font-bold text-foreground">
                <li className="flex items-start gap-2">
                  <Camera className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                  <span>Unlimited Multi-Photo Meal & Menu Audits (with EXIF time backfill)</span>
                </li>
                <li className="flex items-start gap-2">
                  <Zap className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                  <span>Plain-English AI Coach + USDA Verified Macro Bookkeeping</span>
                </li>
                <li className="flex items-start gap-2">
                  <Mic className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                  <span>Hands-Free Voice Dictation Desk</span>
                </li>
                <li className="flex items-start gap-2">
                  <BarChart3 className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                  <span>180-Day Ledger Analyst & Cross-Domain Quant Queries</span>
                </li>
              </ul>
            </div>
          </div>

          {/* 3-Plan Selector (Web only — hidden inside iOS/Android native shell per Guideline 3.1.1 / Play Payments Policy) */}
          {!nativeShell && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={() => setSelectedPlan('annual')}
              className={`p-3.5 rounded-2xl border-2 text-left transition-all relative ${
                selectedPlan === 'annual'
                  ? 'border-primary bg-primary/5 shadow-md'
                  : 'border-border hover:border-primary/40'
              }`}
            >
              <span className="absolute -top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[8px] font-black uppercase tracking-wider">
                Save 49% · Hero
              </span>
              <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Annual Partner</p>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-xl font-black italic text-foreground">
                  ${CFO_PRICING.annualMonthlyEquivalentUsd}
                </span>
                <span className="text-[10px] font-bold text-muted-foreground">/ mo</span>
              </div>
              <p className="text-[10px] font-medium text-muted-foreground mt-0.5">
                ${CFO_PRICING.annualPriceUsd}/yr · 1-click cancel
              </p>
            </button>

            <button
              type="button"
              onClick={() => setSelectedPlan('monthly')}
              className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                selectedPlan === 'monthly'
                  ? 'border-primary bg-primary/5 shadow-md'
                  : 'border-border hover:border-primary/40'
              }`}
            >
              <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Monthly Sprint</p>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-xl font-black italic text-foreground">
                  ${CFO_PRICING.monthlyPriceUsd}
                </span>
                <span className="text-[10px] font-bold text-muted-foreground">/ mo</span>
              </div>
              <p className="text-[10px] font-medium text-muted-foreground mt-0.5">
                Flexible 6-week DEXA block
              </p>
            </button>

            <button
              type="button"
              onClick={() => setSelectedPlan('lifetime')}
              className={`p-3.5 rounded-2xl border-2 text-left transition-all relative ${
                selectedPlan === 'lifetime'
                  ? 'border-primary bg-primary/5 shadow-md'
                  : 'border-border hover:border-primary/40'
              }`}
            >
              <span className="absolute -top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-amber-600 text-white text-[8px] font-black uppercase tracking-wider">
                One-Time
              </span>
              <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Founding Seat</p>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-xl font-black italic text-foreground">
                  ${CFO_PRICING.foundingPartnerLifetimeUsd}
                </span>
                <span className="text-[10px] font-bold text-muted-foreground">once</span>
              </div>
              <p className="text-[10px] font-medium text-muted-foreground mt-0.5">
                No recurring bill ever
              </p>
            </button>
          </div>
          )}

          {/* Anonymous User Pre-Checkout Guard (Web only) */}
          {!nativeShell && user?.isAnonymous && (
            <div className="p-3.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-900">
                  Step 1 · Protect Your Guest Ledger First
                </p>
                <p className="text-[11px] font-medium text-amber-800/90 leading-snug">
                  You&apos;re currently on a guest session. Clicking below binds your Google account to this exact ledger before opening Stripe so your retainer travels across phone &amp; desktop.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={isLinkingGoogle}
                onClick={handleLinkGoogleAccount}
                className="shrink-0 rounded-xl text-[10px] font-black uppercase tracking-wider gap-1.5"
              >
                {isLinkingGoogle ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Cloud className="w-3.5 h-3.5 text-primary" />
                )}
                Link Google First
              </Button>
            </div>
          )}

          {/* Primary & Zero-AI CTAs */}
          <div className="space-y-2.5">
            {!nativeShell && (
              <>
                <Button
                  onClick={handleActivatePlan}
                  disabled={isActivating || isLinkingGoogle}
                  className="w-full h-13 py-3.5 rounded-2xl text-sm font-black uppercase tracking-widest shadow-xl"
                >
                  {isActivating || isLinkingGoogle ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {isLinkingGoogle ? 'Securing Identity...' : 'Opening Stripe Checkout...'}
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      {user?.isAnonymous
                        ? `Link Google & Retain CFO (${planButtonPriceLabel})`
                        : `Retain the AI CFO (${planButtonPriceLabel})`}
                    </>
                  )}
                </Button>

                <p className="text-[10px] text-center font-medium text-muted-foreground">
                  Apple Pay, Google Pay &amp; Card via Stripe · Cancel in 1 click anytime from Settings · Keep 100% of your ledger forever
                </p>
              </>
            )}

            {onSwitchToZeroAi && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onClose();
                  onSwitchToZeroAi();
                }}
                className="w-full h-11 rounded-2xl text-xs font-black uppercase tracking-widest border-emerald-600/30 text-emerald-700 hover:bg-emerald-50"
              >
                Keep Using Zero-AI Cockpit (Free Forever)
                <ArrowRight className="w-3.5 h-3.5 ml-2" />
              </Button>
            )}
          </div>

          {/* Founding Partner / Friend of Nick Code Redemption */}
          <div className="pt-3 border-t border-border/60">
            {!showCodeBox ? (
              <button
                type="button"
                onClick={() => setShowCodeBox(true)}
                className="w-full flex items-center justify-center gap-1.5 text-[11px] font-bold text-muted-foreground hover:text-primary transition-colors py-1"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Have a Founding Partner or Substack Tribe code from Nick?</span>
              </button>
            ) : (
              <form onSubmit={handleRedeemCode} className="flex gap-2">
                <Input
                  placeholder="Enter Partner Code (e.g. BEERBELLYBALLERS)"
                  value={founderCode}
                  onChange={(e) => setFounderCode(e.target.value)}
                  className="h-10 text-xs font-mono uppercase tracking-wider"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={isRedeeming || !founderCode.trim()}
                  className="h-10 px-4 rounded-xl text-xs font-black uppercase tracking-wider shrink-0"
                >
                  {isRedeeming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Unlock'}
                </Button>
              </form>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
