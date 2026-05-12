import React from 'react';

export const metadata = {
  title: 'Privacy Policy | CFO Fitness',
  description: 'Privacy policy for the CFO Fitness application.',
};

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 prose prose-stone">
      <h1 className="text-3xl font-black uppercase tracking-tighter mb-8">Privacy Policy</h1>
      
      <p className="text-muted-foreground mb-8">Effective Date: May 12, 2026</p>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">1. Introduction</h2>
        <p>
          Welcome to <strong>The CFO (Chief Fitness Officer)</strong>. We are committed to protecting your personal information and your right to privacy. This Privacy Policy explains how we collect, use, and protect your data when you use our application.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">2. Data We Collect</h2>
        <p>
          To provide fitness tracking and analysis, we request access to health data from third-party providers such as Fitbit and Google Health. This includes:
        </p>
        <ul className="list-disc pl-6 space-y-2 mt-4">
          <li>Activity data (steps, calories, distance)</li>
          <li>Sleep duration and patterns</li>
          <li>Heart rate variability (HRV) and resting heart rate</li>
          <li>User profile information (name, email)</li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">3. How We Use Your Data</h2>
        <p>
          Your data is used exclusively to:
        </p>
        <ul className="list-disc pl-6 space-y-2 mt-4">
          <li>Sync and display your fitness metrics in your dashboard.</li>
          <li>Provide AI-powered analysis and recommendations via our "Coach" feature.</li>
          <li>Help you manage your fitness like a "financial portfolio."</li>
        </ul>
        <p className="mt-4 font-semibold">
          We do not sell your personal data to third parties.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">4. Data Sharing and Security</h2>
        <p>
          We use industry-standard security measures to protect your data. Your health data is processed using Google Cloud/Firebase infrastructure and AI models. We only share data with service providers (like LLM providers) necessary to provide the application's core functionality.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">5. Google API Disclosure</h2>
        <p>
          The CFO's use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Google API Services User Data Policy</a>, including the Limited Use requirements.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">6. Contact Us</h2>
        <p>
          If you have any questions about this policy, please contact the developer at <a href="mailto:nicholas.switzer@gmail.com" className="text-blue-600 hover:underline">nicholas.switzer@gmail.com</a>.
        </p>
      </section>

      <footer className="mt-12 pt-8 border-t text-sm text-muted-foreground">
        <a href="/" className="hover:text-foreground">← Back to Dashboard</a>
      </footer>
    </div>
  );
}
