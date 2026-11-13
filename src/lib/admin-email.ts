import { deliverRawOutreachEmail } from './outreach-email';

export async function sendAdminReportEmail(to: string, subject: string, html: string) {
  const res = await deliverRawOutreachEmail({
    to,
    subject,
    html,
  });

  if (!res.success) {
    console.warn('[AdminEmail] Email not sent:', res.error);
    return { success: false, error: res.error };
  }

  return { success: true, data: { provider: res.provider } };
}
