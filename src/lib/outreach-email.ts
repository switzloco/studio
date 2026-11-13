/**
 * @fileOverview Outbound Email formatter & dual-provider (Gmail SMTP / Resend) dispatcher
 * for 3x/day CFO Briefings. Includes RFC 8058 native 1-click List-Unsubscribe headers
 * and stateless HMAC quick-actions.
 */

import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { SITE_URL } from './site';
import { signOutreachToken, type OutreachActionType } from './outreach-auth';
import type { ComposedOutreachMessage } from './outreach-composer';
import type { OutreachCadence } from './health-service';

export interface GmailOutreachConfig {
  user: string;
  appPassword: string;
  plusReplyTo: string;
}

/**
 * Resolves Gmail App Password config if present (automatically stripping spaces
 * from Google's 4x4 `abcd efgh ijkl mnop` display format).
 */
export function resolveGmailOutreachConfig(): GmailOutreachConfig | null {
  const appPassword = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (appPassword.length < 12) return null;
  const user = (process.env.GMAIL_USER || 'nicholas.switzer@gmail.com').trim().toLowerCase();
  const [localPart, domain = 'gmail.com'] = user.split('@');
  const cleanLocal = localPart.replace(/\+.*$/, '');
  const plusReplyTo = `${cleanLocal}+cfo@${domain}`;
  return { user, appPassword, plusReplyTo };
}

export async function deliverRawOutreachEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
}): Promise<{ success: boolean; provider?: 'gmail' | 'resend'; error?: string }> {
  const gmail = resolveGmailOutreachConfig();

  if (gmail) {
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: gmail.user,
          pass: gmail.appPassword,
        },
      });

      await transporter.sendMail({
        from: process.env.OUTREACH_FROM_EMAIL || `the CFO <${gmail.user}>`,
        replyTo: process.env.OUTREACH_REPLY_TO_EMAIL || `the CFO <${gmail.plusReplyTo}>`,
        to: params.to,
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
        ...(params.headers ? { headers: params.headers } : {}),
      });

      return { success: true, provider: 'gmail' };
    } catch (err: any) {
      console.error('[OutreachEmail] Gmail SMTP send error:', err);
      return { success: false, provider: 'gmail', error: err?.message ?? String(err) };
    }
  }

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.OUTREACH_FROM_EMAIL || 'the CFO <reports@updates.thecfo.app>';
    const replyTo = process.env.OUTREACH_REPLY_TO_EMAIL || undefined;

    try {
      const { error } = await resend.emails.send({
        from,
        to: params.to,
        ...(replyTo ? { replyTo } : {}),
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
        ...(params.headers ? { headers: params.headers } : {}),
      });

      if (error) {
        console.error('[OutreachEmail] Resend error:', error);
        return { success: false, provider: 'resend', error: error.message || String(error) };
      }
      return { success: true, provider: 'resend' };
    } catch (err: any) {
      console.error('[OutreachEmail] Unexpected Resend error:', err);
      return { success: false, provider: 'resend', error: err?.message ?? String(err) };
    }
  }

  console.warn('[OutreachEmail] Neither GMAIL_APP_PASSWORD nor RESEND_API_KEY configured — skipping live send.');
  return { success: false, error: 'Neither GMAIL_APP_PASSWORD nor RESEND_API_KEY configured' };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildOutreachActionUrl(params: {
  uid: string;
  action: OutreachActionType;
  date?: string;
  window?: 'morning' | 'midday' | 'night';
  foodId?: string;
}): string {
  const token = signOutreachToken(params);
  return `${SITE_URL}/api/outreach/action?token=${encodeURIComponent(token)}`;
}

