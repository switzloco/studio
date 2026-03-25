import Link from 'next/link';
import { Briefcase, ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | CFO Fitness',
};

export default function PrivacyPage() {
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
          <h1 className="text-3xl font-black italic tracking-tighter uppercase text-foreground">Privacy Policy</h1>
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mt-2">Last updated: March 25, 2026</p>
        </div>

        {/* Content */}
        <div className="space-y-8 text-sm font-medium text-muted-foreground leading-relaxed">

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">The Short Version</h2>
            <p>
              CFO Fitness is a personal health tracking tool. We store your health data to make the app work. We do not sell it, share it with advertisers, or use it for anything other than running the app. That&apos;s it.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">What We Collect</h2>
            <p>When you use CFO Fitness, we store the following in Firebase (Google Cloud):</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><span className="font-bold text-foreground">Account info</span> — your Google display name and email if you sign in with Google. Nothing if you use anonymous access.</li>
              <li><span className="font-bold text-foreground">Health metrics</span> — steps, sleep hours, HRV, weight, height, body fat percentage, and calorie data you provide or that sync from a connected wearable.</li>
              <li><span className="font-bold text-foreground">Food and exercise logs</span> — meal entries and workout logs you submit through the AI coach.</li>
              <li><span className="font-bold text-foreground">Chat history</span> — conversations with the AI coach, stored so the coach has context across sessions.</li>
              <li><span className="font-bold text-foreground">Wearable OAuth tokens</span> — if you connect a Fitbit or Oura Ring, we store their access and refresh tokens to enable background syncing. These are stored in your private Firestore document, not shared.</li>
              <li><span className="font-bold text-foreground">Preferences</span> — your training schedule, equipment, and targets.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">How We Use Your Data</h2>
            <p>Your data is used exclusively to:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Display your dashboard and history</li>
              <li>Power the AI coaching conversations (sent to Google Gemini via the Genkit framework)</li>
              <li>Look up nutrition data via the USDA FoodData Central API (food names only, no personal data sent)</li>
              <li>Sync health metrics from connected wearables on your behalf</li>
            </ul>
            <p>
              We do not use your data for advertising, profiling, or any purpose beyond operating the app.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Third-Party Services</h2>
            <p>CFO Fitness uses the following third-party services to operate:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><span className="font-bold text-foreground">Firebase / Google Cloud</span> — database, authentication, and hosting. Governed by <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Google&apos;s Privacy Policy</a>.</li>
              <li><span className="font-bold text-foreground">Google Gemini (via Genkit)</span> — AI coaching responses. Your health context is sent to Gemini to generate coaching messages.</li>
              <li><span className="font-bold text-foreground">Fitbit / Oura</span> — if you connect a wearable, your health data is fetched from their APIs under your authorization. Governed by <a href="https://www.fitbit.com/global/us/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Fitbit&apos;s</a> or <a href="https://ouraring.com/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Oura&apos;s</a> privacy policies.</li>
              <li><span className="font-bold text-foreground">USDA FoodData Central</span> — nutrition lookups. No personal data is sent.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Data Security</h2>
            <p>
              Your data is stored in Firebase Firestore with security rules that restrict access to your own authenticated user ID. Wearable tokens are stored in a private subcollection of your user document. We use Firebase App Hosting with HTTPS for all traffic.
            </p>
            <p>
              No system is perfectly secure. This app is in beta and operated by a small team. We take reasonable precautions, but we cannot guarantee absolute security.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Anonymous Use</h2>
            <p>
              You can use the app without a Google account using anonymous access. Anonymous accounts are identified by a randomly generated ID. Your data is stored under that ID. If you clear your browser or switch devices, you lose access to that anonymous account and its data.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Deleting Your Data</h2>
            <p>
              To delete your account and all associated data, reach out via the feedback form in the app (About tab). We will remove your Firestore documents and revoke any wearable OAuth tokens.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Children</h2>
            <p>
              CFO Fitness is not directed at children under 13. We do not knowingly collect data from anyone under 13.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Changes to This Policy</h2>
            <p>
              We may update this policy as the app evolves. Changes will be reflected by an updated date at the top of this page.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Contact</h2>
            <p>
              Questions? Use the feedback form in the About tab of the app.
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-border flex items-center justify-between">
          <Link href="/" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
            ← Back to App
          </Link>
          <Link href="/terms" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
            Terms of Service →
          </Link>
        </div>

      </div>
    </div>
  );
}
