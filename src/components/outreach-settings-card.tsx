'use client';

import React, { useEffect, useState } from 'react';
import { Bell, Check, Loader2, Mail, MessageCircle, Send, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import type { OutreachCadence, OutreachChannel, OutreachPreferences } from '@/lib/health-service';
import {
  sendLiveBriefingNowAction,
  updateMyOutreachSettingsAction,
} from '@/app/actions/outreach';

interface OutreachSettingsCardProps {
  user: { email?: string | null; getIdToken: () => Promise<string> } | null;
  initialOutreach?: OutreachPreferences;
}

export function OutreachSettingsCard({ user, initialOutreach }: OutreachSettingsCardProps) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(Boolean(initialOutreach?.enabled));
  const [channel, setChannel] = useState<OutreachChannel>(initialOutreach?.channel ?? 'email');
  const [cadence, setCadence] = useState<OutreachCadence>(initialOutreach?.cadence ?? '3x');
  const [email, setEmail] = useState(initialOutreach?.email ?? user?.email ?? '');
  const [discordUserId, setDiscordUserId] = useState(initialOutreach?.discordUserId ?? '');
  const [timezone, setTimezone] = useState(initialOutreach?.timezone ?? 'America/Los_Angeles');
  const [morningHour, setMorningHour] = useState(String(initialOutreach?.morningHour ?? 7));
  const [middayHour, setMiddayHour] = useState(String(initialOutreach?.middayHour ?? 12));
  const [nightHour, setNightHour] = useState(String(initialOutreach?.nightHour ?? 19));

  const [isSaving, setIsSaving] = useState(false);
  const [isSendingNow, setIsSendingNow] = useState(false);
  const [livePreview, setLivePreview] = useState<{ headline: string; body: string } | null>(null);

  useEffect(() => {
    if (initialOutreach) {
      setEnabled(Boolean(initialOutreach.enabled));
      setChannel(initialOutreach.channel ?? 'email');
      setCadence(initialOutreach.cadence ?? '3x');
      if (initialOutreach.email) setEmail(initialOutreach.email);
      if (initialOutreach.discordUserId) setDiscordUserId(initialOutreach.discordUserId);
      if (initialOutreach.timezone) setTimezone(initialOutreach.timezone);
      if (initialOutreach.morningHour != null) setMorningHour(String(initialOutreach.morningHour));
      if (initialOutreach.middayHour != null) setMiddayHour(String(initialOutreach.middayHour));
      if (initialOutreach.nightHour != null) setNightHour(String(initialOutreach.nightHour));
    } else {
      try {
        const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (detected) setTimezone(detected);
      } catch {
        // Fallback already set
      }
      if (user?.email && !email) setEmail(user.email);
    }
  }, [initialOutreach, user?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (nextEnabled = enabled) => {
    if (!user) return;
    setIsSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await updateMyOutreachSettingsAction(idToken, {
        enabled: nextEnabled,
        channel,
        cadence,
        email,
        discordUserId,
        timezone,
        morningHour: Number(morningHour) || 7,
        middayHour: Number(middayHour) || 12,
        nightHour: Number(nightHour) || 19,
      });

      if (!res.success) {
        toast({
          variant: 'destructive',
          title: 'Could Not Update Briefings',
          description: res.error || 'Check your email or Discord ID.',
        });
        return;
      }

      setEnabled(nextEnabled);
      toast({
        title: nextEnabled ? 'Daily Briefings Active' : 'Daily Briefings Canceled',
        description: nextEnabled
          ? `Scheduled (${cadence === '3x' ? 'Morning, Midday & Evening' : 'Morning Only'}) in ${timezone}.`
          : 'Automated outreach turned off immediately.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendNow = async () => {
    if (!user) return;
    setIsSendingNow(true);
    try {
      const idToken = await user.getIdToken();
      const res = await sendLiveBriefingNowAction(idToken);
      if (!res.success) {
        toast({
          variant: 'destructive',
          title: 'Briefing Error',
          description: res.error || 'Could not compose briefing.',
        });
        return;
      }
      if (res.headline && res.body) {
        setLivePreview({ headline: res.headline, body: res.body });
      }
      toast({
        title: res.delivered ? 'Live Briefing Sent' : 'Live Briefing Composed',
        description: res.delivered
          ? 'Check your Email or Discord DM.'
          : res.headline || 'Preview shown below.',
      });
    } finally {
      setIsSendingNow(false);
    }
  };

  return (
    <Card className="border-none shadow-lg bg-white/70 backdrop-blur-sm ring-1 ring-primary/10">
      <CardHeader className="p-6 pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-[12px] font-black uppercase text-muted-foreground flex items-center gap-3 tracking-widest">
            <Bell className="w-4 h-4 text-primary" />
            Automated Daily Briefings (Free · $0)
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={enabled ? 'default' : 'secondary'} className="text-[10px] uppercase font-black">
              {enabled ? 'Active' : 'Off'}
            </Badge>
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => {
                setEnabled(checked);
                if (!checked) handleSave(false);
              }}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6 pt-3 space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Receive Morning, Midday, and Evening dispatches with your live <strong>&ldquo;Eat by XYZ&rdquo;</strong> clock or <strong>&ldquo;Good from yesterday&rdquo;</strong> buffer status. Always free, 1-click cancel in every message.
        </p>

        <div className="flex flex-wrap gap-2">
          {(['email', 'discord', 'both'] as const).map((ch) => (
            <Button
              key={ch}
              type="button"
              size="sm"
              variant={channel === ch ? 'default' : 'outline'}
              onClick={() => setChannel(ch)}
              className="rounded-xl text-[11px] font-black uppercase tracking-wider gap-1.5"
            >
              {ch === 'email' && <Mail className="w-3 h-3" />}
              {ch === 'discord' && <MessageCircle className="w-3 h-3" />}
              {ch === 'both' ? 'Email + Discord' : ch}
            </Button>
          ))}

          <Button
            type="button"
            size="sm"
            variant={cadence === '3x' ? 'secondary' : 'outline'}
            onClick={() => setCadence(cadence === '3x' ? 'morning_only' : '3x')}
            className="rounded-xl text-[11px] font-bold ml-auto"
          >
            {cadence === '3x' ? '3x/Day (Morn · Mid · Night)' : '1x/Day (Morning Only)'}
          </Button>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {(channel === 'email' || channel === 'both') && (
            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                Delivery Email
              </Label>
              <Input
                type="email"
                placeholder="you@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9 text-xs bg-white/80"
              />
            </div>
          )}

          {(channel === 'discord' || channel === 'both') && (
            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                Discord User ID
              </Label>
              <Input
                type="text"
                placeholder="123456789012345678"
                value={discordUserId}
                onChange={(e) => setDiscordUserId(e.target.value)}
                className="h-9 text-xs font-mono bg-white/80"
              />
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
              Timezone
            </Label>
            <Input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="h-9 text-xs font-mono bg-white/80"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                Morn (h)
              </Label>
              <Input
                type="number"
                min={4}
                max={11}
                value={morningHour}
                onChange={(e) => setMorningHour(e.target.value)}
                className="h-9 text-xs bg-white/80"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                Mid (h)
              </Label>
              <Input
                type="number"
                min={11}
                max={16}
                disabled={cadence === 'morning_only'}
                value={middayHour}
                onChange={(e) => setMiddayHour(e.target.value)}
                className="h-9 text-xs bg-white/80"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                Night (h)
              </Label>
              <Input
                type="number"
                min={17}
                max={22}
                disabled={cadence === 'morning_only'}
                value={nightHour}
                onChange={(e) => setNightHour(e.target.value)}
                className="h-9 text-xs bg-white/80"
              />
            </div>
          </div>
        </div>

        {livePreview && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 space-y-1">
            <div className="text-xs font-black text-foreground">{livePreview.headline}</div>
            <div className="text-[11px] text-muted-foreground leading-relaxed">{livePreview.body}</div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            disabled={isSaving}
            onClick={() => handleSave(true)}
            className="rounded-xl font-black uppercase tracking-wider text-xs gap-1.5"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {enabled ? 'Save Briefing Schedule' : 'Enable Free Briefings'}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isSendingNow}
            onClick={handleSendNow}
            className="rounded-xl font-black uppercase tracking-wider text-xs gap-1.5"
          >
            {isSendingNow ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Send Live Briefing Now
          </Button>

          {enabled && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isSaving}
              onClick={() => handleSave(false)}
              className="rounded-xl font-black uppercase tracking-wider text-xs text-destructive hover:bg-destructive/10 gap-1.5 ml-auto"
            >
              <XCircle className="w-3.5 h-3.5" />
              Cancel Briefings
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