export function renderOutreachEmailHtml(params: {
  uid: string;
  cadence: OutreachCadence;
  composed: ComposedOutreachMessage;
}): { html: string; text: string; unsubscribeUrl: string } {
  const { uid, cadence, composed } = params;
  const windowLabels = {
    morning: 'MORNING BRIEFING',
    midday: 'MIDDAY PULSE',
    night: 'EVENING CLOSEOUT',
  } as const;

  const toneColors = {
    good: { bg: '#ecfdf5', border: '#10b981', pill: '#059669', text: '#065f46' },
    soon: { bg: '#fffbeb', border: '#f59e0b', pill: '#d97706', text: '#92400e' },
    urgent: { bg: '#fef2f2', border: '#ef4444', pill: '#dc2626', text: '#991b1b' },
  } as const;
  const palette = toneColors[composed.statusTone];

  const unsubscribeUrl = buildOutreachActionUrl({ uid, action: 'unsubscribe' });
  const pause7dUrl = buildOutreachActionUrl({ uid, action: 'pause_7d', date: composed.localDate });
  const toggleCadenceAction: OutreachActionType =
    cadence === '3x' ? 'morning_only' : 'resume_3x';
  const toggleCadenceLabel =
    cadence === '3x' ? 'Switch to Morning-Only (1x/day)' : 'Resume 3x/Day Pings';
  const toggleCadenceUrl = buildOutreachActionUrl({ uid, action: toggleCadenceAction });

  const actionButtonsHtml = composed.quickActions
    .map((btn) => {
      const url = buildOutreachActionUrl({
        uid,
        action: btn.action,
        date: composed.localDate,
        window: composed.window,
      });
      const isPrimary = btn.style === 'primary';
      const btnStyle = isPrimary
        ? 'background:#0f172a;color:#ffffff;border:1px solid #0f172a;'
        : 'background:#ffffff;color:#0f172a;border:1px solid #cbd5e1;';
      return `<a href="${url}" style="display:inline-block;margin:4px 6px 4px 0;padding:10px 14px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none;${btnStyle}">${escapeHtml(btn.label)}</a>`;
    })
    .join('');

  const bannerHtml = composed.autoSunsetBanner
    ? `<div style="background:#f1f5f9;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#475569;">
         ${escapeHtml(composed.autoSunsetBanner)}
       </div>`
    : '';

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:16px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:540px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <span style="font-size:11px;font-weight:800;letter-spacing:0.12em;color:${palette.pill};text-transform:uppercase;">
          the CFO · ${windowLabels[composed.window]}
        </span>
      </div>

      ${bannerHtml}

      <div style="background:${palette.bg};border-left:4px solid ${palette.border};border-radius:10px;padding:16px;margin-bottom:16px;">
        <div style="font-size:19px;font-weight:800;line-height:1.3;color:#0f172a;margin-bottom:8px;">
          ${escapeHtml(composed.headline)}
        </div>
        <div style="font-size:14px;line-height:1.55;color:#334155;">
          ${escapeHtml(composed.body)}
        </div>
      </div>

      <div style="font-size:12px;font-weight:600;color:#475569;background:#f8fafc;border-radius:8px;padding:10px 12px;margin-bottom:16px;">
        ${escapeHtml(composed.metricsLine)}
      </div>

      <div style="margin-bottom:18px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:6px;">
          1-Tap Quick Update
        </div>
        ${actionButtonsHtml}
      </div>

      <div style="font-size:12px;color:#64748b;line-height:1.5;border-top:1px solid #f1f5f9;padding-top:14px;">
        <strong>Ate something else?</strong> Reply directly to this email in plain English (e.g. <em>"3 eggs and sourdough toast"</em>) or <a href="${SITE_URL}" style="color:#2563eb;text-decoration:underline;">open your full CFO ledger</a>.
      </div>

      <div style="margin-top:18px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;line-height:1.6;">
        Free automated CFO briefings · Always $0, easy to cancel:<br/>
        <a href="${toggleCadenceUrl}" style="color:#64748b;text-decoration:underline;">${escapeHtml(toggleCadenceLabel)}</a>
        &nbsp;·&nbsp;
        <a href="${pause7dUrl}" style="color:#64748b;text-decoration:underline;">Pause 7 Days</a>
        &nbsp;·&nbsp;
        <a href="${unsubscribeUrl}" style="color:#dc2626;font-weight:700;text-decoration:underline;">1-Click Cancel</a>
      </div>
    </div>
  </body>
</html>`;

  const text = [
    `the CFO — ${windowLabels[composed.window]}`,
    '',
    composed.headline,
    composed.body,
    '',
    composed.metricsLine,
    '',
    'Quick Actions:',
    ...composed.quickActions.map(
      (btn) => `- ${btn.label}: ${buildOutreachActionUrl({ uid, action: btn.action, date: composed.localDate, window: composed.window })}`,
    ),
    '',
    `${toggleCadenceLabel}: ${toggleCadenceUrl}`,
    `Pause 7 Days: ${pause7dUrl}`,
    `1-Click Cancel (Instant): ${unsubscribeUrl}`,
  ].join('\n');

  return { html, text, unsubscribeUrl };
}

export async function sendOutreachEmail(params: {
  to: string;
  uid: string;
  cadence: OutreachCadence;
  composed: ComposedOutreachMessage;
}): Promise<{ success: boolean; error?: string }> {
  const { html, text, unsubscribeUrl } = renderOutreachEmailHtml(params);

  return deliverRawOutreachEmail({
    to: params.to,
    subject: params.composed.subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}

/**
 * Sends a short transactional confirmation email (e.g. after inbound reply meal log or stop command).
 */
export async function sendOutreachReplyConfirmationEmail(params: {
  to: string;
  uid: string;
  subject: string;
  headline: string;
  detail: string;
}): Promise<{ success: boolean }> {
  const unsubscribeUrl = buildOutreachActionUrl({ uid: params.uid, action: 'unsubscribe' });

  const res = await deliverRawOutreachEmail({
    to: params.to,
    subject: params.subject,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;padding:16px;color:#0f172a;">
      <div style="font-size:17px;font-weight:800;margin-bottom:6px;">${escapeHtml(params.headline)}</div>
      <div style="font-size:14px;color:#334155;line-height:1.5;">${escapeHtml(params.detail)}</div>
      <div style="margin-top:16px;font-size:11px;color:#94a3b8;">
        <a href="${unsubscribeUrl}" style="color:#dc2626;">1-Click Cancel</a> · <a href="${SITE_URL}" style="color:#64748b;">Open CFO App</a>
      </div>
    </div>`,
    text: `${params.headline}\n\n${params.detail}\n\n1-Click Cancel: ${unsubscribeUrl}`,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });

  return { success: res.success };
}
