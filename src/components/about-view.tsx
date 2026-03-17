'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Briefcase, Dumbbell, ScanLine, MessageSquare, CheckCircle2, Loader2 } from 'lucide-react';

// Replace with your Formspree form ID: https://formspree.io
const FORMSPREE_ENDPOINT = 'https://formspree.io/f/YOUR_FORM_ID';

type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

export function AboutView() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<FormStatus>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('submitting');
    try {
      const res = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name, email, message }),
      });
      if (res.ok) {
        setStatus('success');
        setName('');
        setEmail('');
        setMessage('');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="flex flex-col gap-10 p-6 md:p-12 lg:p-16 pb-24 bg-background h-full overflow-y-auto">

      {/* Header */}
      <div className="space-y-6">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.2em] italic">About the Tracker</h2>
        </div>

        {/* Hero card */}
        <Card className="border-none shadow-xl overflow-hidden bg-primary text-white">
          <CardContent className="p-8 md:p-12 flex flex-col gap-6">
            <div className="flex items-center gap-5">
              <div className="p-5 bg-white/10 rounded-2xl shrink-0">
                <Briefcase className="w-10 h-10 text-white" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-60 mb-1">Chief Fitness Officer</p>
                <h3 className="text-2xl font-black italic tracking-tighter leading-tight">About the Tracker</h3>
              </div>
            </div>
            <div className="space-y-4 text-sm font-medium opacity-80 leading-relaxed">
              <p>
                I built this tool because I needed a better way to measure my daily habits against actual, physical changes. It started as a personal experiment: a <span className="font-black text-white">custom, 100-point daily scoring system</span> designed to track visceral fat loss, keep me accountable to my movement, and ensure I hit my protein goals.
              </p>
              <p>
                After accumulating <span className="font-black text-white">3,000 positive points</span> and seeing the physical results line up with the math, I decided to build this out a bit further.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Feature pills */}
      <div className="space-y-4">
        <h3 className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-1 italic">What It Tracks</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: <Dumbbell className="w-5 h-5 text-orange-600" />, bg: 'bg-orange-100', label: 'Daily Scores', desc: 'Activity, protein, and sleep goals combine into a single daily equity score.' },
            { icon: <MessageSquare className="w-5 h-5 text-purple-600" />, bg: 'bg-purple-100', label: 'Food & Drink Logs', desc: 'Log meals through the AI coach. Macros are pulled from the USDA database, never guessed.' },
            { icon: <ScanLine className="w-5 h-5 text-emerald-600" />, bg: 'bg-emerald-100', label: 'DEXA Integration', desc: 'Starting to integrate hard data from DEXA scans to keep the math grounded in reality.' },
          ].map(({ icon, bg, label, desc }) => (
            <Card key={label} className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
              <CardContent className="p-6">
                <div className={`p-3 ${bg} rounded-xl w-fit mb-3 shadow-sm`}>{icon}</div>
                <p className="text-[12px] font-black text-foreground uppercase tracking-[0.1em] mb-1">{label}</p>
                <p className="text-[11px] font-medium text-muted-foreground leading-relaxed">{desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
          <CardContent className="p-6">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-2">Beta Status</p>
            <p className="text-sm font-medium text-muted-foreground leading-relaxed">
              This app is very much in beta. It&apos;s a sandbox for me to stay compliant with my own health protocols while experimenting with some new coding tools behind the scenes.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Contact form */}
      <div className="space-y-4">
        <h3 className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-1 italic">Want to Help Improve It?</h3>

        <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
          <CardContent className="p-6 md:p-8 space-y-6">
            <p className="text-sm font-medium text-muted-foreground leading-relaxed">
              If you&apos;re testing this out, I want to hear from you. Whether you have ideas for new features, ways to improve the scoring system, or you just spotted a bug — your feedback is huge.
            </p>

            {status === 'success' ? (
              <div className="flex flex-col items-center gap-4 py-8 text-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-500" />
                <div>
                  <p className="font-black uppercase tracking-widest text-foreground">Message Received</p>
                  <p className="text-[11px] text-muted-foreground mt-1">Thanks — I&apos;ll get back to you soon.</p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="about-name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Name</Label>
                    <Input
                      id="about-name"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="Your name"
                      className="rounded-xl border-primary/10 bg-background"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="about-email" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Email <span className="text-destructive">*</span></Label>
                    <Input
                      id="about-email"
                      type="email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="rounded-xl border-primary/10 bg-background"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="about-message" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Message <span className="text-destructive">*</span></Label>
                  <Textarea
                    id="about-message"
                    required
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Feature ideas, bug reports, scoring suggestions…"
                    rows={4}
                    className="rounded-xl border-primary/10 bg-background resize-none"
                  />
                </div>
                {status === 'error' && (
                  <p className="text-[11px] text-destructive font-bold">Something went wrong — please try again.</p>
                )}
                <Button
                  type="submit"
                  disabled={status === 'submitting'}
                  className="w-full h-12 rounded-xl font-black uppercase tracking-widest text-sm"
                >
                  {status === 'submitting' ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending…</>
                  ) : (
                    'Drop Me a Message'
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
