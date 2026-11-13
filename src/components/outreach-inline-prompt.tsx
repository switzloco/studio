'use client';

import React, { useEffect, useState } from 'react';
import { BellRing, CheckCircle2, Loader2, Mail, MessageSquare, X } from 'lucide-react';
import { doc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDoc, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import type { OutreachChannel, OutreachPreferences, UserPreferences } from '@/lib/health-service';
import {
  enrollPublicOutreachAction,
  updateMyOutreachSettingsAction,
} from '@/app/actions/outreach';

const DISMISS_STORAGE_KEY = 'cfo_outreachInlineDismissed';

export interface OutreachInlinePromptProps {
  variant: 'runway' | 'idle' | 'onboarding' | 'paywall';
  outreach?: OutreachPreferences;
  onEnrolled?: (result: { headline?: string; body?: string; deliveredNow?: boolean }) => void;
}

export function OutreachInlinePrompt({
  variant,
  outreach: outreachProp,
  onEnrolled,
}: OutreachInlinePromptProps) {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();

  const shouldSubscribePrefs = outreachProp === undefined;
  const prefsRef = useMemoFirebase(
    () => (shouldSubscribePrefs && user ? doc(db, 'users', user.uid, 'preferences', 'settings') : null),
    [shouldSubscribePrefs, db, user],
  );
  const { data: subscribedPrefs } = useDoc<UserPreferences>(prefsRef);
  const activeOutreach = outreachProp ?? subscribedPrefs?.outreach;

  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(variant === 'onboarding' || variant === 'paywall');
  const [channel, setChannel] = useState<OutreachChannel>('email');
  const [emailInput, setEmailInput] = useState('');
  const [discordInput, setDiscordInput] = useState('');
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [submitting, setSubmitting] = useState(false);
  const [justActivatedHeadline, setJustActivatedHeadline] = useState<string | null>(null);

  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setTimezone(detected);
    } catch {
      // Keep default America/Los_Angeles
    }
    if (variant === 'runway' || variant === 'idle') {
      try {
        if (localStorage.getItem(DISMISS_STORAGE_KEY) === '1') {
          setDismissed(true);
        }
      } catch {
        // Ignore storage restrictions
      }
    }
  }, [variant]);

  useEffect(() => {
    if (user?.email && !emailInput) {
      setEmailInput(user.email);
    } else if (activeOutreach?.email && !emailInput) {
      setEmailInput(activeOutreach.email);
    }
    if (activeOutreach?.discordUserId && !discordInput) {
      setDiscordInput(activeOutreach.discordUserId);
    }
  }, [user?.email, activeOutreach?.email, activeOutreach?.discordUserId, emailInput, discordInput]);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, '1');
    } catch {
      // Ignore
    }
  };

  const activateOutreach = async (overrideChannel?: OutreachChannel) => {
    const chosenChannel = overrideChannel ?? channel;
    const targetEmail = (emailInput || user?.email || '').trim().toLowerCase();
    const targetDiscord = discordInput.trim();

    if (chosenChannel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      setExpanded(true);
      toast({
        variant: 'destructive',
        title: 'Email Required',
        description: 'Enter a valid email address for Morning, Midday & Evening briefings.',
      });
      return;
    }

    if (chosenChannel === 'discord' && !/^\d{15,22}$/.test(targetDiscord)) {
      setExpanded(true);
      toast({
        variant: 'destructive',
        title: 'Discord User ID Required',
        description: 'Enter your numeric 17–20 digit Discord User ID.',
      });
      return;
    }

    setSubmitting(true);
    try {
      let res: {
        success: boolean;
        error?: string;
        headline?: string;
        body?: string;
        deliveredNow?: boolean;
      };

      if (user) {
        const idToken = await user.getIdToken();
        res = await updateMyOutreachSettingsAction(idToken, {
          enabled: true,
          channel: chosenChannel,
          cadence: '3x',
          email: chosenChannel === 'email' ? targetEmail : undefined,
          discordUserId: chosenChannel === 'discord' ? targetDiscord : undefined,
          timezone,
          sendWelcomeNow: true,
        });
      } else {
        res = await enrollPublicOutreachAction({
          channel: chosenChannel,
          email: chosenChannel === 'email' ? targetEmail : undefined,
          discordUserId: chosenChannel === 'discord' ? targetDiscord : undefined,
          cadence: '3x',
          timezone,
        });
      }

      if (!res.success) {
        toast({
          variant: 'destructive',
          title: 'Could Not Enable Briefings',
          description: res.error || 'Please check your address and try again.',
        });
        return;
      }

      setJustActivatedHeadline(res.headline || 'Morning, Midday & Evening Briefings Active');
      toast({
        title: '3x/Day Autopilot Active ($0)',
        description: res.deliveredNow
          ? 'Your first live Eat-By briefing was just sent.'
          : 'Scheduled for 7:00 AM, 12:00 PM & 7:00 PM local time. 1-click cancel anytime.',
      });
      onEnrolled?.({
        headline: res.headline,
        body: res.body,
        deliveredNow: res.deliveredNow,
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Already enabled state
  if (activeOutreach?.enabled) {
    if ((variant === 'runway' || variant === 'idle') && !justActivatedHeadline) {
      return null;
    }

    const destination =
      activeOutreach.channel === 'discord'
        ? `Discord (${activeOutreach.discordUserId || 'DM'})`
        : activeOutreach.email || user?.email || 'Email';

    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-50/90 px-3.5 py-2.5 flex items-center justify-between gap-2 text-left">
        <div className="flex items-center gap-2 min-w-0">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-black text-emerald-950 truncate">
              3x/Day Eat-By Briefings Active · $0
            </p>
            <p className="text-[11px] font-medium text-emerald-800 truncate">
              {justActivatedHeadline ?? `Sending Morning, Midday & Evening to ${destination}`}
            </p>
          </div>
        </div>
        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-700 text-white shrink-0">
          Live
        </span>
      </div>
    );
  }

  if (dismissed && (variant === 'runway' || variant === 'idle')) {
    return null;
  }

  const hasKnownEmail = Boolean(user?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email));

  // Compact collapsed 1-row bar for Today Eat Runway & Coach Idle
  if (!expanded && (variant === 'runway' || variant === 'idle')) {
    return (
      <div
        className={`rounded-xl border border-emerald-600/25 bg-emerald-50/75 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-left ${
          variant === 'idle' ? 'max-w-md w-full shadow-xs' : ''
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <BellRing className="w-4 h-4 text-emerald-700 shrink-0" />
          <p className="text-xs font-bold text-emerald-950 leading-snug">
            <span className="font-black uppercase tracking-wider text-[10px] bg-emerald-700 text-white px-1.5 py-0.5 rounded mr-1.5">
              Free · $0
            </span>
            {variant === 'runway'
              ? 'Get this live Eat-By clock via Email or Discord 3x/day (Morning, Midday & Night).'
              : 'Prefer autopilot? Get Morning, Midday & Night Eat-By briefings via Email or Discord.'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {hasKnownEmail ? (
            <>
              <Button
                type="button"
                size="sm"
                disabled={submitting}
                onClick={() => activateOutreach('email')}
                className="h-8 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-black uppercase tracking-wider"
              >
                {submitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <Mail className="w-3 h-3 mr-1.5" />
                    Email Me 3x/Day
                  </>
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setChannel('discord');
                  setExpanded(true);
                }}
                className="h-8 px-2 text-[10px] font-black uppercase tracking-wider text-emerald-900 hover:bg-emerald-100"
              >
                Discord
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => setExpanded(true)}
              className="h-8 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-black uppercase tracking-wider"
            >
              Send Me Briefings
            </Button>
          )}
          <button
            type="button"
            aria-label="Dismiss briefing prompt"
            onClick={handleDismiss}
            className="p-1 rounded-md text-emerald-900/50 hover:text-emerald-950 hover:bg-emerald-100 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // Expanded inline enrollment card (used directly in Onboarding & Paywall, or when expanded on Runway/Idle)
  return (
    <div
      className={`rounded-2xl border border-emerald-600/30 bg-emerald-50/80 p-3.5 space-y-2.5 text-left ${
        variant === 'idle' ? 'max-w-md w-full shadow-xs' : 'w-full'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="px-2 py-0.5 rounded bg-emerald-700 text-white text-[10px] font-black uppercase tracking-wider">
              Free · $0 Forever
            </span>
            <span className="text-xs font-black uppercase tracking-tight text-emerald-950">
              3x/Day Eat-By Autopilot
            </span>
          </div>
          <p className="text-[11px] font-medium text-emerald-900/90 leading-snug">
            Morning, Midday &amp; Evening &ldquo;Eat by XYZ&rdquo; briefings (or &ldquo;You&apos;re good through morning&rdquo;). Reply to log meals · 1-click cancel.
          </p>
        </div>

        {(variant === 'runway' || variant === 'idle') && (
          <button
            type="button"
            aria-label="Close"
            onClick={() => setExpanded(false)}
            className="p-1 rounded-md text-emerald-900/50 hover:text-emerald-950"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setChannel('email')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-colors ${
            channel === 'email'
              ? 'bg-emerald-700 text-white border-emerald-700'
              : 'bg-white/80 text-emerald-950 border-emerald-600/20 hover:bg-white'
          }`}
        >
          <Mail className="w-3 h-3" />
          Email
        </button>
        <button
          type="button"
          onClick={() => setChannel('discord')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-colors ${
            channel === 'discord'
              ? 'bg-emerald-700 text-white border-emerald-700'
              : 'bg-white/80 text-emerald-950 border-emerald-600/20 hover:bg-white'
          }`}
        >
          <MessageSquare className="w-3 h-3" />
          Discord DM
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        {channel === 'email' ? (
          <Input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="you@domain.com"
            className="h-9 text-xs bg-white border-emerald-600/25 flex-1"
          />
        ) : (
          <Input
            type="text"
            inputMode="numeric"
            value={discordInput}
            onChange={(e) => setDiscordInput(e.target.value)}
            placeholder="17-20 digit Discord User ID"
            className="h-9 text-xs bg-white border-emerald-600/25 flex-1 font-mono"
          />
        )}

        <Button
          type="button"
          size="sm"
          disabled={submitting}
          onClick={() => activateOutreach()}
          className="h-9 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black uppercase tracking-wider shrink-0"
        >
          {submitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              Activating...
            </>
          ) : (
            'Enable Free'
          )}
        </Button>
      </div>
    </div>
  );
}
