'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Loader2,
  Mail,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUser } from '@/firebase';
import {
  enrollPublicOutreachAction,
  updateMyOutreachSettingsAction,
} from '@/app/actions/outreach';
import type { OutreachCadence, OutreachChannel } from '@/lib/health-service';

export function BriefingsEnrollView() {
  const { user } = useUser();

  const [channel, setChannel] = useState<OutreachChannel>('email');
  const [email, setEmail] = useState('');
  const [discordUserId, setDiscordUserId] = useState('');
  const [weightLbs, setWeightLbs] = useState('');
  const [cadence, setCadence] = useState<OutreachCadence>('3x');
  const [morningHour, setMorningHour] = useState(7);
  const [middayHour, setMiddayHour] = useState(12);
  const [nightHour, setNightHour] = useState(19);
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [enrolledResult, setEnrolledResult] = useState<{
    headline: string;
    body: string;
    deliveredNow?: boolean;
  } | null>(null);

  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setTimezone(detected);
    } catch {
      // Keep America/Los_Angeles default
    }
  }, []);

  useEffect(() => {
    if (user?.email && !email) {
      setEmail(user.email);
    }
  }, [user?.email, email]);

  const handleCopyShareLink = async () => {
    try {
      const shareUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}/briefings`
          : 'https://cfofitness.app/briefings';
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const parsedWeight = weightLbs.trim() ? Number(weightLbs.trim()) : undefined;
      const cleanEmail = email.trim().toLowerCase();

      // Use authenticated UID only when not an anonymous guest OR when enrolling the exact signed-in email
      const useCurrentUserUid =
        Boolean(user) &&
        (!user?.email || cleanEmail === user.email.toLowerCase() || channel === 'discord') &&
        !parsedWeight;

      let res: {
        success: boolean;
        error?: string;
        headline?: string;
        body?: string;
        deliveredNow?: boolean;
      };

      if (useCurrentUserUid && user) {
        const idToken = await user.getIdToken();
        res = await updateMyOutreachSettingsAction(idToken, {
          enabled: true,
          channel,
          cadence,
          email: channel === 'email' ? cleanEmail : undefined,
          discordUserId: channel === 'discord' ? discordUserId.trim() : undefined,
          timezone,
          morningHour,
          middayHour,
          nightHour,
          sendWelcomeNow: true,
        });
      } else {
        res = await enrollPublicOutreachAction({
          channel,
          email: channel === 'email' ? cleanEmail : undefined,
          discordUserId: channel === 'discord' ? discordUserId.trim() : undefined,
          weightLbs: parsedWeight,
          cadence,
          timezone,
          morningHour,
          middayHour,
          nightHour,
        });
      }

      if (!res.success) {
        setError(res.error || 'Could not activate briefings right now.');
        return;
      }

      setEnrolledResult({
        headline: res.headline || 'Welcome Briefing Sent',
        body:
          res.body ||
          'Your Morning, Midday, and Evening Eat-By briefings are active.',
        deliveredNow: res.deliveredNow,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top Bar */}
      <header className="border-b bg-background/90 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="p-2 bg-primary text-white rounded-xl shadow-xs">
              <Briefcase className="w-4 h-4" />
            </div>
            <div>
              <span className="text-lg font-black italic uppercase tracking-tighter">
                the CFO
              </span>
              <span className="hidden sm:inline text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-2">
                Daily Briefings
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopyShareLink}
              className="rounded-xl text-xs font-bold gap-1.5"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  Copied Link
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Share Page
                </>
              )}
            </Button>
            <Button asChild variant="outline" size="sm" className="rounded-xl text-xs font-black uppercase tracking-wider">
              <Link href="/">
                Open App
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-10 md:py-16 space-y-12">
        <div className="grid lg:grid-cols-12 gap-8 md:gap-10 items-start">
          {/* Left Pitch & Sample Dispatches */}
          <div className="lg:col-span-6 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-700 text-[11px] font-black uppercase tracking-widest">
              <Clock className="w-3.5 h-3.5" />
              $0 Forever · No Credit Card · 1-Click Cancel
            </div>

            <h1 className="text-3xl sm:text-5xl font-black italic uppercase tracking-tight leading-[1.05]">
              Skip the Food App. Get a 3x/Day &ldquo;Eat-By&rdquo; Clock.
            </h1>

            <p className="text-base text-muted-foreground leading-relaxed">
              Morning, Midday, and Evening briefings delivered straight to your{' '}
              <strong className="text-foreground">Email</strong> or{' '}
              <strong className="text-foreground">Discord</strong>. Every message gives you one physiological directive — either an exact{' '}
              <strong className="text-foreground">&ldquo;Eat by 2:30 PM&rdquo;</strong> protein window or{' '}
              <strong className="text-foreground">&ldquo;You&apos;re good through 8:00 AM.&rdquo;</strong>
            </p>

            {/* Sample 3-Window Preview */}
            <div className="space-y-3 pt-1">
              <div className="rounded-2xl border bg-emerald-50/70 border-emerald-500/30 p-4 space-y-1">
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-emerald-800">
                  <span>7:00 AM · Morning Check-In</span>
                  <span>Fueled Until Lunch</span>
                </div>
                <p className="text-sm font-black text-slate-900">
                  Last night&apos;s fuel holds — eat by 12:30 PM
                </p>
                <p className="text-xs text-slate-600">
                  Liver glycogen covers morning output cleanly while fat oxidation runs at 68 kcal/hr.
                </p>
              </div>

              <div className="rounded-2xl border bg-amber-50/70 border-amber-500/30 p-4 space-y-1">
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-amber-800">
                  <span>12:00 PM · Midday Pulse</span>
                  <span>Action Window</span>
                </div>
                <p className="text-sm font-black text-slate-900">
                  Eat ~45g lean protein by 2:30 PM
                </p>
                <p className="text-xs text-slate-600">
                  Last on record + direct check-in: reply in plain English (<em>&ldquo;3 eggs and sourdough toast&rdquo;</em>) or attach a meal / nutrition-label photo.
                </p>
              </div>

              <div className="rounded-2xl border bg-slate-50 border-slate-200 p-4 space-y-1">
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-600">
                  <span>7:00 PM · Evening Closeout</span>
                  <span>Overnight Check</span>
                </div>
                <p className="text-sm font-black text-slate-900">
                  Fueled through 8:00 AM tomorrow — close the kitchen
                </p>
                <p className="text-xs text-slate-600">
                  Sleep fat oxidation covers overnight BMR cleanly. Projected VF Score: +135 pts.
                </p>
              </div>
            </div>
          </div>

          {/* Right Enrollment Form Card */}
          <div className="lg:col-span-6">
            <Card className="border-2 border-primary/20 shadow-2xl rounded-3xl overflow-hidden">
              <CardContent className="p-6 sm:p-8 space-y-6">
                {enrolledResult ? (
                  <div className="space-y-5">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-700 text-xs font-black uppercase tracking-widest">
                      <CheckCircle2 className="w-4 h-4" />
                      {enrolledResult.deliveredNow
                        ? 'Welcome Email Sent — Check Your Inbox'
                        : 'Briefings Activated'}
                    </div>

                    <div className="space-y-2">
                      <h2 className="text-2xl font-black italic uppercase tracking-tight">
                        You&apos;re Enrolled ($0)
                      </h2>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        We just sent your <strong>Welcome &amp; How-It-Works Briefing</strong> along with your live Eat-By clock below:
                      </p>
                    </div>

                    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-50/80 p-4 space-y-1.5">
                      <p className="text-[10px] font-black uppercase tracking-widest text-emerald-800">
                        Right Now · Live Status
                      </p>
                      <p className="text-base font-black text-slate-900">
                        {enrolledResult.headline}
                      </p>
                      <p className="text-xs text-slate-700 leading-relaxed">
                        {enrolledResult.body}
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                      <Button
                        type="button"
                        variant="default"
                        onClick={handleCopyShareLink}
                        className="flex-1 h-11 rounded-xl text-xs font-black uppercase tracking-wider gap-2"
                      >
                        {copiedLink ? (
                          <>
                            <Check className="w-4 h-4" />
                            Copied Link!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            Copy Invite Link
                          </>
                        )}
                      </Button>
                      <Button
                        asChild
                        variant="outline"
                        className="flex-1 h-11 rounded-xl text-xs font-black uppercase tracking-wider"
                      >
                        <Link href="/">
                          Open Full Dashboard
                          <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                        </Link>
                      </Button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setEnrolledResult(null)}
                      className="text-xs font-bold text-muted-foreground underline hover:text-foreground"
                    >
                      Enroll another email or update schedule
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="space-y-1">
                      <h2 className="text-xl sm:text-2xl font-black italic uppercase tracking-tight">
                        Start Free Daily Briefings
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        Sends your Welcome Guide + first live Eat-By clock immediately.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant={channel === 'email' ? 'default' : 'outline'}
                        onClick={() => setChannel('email')}
                        className="h-11 rounded-xl font-black uppercase tracking-wider text-xs gap-2"
                      >
                        <Mail className="w-4 h-4" />
                        Email
                      </Button>
                      <Button
                        type="button"
                        variant={channel === 'discord' ? 'default' : 'outline'}
                        onClick={() => setChannel('discord')}
                        className="h-11 rounded-xl font-black uppercase tracking-wider text-xs gap-2"
                      >
                        <MessageCircle className="w-4 h-4" />
                        Discord DM
                      </Button>
                    </div>

                    <div className="space-y-1.5">
                      {channel === 'email' ? (
                        <>
                          <Label htmlFor="briefings-email" className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                            Email Address
                          </Label>
                          <Input
                            id="briefings-email"
                            type="email"
                            required
                            placeholder="you@gmail.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="h-12 rounded-xl text-sm"
                          />
                        </>
                      ) : (
                        <div className="space-y-3">
                          <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-3.5 space-y-2">
                            <p className="text-xs font-bold text-foreground">
                              Fastest Setup (Zero ID Needed):
                            </p>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                              Add <strong>the CFO</strong> to Discord in 1 click, then type{' '}
                              <code className="font-mono font-bold text-foreground">/start</code> (or{' '}
                              <code className="font-mono font-bold text-foreground">/start email:you@gmail.com</code>) right in Discord.
                            </p>
                            <Button
                              asChild
                              type="button"
                              variant="default"
                              size="sm"
                              className="w-full h-10 rounded-xl font-black uppercase tracking-wider text-xs gap-2"
                            >
                              <a
                                href={`https://discord.com/oauth2/authorize?client_id=${process.env.NEXT_PUBLIC_DISCORD_APP_ID || '1570868560065077420'}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <MessageCircle className="w-4 h-4" />
                                1-Click Add to Discord
                              </a>
                            </Button>
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="briefings-discord" className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                              Or Enroll Directly by Discord User ID (17–20 Digits)
                            </Label>
                            <Input
                              id="briefings-discord"
                              type="text"
                              inputMode="numeric"
                              required
                              placeholder="123456789012345678"
                              value={discordUserId}
                              onChange={(e) => setDiscordUserId(e.target.value)}
                              className="h-12 rounded-xl font-mono text-sm"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="briefings-weight" className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                          Body Weight (lbs, optional)
                        </Label>
                        <Input
                          id="briefings-weight"
                          type="number"
                          min={80}
                          max={500}
                          placeholder="180"
                          value={weightLbs}
                          onChange={(e) => setWeightLbs(e.target.value)}
                          className="h-11 rounded-xl text-sm"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="briefings-cadence" className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                          Frequency
                        </Label>
                        <select
                          id="briefings-cadence"
                          value={cadence}
                          onChange={(e) => setCadence(e.target.value as OutreachCadence)}
                          className="w-full h-11 rounded-xl border border-input bg-background px-3 text-xs font-bold"
                        >
                          <option value="3x">3x/Day (Morning, Midday &amp; Night)</option>
                          <option value="morning_only">Morning Briefing Only (1x/Day)</option>
                        </select>
                      </div>
                    </div>

                    {/* Delivery Hours */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                          Delivery Hours
                        </Label>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {timezone}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <select
                          aria-label="Morning hour"
                          value={morningHour}
                          onChange={(e) => setMorningHour(Number(e.target.value))}
                          className="h-10 rounded-xl border border-input bg-background px-2 text-xs font-semibold"
                        >
                          {[5, 6, 7, 8, 9, 10].map((h) => (
                            <option key={h} value={h}>
                              {h}:00 AM
                            </option>
                          ))}
                        </select>

                        <select
                          aria-label="Midday hour"
                          disabled={cadence === 'morning_only'}
                          value={middayHour}
                          onChange={(e) => setMiddayHour(Number(e.target.value))}
                          className="h-10 rounded-xl border border-input bg-background px-2 text-xs font-semibold disabled:opacity-40"
                        >
                          {[11, 12, 13, 14, 15].map((h) => (
                            <option key={h} value={h}>
                              {h === 12 ? '12:00 PM' : h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`}
                            </option>
                          ))}
                        </select>

                        <select
                          aria-label="Evening hour"
                          disabled={cadence === 'morning_only'}
                          value={nightHour}
                          onChange={(e) => setNightHour(Number(e.target.value))}
                          className="h-10 rounded-xl border border-input bg-background px-2 text-xs font-semibold disabled:opacity-40"
                        >
                          {[17, 18, 19, 20, 21].map((h) => (
                            <option key={h} value={h}>
                              {h - 12}:00 PM
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {error && (
                      <p className="text-xs font-bold text-destructive">{error}</p>
                    )}

                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full h-13 rounded-2xl text-sm font-black uppercase tracking-widest shadow-xl gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Sending Welcome Briefing...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          Send My Welcome Briefing ($0)
                        </>
                      )}
                    </Button>

                    <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] font-semibold text-muted-foreground pt-1">
                      <span className="flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        1-Click Cancel in Every Email
                      </span>
                      <span className="flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5 text-primary" />
                        Reply with Text or Meal Photos
                      </span>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
