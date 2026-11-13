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
 * Sends a transactional confirmation email (e.g. after an inbound reply meal log or stop command)
 * with macro breakdown, updated live Eat-By runway, and a 1-tap [Undo This Entry] button.
 */
export async function sendOutreachReplyConfirmationEmail(params: {
  to: string;
  uid: string;
  subject: string;
  headline: string;
  detail: string;
  loggedFoodId?: string;
  localDate?: string;
  loggedMacros?: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
  updatedHeadline?: string;
  updatedBody?: string;
  metricsLine?: string;
  statusTone?: 'good' | 'soon' | 'urgent';
}): Promise<{ success: boolean }> {
  const unsubscribeUrl = buildOutreachActionUrl({ uid: params.uid, action: 'unsubscribe' });
  const pause7dUrl = buildOutreachActionUrl({
    uid: params.uid,
    action: 'pause_7d',
    date: params.localDate,
  });

  const undoUrl =
    params.loggedFoodId && params.localDate
      ? buildOutreachActionUrl({
          uid: params.uid,
          action: 'undo_food',
          date: params.localDate,
          foodId: params.loggedFoodId,
        })
      : null;

  const toneColors = {
    good: { bg: '#ecfdf5', border: '#10b981', pill: '#059669' },
    soon: { bg: '#fffbeb', border: '#f59e0b', pill: '#d97706' },
    urgent: { bg: '#fef2f2', border: '#ef4444', pill: '#dc2626' },
  } as const;
  const palette = toneColors[params.statusTone ?? 'good'];

  const macroStripHtml = params.loggedMacros
    ? `<div style="font-size:13px;font-weight:700;color:#065f46;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:9px 12px;margin-bottom:14px;">
         +${params.loggedMacros.calories} kcal &nbsp;&middot;&nbsp; ${params.loggedMacros.proteinG}g protein &nbsp;&middot;&nbsp; ${params.loggedMacros.carbsG}g carbs &nbsp;&middot;&nbsp; ${params.loggedMacros.fatG}g fat
       </div>`
    : '';

  const liveRunwayHtml =
    params.updatedHeadline && params.updatedBody
      ? `<div style="font-size:11px;font-weight:800;letter-spacing:0.1em;color:${palette.pill};text-transform:uppercase;margin-bottom:6px;">
           Updated Live Status
         </div>
         <div style="background:${palette.bg};border-left:4px solid ${palette.border};border-radius:10px;padding:14px 16px;margin-bottom:12px;">
           <div style="font-size:17px;font-weight:800;line-height:1.3;color:#0f172a;margin-bottom:5px;">
             ${escapeHtml(params.updatedHeadline)}
           </div>
           <div style="font-size:14px;line-height:1.5;color:#334155;">
             ${escapeHtml(params.updatedBody)}
           </div>
         </div>`
      : `<div style="font-size:14px;color:#334155;line-height:1.5;margin-bottom:12px;">${escapeHtml(params.detail)}</div>`;

  const metricsHtml = params.metricsLine
    ? `<div style="font-size:12px;font-weight:600;color:#475569;background:#f8fafc;border-radius:8px;padding:10px 12px;margin-bottom:14px;">
         ${escapeHtml(params.metricsLine)}
       </div>`
    : '';

  const actionsRowHtml = undoUrl
    ? `<div style="margin-bottom:16px;">
         <a href="${undoUrl}" style="display:inline-block;margin:4px 8px 4px 0;padding:9px 14px;border-radius:10px;font-size:12px;font-weight:700;text-decoration:none;background:#ffffff;color:#b91c1c;border:1px solid #fecaca;">Undo This Entry</a>
         <a href="${SITE_URL}" style="display:inline-block;margin:4px 0;padding:9px 14px;border-radius:10px;font-size:12px;font-weight:700;text-decoration:none;background:#0f172a;color:#ffffff;border:1px solid #0f172a;">Open CFO Ledger</a>
       </div>`
    : '';

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:16px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:540px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:22px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:0.12em;color:#059669;text-transform:uppercase;margin-bottom:6px;">
        the CFO &middot; LEDGER UPDATED
      </div>
      <div style="font-size:19px;font-weight:800;line-height:1.3;color:#0f172a;margin-bottom:10px;">
        ${escapeHtml(params.headline)}
      </div>
      ${macroStripHtml}
      ${liveRunwayHtml}
      ${metricsHtml}
      ${actionsRowHtml}
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;line-height:1.6;">
        Reply again anytime to log another item &middot; <a href="${pause7dUrl}" style="color:#64748b;text-decoration:underline;">Pause 7 Days</a> &middot; <a href="${unsubscribeUrl}" style="color:#dc2626;font-weight:700;text-decoration:underline;">1-Click Cancel</a>
      </div>
    </div>
  </body>
</html>`;

  const textLines = [
    `the CFO — ${params.headline}`,
    ...(params.loggedMacros
      ? [
          `+${params.loggedMacros.calories} kcal · ${params.loggedMacros.proteinG}g protein · ${params.loggedMacros.carbsG}g carbs · ${params.loggedMacros.fatG}g fat`,
        ]
      : []),
    '',
    params.updatedHeadline && params.updatedBody
      ? `${params.updatedHeadline}\n${params.updatedBody}`
      : params.detail,
    ...(params.metricsLine ? ['', params.metricsLine] : []),
    ...(undoUrl ? ['', `Undo This Entry: ${undoUrl}`] : []),
    `Open CFO Ledger: ${SITE_URL}`,
    `1-Click Cancel: ${unsubscribeUrl}`,
  ];

  const res = await deliverRawOutreachEmail({
    to: params.to,
    subject: params.subject,
    html,
    text: textLines.join('\n'),
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });

  return { success: res.success };
}

/**
 * Renders the Welcome & How-It-Works enrollment email combined with the user's
 * first live Eat-By briefing so new enrollees immediately understand the system.
 */
export function renderOutreachWelcomeEmailHtml(params: {
  uid: string;
  cadence: OutreachCadence;
  timezone: string;
  morningHour?: number;
  middayHour?: number;
  nightHour?: number;
  composed: ComposedOutreachMessage;
}): { subject: string; html: string; text: string; unsubscribeUrl: string } {
  const { uid, cadence, timezone, composed } = params;
  const fmtHour = (h: number) => {
    const clean = ((h % 24) + 24) % 24;
    if (clean === 0) return '12:00 AM';
    if (clean === 12) return '12:00 PM';
    return clean < 12 ? `${clean}:00 AM` : `${clean - 12}:00 PM`;
  };
  const mLabel = fmtHour(params.morningHour ?? 7);
  const dLabel = fmtHour(params.middayHour ?? 12);
  const nLabel = fmtHour(params.nightHour ?? 19);
  const scheduleSummary =
    cadence === '3x'
      ? `${mLabel}, ${dLabel}, and ${nLabel} (${timezone})`
      : `${mLabel} daily (${timezone})`;

  const toneColors = {
    good: { bg: '#ecfdf5', border: '#10b981', pill: '#059669' },
    soon: { bg: '#fffbeb', border: '#f59e0b', pill: '#d97706' },
    urgent: { bg: '#fef2f2', border: '#ef4444', pill: '#dc2626' },
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

  const subject = `Welcome to the CFO Briefing · ${composed.headline}`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:16px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:0.12em;color:#059669;text-transform:uppercase;margin-bottom:8px;">
        the CFO · WELCOME &amp; FIRST LIVE BRIEFING
      </div>
      <div style="font-size:21px;font-weight:900;line-height:1.25;color:#0f172a;margin-bottom:8px;">
        Your automated &ldquo;Eat-By&rdquo; clock is live ($0).
      </div>
      <div style="font-size:14px;line-height:1.55;color:#334155;margin-bottom:18px;">
        Instead of obsessing over another food-tracking app, you&apos;ll get short briefings at <strong>${escapeHtml(scheduleSummary)}</strong> answering one question: <strong>when to eat next — or whether you&apos;re already good.</strong>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:18px;">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#475569;margin-bottom:8px;">
          How to Use This in 5 Seconds
        </div>
        <div style="font-size:13px;line-height:1.6;color:#1e293b;">
          <strong>1. Tap a 1-click button below</strong> to log common protein pulses, same breakfast, or fasting status.<br/>
          <strong>2. Or just hit Reply in plain English</strong> (e.g. <em>&ldquo;3 eggs and sourdough toast&rdquo;</em> or <em>&ldquo;45g grilled chicken salad&rdquo;</em>) and I&apos;ll update your clock automatically.<br/>
          <strong>3. Optional visual dashboard &amp; wearables:</strong> Sign in anytime at <a href="${SITE_URL}" style="color:#2563eb;text-decoration:underline;">cfofitness.app</a> with this email to sync Google Health, Fitbit, Oura, or Withings.
        </div>
      </div>

      <div style="font-size:11px;font-weight:800;letter-spacing:0.1em;color:${palette.pill};text-transform:uppercase;margin-bottom:6px;">
        Right Now · Your Live Status
      </div>
      <div style="background:${palette.bg};border-left:4px solid ${palette.border};border-radius:10px;padding:16px;margin-bottom:14px;">
        <div style="font-size:18px;font-weight:800;line-height:1.3;color:#0f172a;margin-bottom:6px;">
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

      <div style="margin-top:18px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;line-height:1.6;">
        Share with a friend: <a href="${SITE_URL}/briefings" style="color:#2563eb;text-decoration:underline;">cfofitness.app/briefings</a><br/>
        Always $0, zero guilt, easy to adjust or cancel:<br/>
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
    'WELCOME TO THE CFO DAILY BRIEFING ($0)',
    `Schedule: ${scheduleSummary}`,
    '',
    'How to use in 5 seconds:',
    '1) Click any 1-tap preset link below, OR',
    '2) Simply hit Reply in plain English (e.g. "3 eggs and sourdough toast"), OR',
    `3) Open ${SITE_URL} with this email to connect Google Health, Fitbit, Oura, or Withings.`,
    '',
    '--- RIGHT NOW: YOUR LIVE STATUS ---',
    composed.headline,
    composed.body,
    composed.metricsLine,
    '',
    'Quick Actions:',
    ...composed.quickActions.map(
      (btn) => `- ${btn.label}: ${buildOutreachActionUrl({ uid, action: btn.action, date: composed.localDate, window: composed.window })}`,
    ),
    '',
    `Share with a friend: ${SITE_URL}/briefings`,
    `${toggleCadenceLabel}: ${toggleCadenceUrl}`,
    `Pause 7 Days: ${pause7dUrl}`,
    `1-Click Cancel (Instant): ${unsubscribeUrl}`,
  ].join('\n');

  return { subject, html, text, unsubscribeUrl };
}

export async function sendOutreachWelcomeEmail(params: {
  to: string;
  uid: string;
  cadence: OutreachCadence;
  timezone: string;
  morningHour?: number;
  middayHour?: number;
  nightHour?: number;
  composed: ComposedOutreachMessage;
}): Promise<{ success: boolean; error?: string }> {
  const { subject, html, text, unsubscribeUrl } = renderOutreachWelcomeEmailHtml(params);

  return deliverRawOutreachEmail({
    to: params.to,
    subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}
