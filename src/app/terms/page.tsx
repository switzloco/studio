import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service | the CFO',
  description: 'Terms of service for the the CFO application.',
};

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 prose prose-stone">
      <h1 className="text-3xl font-black uppercase tracking-tighter mb-8">Terms of Service</h1>
      
      <p className="text-muted-foreground mb-8">Last Updated: May 12, 2026</p>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">1. Acceptance of Terms</h2>
        <p>
          By accessing or using <strong>the CFO (Chief Fitness Officer)</strong>, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the application.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4 text-red-600">2. Medical Disclaimer</h2>
        <p className="font-bold">
          the CFO is a data analysis tool and is NOT a medical device.
        </p>
        <p className="mt-2">
          The information, including but not limited to, text, graphics, images and other material contained in this app are for informational purposes only. No material on this site is intended to be a substitute for professional medical advice, diagnosis or treatment. Always seek the advice of your physician or other qualified health care provider with any questions you may have regarding a medical condition or treatment.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">3. User Data and Accounts</h2>
        <p>
          You are responsible for maintaining the confidentiality of your account credentials. You agree to provide accurate data from your third-party health providers (Fitbit, Google Health). We reserve the right to terminate accounts that violate our security policies or attempt to misuse the application.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">4. Limitation of Liability</h2>
        <p>
          the CFO and its developers shall not be held liable for any health issues, injuries, or data loss resulting from the use of the application. The application provides AI-generated insights which should be verified by a professional before making any significant lifestyle changes.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">5. Modifications to Service</h2>
        <p>
          We reserve the right to modify or discontinue, temporarily or permanently, the service with or without notice. As this application is under active development (including the migration to Google Health API), features may change frequently.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-bold mb-4">6. Contact Information</h2>
        <p>
          For any questions regarding these terms, please contact us at <a href="mailto:nicholas.switzer@gmail.com" className="text-blue-600 hover:underline">nicholas.switzer@gmail.com</a>.
        </p>
      </section>

      <footer className="mt-12 pt-8 border-t text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">← Back to Dashboard</Link>
      </footer>
    </div>
  );
}
