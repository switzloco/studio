import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy | the CFO (CFO Fitness)',
  description: 'Privacy policy and account deletion instructions for the CFO (CFO Fitness) application.',
};

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 prose prose-stone">
      <h1 className="text-3xl font-black uppercase tracking-tighter mb-8">Privacy Policy</h1>
      
      <p className="text-muted-foreground mb-8">Effective Date: May 12, 2026 (Updated October 25, 2026)</p>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">1. Introduction</h2>
        <p>
          Welcome to <strong>the CFO (Chief Fitness Officer / CFO Fitness)</strong>. We are committed to protecting your personal information and your right to privacy. This Privacy Policy explains how we collect, use, store, and delete your data when you use our web, iOS, and Android applications.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">2. Data We Collect &amp; Device Permissions</h2>
        <p>
          To provide fitness portfolio tracking, deterministic Visceral Fat (VF) scoring, and AI coaching, we collect the following information when you choose to provide or connect it:
        </p>
        <ul className="list-disc pl-6 space-y-2 mt-4">
          <li><strong>Account Profile:</strong> Email address, display name, or anonymous/Apple/Google sign-in identifier via Firebase Authentication.</li>
          <li><strong>Fitness &amp; Nutrition Logs:</strong> Meals, macronutrients (protein, carbohydrates, fats, calories, alcohol), workouts, fasted hours, sleep duration, and body composition metrics.</li>
          <li><strong>Optional Wearable Sync:</strong> Activity data (steps, calories, distance), sleep patterns, and heart rate variability (HRV) when you explicitly connect Fitbit or Google Health.</li>
          <li><strong>Camera &amp; Photo Library (Optional):</strong> Meal and workout photos you capture or attach so the AI Coach can estimate macronutrients or log workouts.</li>
          <li><strong>Microphone (Optional):</strong> Short voice recordings when you tap the microphone button to dictate meals or workouts for transcription. Audio is transcribed immediately and is not permanently stored.</li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">3. How We Use Your Data</h2>
        <p>
          Your data is used exclusively to:
        </p>
        <ul className="list-disc pl-6 space-y-2 mt-4">
          <li>Compute your daily Visceral Fat (VF) score, Alpert Number, and 3-day rolling nutrition ledger.</li>
          <li>Sync and display your fitness metrics across your dashboard and historical charts.</li>
          <li>Provide AI-powered nutritional estimates, voice transcription, and coaching recommendations via our &quot;Coach&quot; and &quot;Ledger Analyst&quot; features.</li>
        </ul>
        <p className="mt-4 font-semibold">
          We do not sell your personal or health data to third parties, and we never use your data for third-party advertising.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">4. Data Sharing and Security</h2>
        <p>
          We use industry-standard encryption in transit (HTTPS/TLS) and at rest. Your data is stored and processed using Google Cloud / Firebase infrastructure and Google Gemini AI models strictly to provide the application&apos;s core functionality. Payment processing on the web is handled directly by Stripe; we never store raw credit card numbers on our servers.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">5. Google API Disclosure</h2>
        <p>
          the CFO&apos;s use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Google API Services User Data Policy</a>, including the Limited Use requirements.
        </p>
      </section>

      <section id="account-deletion" className="mb-10 p-6 rounded-2xl border bg-muted/20">
        <h2 className="text-xl font-bold mb-4">6. Account &amp; Data Deletion</h2>
        <p>
          You can permanently delete your CFO Fitness account and all associated personal, nutrition, workout, and coaching data at any time:
        </p>
        <ul className="list-disc pl-6 space-y-2 mt-4">
          <li>
            <strong>In-App Instant Deletion (iOS, Android &amp; Web):</strong> Open the app, navigate to the <strong>Settings (Portfolio Management)</strong> tab, scroll to the <strong>Account &amp; Data Deletion</strong> section at the bottom, and tap <strong>Delete Account</strong>. Your Firebase Authentication record and all Firestore documents (<code>/users/&#123;uid&#125;</code>, daily logs, chat history, and preferences) are permanently and immediately erased.
          </li>
          <li>
            <strong>Deletion via Web / Email Request:</strong> If you no longer have the app installed, email <a href="mailto:nicholas.switzer@gmail.com?subject=Delete%20My%20CFO%20Fitness%20Account" className="text-blue-600 hover:underline">nicholas.switzer@gmail.com</a> from the email address associated with your account (or provide your Portfolio UID) with the subject line <em>&quot;Delete My CFO Fitness Account&quot;</em>. Complete deletion is processed within 48 hours.
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">7. Contact Us</h2>
        <p>
          If you have any questions about this policy or your data, please contact the developer at <a href="mailto:nicholas.switzer@gmail.com" className="text-blue-600 hover:underline">nicholas.switzer@gmail.com</a>.
        </p>
      </section>

      <footer className="mt-12 pt-8 border-t text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">← Back to Dashboard</Link>
      </footer>
    </div>
  );
}
