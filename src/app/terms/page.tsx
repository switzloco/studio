import Link from 'next/link';
import { Briefcase, ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service | CFO Fitness',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-6 py-12">

        {/* Header */}
        <div className="mb-10">
          <Link href="/" className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground mb-8 transition-colors">
            <ArrowLeft className="w-3 h-3" />
            Back to App
          </Link>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-primary text-white rounded-xl shadow-md">
              <Briefcase className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground">CFO Fitness</span>
          </div>
          <h1 className="text-3xl font-black italic tracking-tighter uppercase text-foreground">Terms of Service</h1>
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mt-2">Last updated: March 25, 2026</p>
        </div>

        {/* Content */}
        <div className="space-y-8 text-sm font-medium text-muted-foreground leading-relaxed">

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">The Short Version</h2>
            <p>
              CFO Fitness is a free beta app. Use it in good faith, don&apos;t abuse it, and understand that it&apos;s not a substitute for professional medical advice. We can change or shut it down at any time.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Acceptance</h2>
            <p>
              By using CFO Fitness you agree to these terms. If you don&apos;t agree, don&apos;t use the app. It&apos;s that simple.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Not Medical Advice</h2>
            <p>
              CFO Fitness is a personal tracking and productivity tool, not a medical device or healthcare service. The AI coaching, scoring system, calorie estimates, and any other output are for informational and motivational purposes only.
            </p>
            <p>
              Nothing in this app constitutes medical advice, diagnosis, or treatment. Always consult a qualified healthcare professional before making changes to your diet, exercise, or health regimen — especially if you have a medical condition.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Free Service / Beta</h2>
            <p>
              CFO Fitness is currently free to use. It is a beta product, meaning it is actively being developed, may contain bugs, and features may change or be removed at any time without notice. We make no guarantees about availability or uptime.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Your Account</h2>
            <p>
              You are responsible for maintaining access to your account. If you use Google sign-in, your identity is managed by Google. If you use anonymous access, understand that your data is tied to your browser session — clearing it means losing access.
            </p>
            <p>
              You may not use the app to submit false data with the intent to manipulate or abuse the system, or to access other users&apos; data.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Your Data</h2>
            <p>
              You own your health data. We store it to operate the app. We do not claim ownership over the data you submit. See our <Link href="/privacy" className="text-primary underline underline-offset-2">Privacy Policy</Link> for details on how it is stored and used.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Wearable Connections</h2>
            <p>
              If you connect a Fitbit or Oura Ring, you authorize CFO Fitness to access your health data from those services on your behalf. You can revoke this at any time by disconnecting in the app or through your wearable account settings. We only fetch the data types needed to power the dashboard (steps, sleep, HRV, calories).
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Attempt to reverse engineer, scrape, or interfere with the app or its API endpoints</li>
              <li>Use the app in any way that violates applicable laws</li>
              <li>Submit content that is abusive, harmful, or violates others&apos; rights</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Disclaimer of Warranties</h2>
            <p>
              CFO Fitness is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, express or implied. We do not warrant that the app will be error-free, uninterrupted, or accurate. Use it at your own risk.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by law, CFO Fitness and its developers are not liable for any indirect, incidental, or consequential damages arising from your use of the app — including but not limited to health outcomes, data loss, or decisions made based on app output.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Changes and Termination</h2>
            <p>
              We reserve the right to modify these terms, change or discontinue features, or shut down the app at any time. We will try to provide notice for major changes, but make no guarantees.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Contact</h2>
            <p>
              Questions about these terms? Use the feedback form in the About tab of the app.
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-border flex items-center justify-between">
          <Link href="/" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
            ← Back to App
          </Link>
          <Link href="/privacy" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
            Privacy Policy →
          </Link>
        </div>

      </div>
    </div>
  );
}
