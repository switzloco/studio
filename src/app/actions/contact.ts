'use server';

import { sendAdminReportEmail } from '@/lib/admin-email';

export async function submitContactForm(data: { name: string; email: string; message: string }) {
  const { name, email, message } = data;
  
  if (!name || !email || !message) {
    return { success: false, error: 'Missing fields' };
  }
  
  const html = `
    <div style="font-family: sans-serif; max-width: 600px;">
      <h2>New Feedback / Contact Form Submission</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <hr />
      <p><strong>Message:</strong></p>
      <p style="white-space: pre-wrap; background: #f8f9fa; padding: 16px; border-radius: 8px;">${message}</p>
    </div>
  `;

  // Send to admin email
  const result = await sendAdminReportEmail(
    'nicholas.switzer@gmail.com',
    `[The CFO] Feedback from ${name}`,
    html
  );

  if (!result.success) {
    console.error('Contact form submission failed:', result.error);
    return { success: false, error: 'Failed to send message' };
  }

  return { success: true };
}
