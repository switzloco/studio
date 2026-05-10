import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendAdminReportEmail(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not configured — email not sent.');
    console.log('--- REPORT CONTENT ---');
    console.log(html);
    return { success: false, error: 'API key missing' };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: 'The CFO <reports@updates.thecfo.app>', // Change to your verified domain later
      to,
      subject,
      html,
    });

    if (error) {
      console.error('Failed to send email:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (err) {
    console.error('Unexpected error sending email:', err);
    return { success: false, error: err };
  }
}
