'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/firebase/admin';
import { sendAdminReportEmail } from '@/lib/admin-email';

export async function submitContactForm(data: {
  name: string;
  email: string;
  message: string;
  uid?: string;
  context?: string;
}) {
  const name = (data.name || 'Partner').trim().slice(0, 100);
  const email = (data.email || 'anonymous@cfofitness.app').trim().slice(0, 150);
  const message = (data.message || '').trim().slice(0, 3000);

  if (!message) {
    return { success: false, error: 'Please enter a message.' };
  }

  // 1. Always persist feedback in Firestore (`feedback` collection) first so not a single
  //    note from a friend, family member, or customer is ever lost even if email is offline.
  try {
    const db = getAdminFirestore();
    await db.collection('feedback').add({
      name,
      email,
      message,
      uid: data.uid || null,
      context: data.context || null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (dbErr) {
    console.error('[submitContactForm] Failed to save feedback to Firestore:', dbErr);
  }

  // 2. Also email Nick directly when RESEND_API_KEY is configured
  const html = `
    <div style="font-family: sans-serif; max-width: 600px;">
      <h2>New CFO Fitness Feedback / Note</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email / Contact:</strong> ${email}</p>
      ${data.uid ? `<p><strong>Portfolio UID:</strong> <code>${data.uid}</code></p>` : ''}
      ${data.context ? `<p><strong>Context:</strong> ${data.context}</p>` : ''}
      <hr />
      <p><strong>Message:</strong></p>
      <p style="white-space: pre-wrap; background: #f8f9fa; padding: 16px; border-radius: 8px;">${message}</p>
    </div>
  `;

  await sendAdminReportEmail(
    'nicholas.switzer@gmail.com',
    `[the CFO] Note from ${name} (${email})`,
    html,
  ).catch((err) => {
    console.warn('[submitContactForm] Email delivery skipped/failed (saved to Firestore):', err);
  });

  return { success: true };
}
