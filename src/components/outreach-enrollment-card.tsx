'use client';

import React, { useEffect, useState } from 'react';
import { Mail, MessageCircle, Clock, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { enrollPublicOutreachAction } from '@/app/actions/outreach';
import type { OutreachCadence, OutreachChannel } from '@/lib/health-service';

export function OutreachEnrollmentCard() {
  const [channel, setChannel] = useState<OutreachChannel>('email');
  const [email, setEmail] = useState('');
  const [discordUserId, setDiscordUserId] = useState('');
  const [weightLbs, setWeightLbs] = useState('');
  const [cadence, setCadence] = useState<OutreachCadence>('3x');
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrolledPreview, setEnrolledPreview] = useState<{
    headline: string;
    body: string;
    deliveredNow?: boolean;
  } | null>(null);

  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setTimezone(detected);
    } catch {
      // Keep default America/Los_Angeles
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const parsedWeight = weightLbs.trim() ? Number(weightLbs.trim()) : undefined;
      const res = await enrollPublicOutreachAction({
        channel,
        email: channel === 'email' ? email : undefined,
        discordUserId: channel === 'discord' ? discordUserId : undefined,
        weightLbs: parsedWeight,
        cadence,
        timezone,
      });

      if (!res.success) {
        setError(res.error || 'Could not activate briefings.');
        return;
      }

      setEnrolledPreview({
        headline: res.headline || 'Briefings Activated',
        body: res.body || 'Your Morning, Midday, and Evening dispatches are scheduled.',
        deliveredNow: res.deliveredNow,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section id="daily-briefings" className="py-16 px-6">
      <div className="max-w-4xl mx-auto">
        <Card className="border-2 border-primary/20 shadow-2xl bg-card overflow-hidden rounded-3xl">
          <CardContent className="p-8 md:p-10 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest">
                  <Clock className="w-3 h-3" />
                  Free Autopilot Coaching · $0 · 1-Click Cancel
                </div>
                <h3 className="text-2xl md:text-3xl font-black uppercase italic tracking-tight text-foreground">
                  Don&apos;t Want Another Dashboard? Get 3x/Day &ldquo;Eat-By&rdquo; Briefings
                </h3>
                <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
                  Morning, Midday, and Evening dispatches via Email or Discord. Every ping gives you one clear call — either an exact <strong>&ldquo;Eat by 2:30 PM&rdquo;</strong> protein window or <strong>&ldquo;You&apos;re good from yesterday&rdquo;</strong> — with 1-tap logging and 1-click cancel in every message.
                </p>
              </div>
            </div>

            {enrolledPreview ? (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 space-y-3">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-black uppercase tracking-widest">
                  <CheckCircle2 className="w-4 h-4" />
                  {enrolledPreview.deliveredNow
                    ? 'Active — First Live Briefing Dispatched'
                    : 'Active — Scheduled for Your Local Timezone'}
                </div>
                <div className="text-lg font-black text-foreground">
                  {enrolledPreview.headline}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {enrolledPreview.body}
                </p>
                <div className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl text-xs font-bold"
                    onClick={() => setEnrolledPreview(null)}
                  >
                    Update Delivery Preferences
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5 pt-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={channel === 'email' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setChannel('email')}
                    className="rounded-xl font-black uppercase tracking-wider text-xs gap-2"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    Email Briefings
                  </Button>
                  <Button
                    type="button"
                    variant={channel === 'discord' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setChannel('discord')}
                    className="rounded-xl font-black uppercase tracking-wider text-xs gap-2"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Discord DMs
                  </Button>
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2 space-y-1.5">
                    {channel === 'email' ? (
                      <>
                        <Label htmlFor="outreach-email" className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                          Email Address
                        </Label>
                        <Input
                          id="outreach-email"
                          type="email"
                          required
                          placeholder="you@domain.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="h-11 rounded-xl"
                        />
                      </>
                    ) : (
                      <>
                        <Label htmlFor="outreach-discord" className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                          Discord User ID (17–20 Digits)
                        </Label>
                        <Input
                          id="outreach-discord"
                          type="text"
                          required
                          placeholder="123456789012345678"
                          value={discordUserId}
                          onChange={(e) => setDiscordUserId(e.target.value)}
                          className="h-11 rounded-xl font-mono"
                        />
                      </>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="outreach-weight" className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                      Body Weight (lbs, optional)
                    </Label>
                    <Input
                      id="outreach-weight"
                      type="number"
                      min={80}
                      max={500}
                      placeholder="175"
                      value={weightLbs}
                      onChange={(e) => setWeightLbs(e.target.value)}
                      className="h-11 rounded-xl"
                    />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => setCadence(cadence === '3x' ? 'morning_only' : '3x')}
                      className="underline font-bold text-foreground hover:text-primary transition-colors"
                    >
                      {cadence === '3x'
                        ? 'Cadence: Morning, Midday & Evening (3x/day)'
                        : 'Cadence: Morning Briefing Only (1x/day)'}
                    </button>
                    <span>·</span>
                    <span className="font-mono text-[11px]">{timezone}</span>
                  </div>

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="h-12 px-8 rounded-xl font-black uppercase tracking-widest text-xs gap-2 shrink-0"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    Start Free Briefings
                  </Button>
                </div>

                {error && (
                  <p className="text-xs font-bold text-destructive">{error}</p>
                )}
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
