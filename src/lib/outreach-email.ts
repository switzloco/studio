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

  const preheaderText = `${composed.lastFoodLine} What else did you have? Reply in plain English or attach a photo.`;
  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:16px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f8fafc;">
      ${escapeHtml(preheaderText)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
    </div>
    <div style="max-width:540px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <span style="font-size:11px;font-weight:800;letter-spacing:0.12em;color:${palette.pill};text-transform:uppercase;">
          the CFO · ${windowLabels[composed.window]}
        </span>
      </div>

      ${bannerHtml}

      <div style="background:${palette.bg};border-left:4px solid ${palette.border};border-radius:10px;padding:16px;margin-bottom:14px;">
        <div style="font-size:19px;font-weight:800;line-height:1.3;color:#0f172a;margin-bottom:8px;">
          ${escapeHtml(composed.headline)}
        </div>
        <div style="font-size:14px;line-height:1.55;color:#334155;">
          ${escapeHtml(composed.body)}
        </div>
      </div>

      <div style="font-size:13px;line-height:1.55;color:#0f172a;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:14px;">
        <strong>${escapeHtml(composed.lastFoodLine)}</strong><br/>
        <span style="color:#334155;"><strong>What else did you have?</strong> Just hit <strong>Reply</strong> in plain English — or <strong>attach a meal or label photo</strong> — and I&apos;ll put it on the books.</span>
      </div>

      <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:14px;">
        ${escapeHtml(composed.metricsLine)}
      </div>

      <div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:6px;">
          Or 1-Tap Quick Update
        </div>
        ${actionButtonsHtml}
      </div>

      <div style="font-size:12px;color:#64748b;line-height:1.5;border-top:1px solid #f1f5f9;padding-top:12px;">
        <a href="${buildOutreachActionUrl({ uid, action: 'view_ledger' })}" style="color:#059669;font-weight:700;text-decoration:underline;">View Live Personal Ledger</a>
        &nbsp;·&nbsp;
        <a href="${SITE_URL}" style="color:#2563eb;text-decoration:underline;">cfofitness.app</a>
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
    composed.lastFoodLine,
    'What else did you have? Reply in plain English or attach a meal / nutrition-label photo.',
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
 * Sends a direct, lightweight conversational agent reply email (threaded via In-Reply-To
 * when replying to an inbound email) stating what was logged, the updated Eat-By call,
 * the last food on record, and reminding the user they can reply with text or photos.
 */
export async function sendOutreachReplyConfirmationEmail(params: {
  to: string;
  uid: string;
  subject: string;
  headline: string;
  detail: string;
  agentReply?: string;
  lastFoodLine?: string;
  inReplyToMessageId?: string;
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

  const loggedLeadHtml = params.loggedMacros
    ? `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.55;color:#0f172a;">
         <strong>${escapeHtml(params.headline)}</strong>
         <span style="color:#059669;font-weight:700;"> (+${params.loggedMacros.calories} kcal &middot; ${params.loggedMacros.proteinG}g P &middot; ${params.loggedMacros.carbsG}g C &middot; ${params.loggedMacros.fatG}g F)</span>.${params.agentReply ? ` ${escapeHtml(params.agentReply)}` : ''}
       </p>`
    : `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.55;color:#0f172a;">
         ${escapeHtml(params.agentReply || params.detail)}
       </p>`;

  const eatByParagraphHtml =
    params.updatedHeadline && params.updatedBody
      ? `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.55;color:#1e293b;">
           <strong>Next up: ${escapeHtml(params.updatedHeadline)}</strong> — ${escapeHtml(params.updatedBody)}${params.metricsLine ? `<br/><span style="font-size:12px;color:#64748b;">(${escapeHtml(params.metricsLine)})</span>` : ''}
         </p>`
      : '';

  const promptParagraphHtml = params.lastFoodLine
    ? `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.55;color:#0f172a;background:#f8fafc;border-left:3px solid #0f172a;padding:10px 12px;border-radius:6px;">
         <strong>${escapeHtml(params.lastFoodLine)}</strong><br/>
         What else did you have? Reply here in plain English — or attach a meal photo / nutrition label pic anytime.
       </p>`
    : '';

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:14px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:540px;">
      ${loggedLeadHtml}
      ${eatByParagraphHtml}
      ${promptParagraphHtml}
      <p style="margin:14px 0 0 0;padding-top:10px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;line-height:1.6;">
        ${undoUrl ? `<a href="${undoUrl}" style="color:#b91c1c;font-weight:700;text-decoration:underline;">Undo this entry</a> &middot; ` : ''}<a href="${SITE_URL}" style="color:#2563eb;text-decoration:underline;">Open CFO Ledger</a> &middot; <a href="${pause7dUrl}" style="color:#64748b;text-decoration:underline;">Pause 7d</a> &middot; <a href="${unsubscribeUrl}" style="color:#dc2626;text-decoration:underline;">1-Click Cancel</a>
      </p>
    </div>
  </body>
</html>`;

  const textLines = [
    params.loggedMacros
      ? `${params.headline} (+${params.loggedMacros.calories} kcal · ${params.loggedMacros.proteinG}g P · ${params.loggedMacros.carbsG}g C · ${params.loggedMacros.fatG}g F).${params.agentReply ? ` ${params.agentReply}` : ''}`
      : params.agentReply || params.detail,
    ...(params.updatedHeadline && params.updatedBody
      ? [
          '',
          `Next up: ${params.updatedHeadline} — ${params.updatedBody}`,
          ...(params.metricsLine ? [`(${params.metricsLine})`] : []),
        ]
      : []),
    ...(params.lastFoodLine
      ? [
          '',
          params.lastFoodLine,
          'What else did you have? Reply in plain English or attach a meal / nutrition-label photo anytime.',
        ]
      : []),
    '',
    ...(undoUrl ? [`Undo this entry: ${undoUrl}`] : []),
    `Open CFO Ledger: ${SITE_URL}`,
    `1-Click Cancel: ${unsubscribeUrl}`,
  ];

  const headers: Record<string, string> = {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
  if (params.inReplyToMessageId) {
    headers['In-Reply-To'] = params.inReplyToMessageId;
    headers['References'] = params.inReplyToMessageId;
  }

  const res = await deliverRawOutreachEmail({
    to: params.to,
    subject: params.subject,
    html,
    text: textLines.join('\n'),
    headers,
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
  recipientFirstName?: string;
}): { subject: string; html: string; text: string; unsubscribeUrl: string } {
  const { uid, cadence, timezone, composed, recipientFirstName } = params;
  const cleanFirstName = recipientFirstName?.trim();
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
  const viewLedgerUrl = buildOutreachActionUrl({ uid, action: 'view_ledger' });
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

  const subject = cleanFirstName
    ? `Welcome aboard, ${cleanFirstName}! Your CFO Briefing · ${composed.headline}`
    : `Welcome to the CFO Briefing · ${composed.headline}`;
  const greetingTitle = cleanFirstName
    ? `Welcome aboard, ${cleanFirstName} — your automated "Eat-By" clock is live ($0).`
    : `Your automated "Eat-By" clock is live ($0).`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:16px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:0.12em;color:#059669;text-transform:uppercase;margin-bottom:8px;">
        the CFO · WELCOME &amp; FIRST LIVE BRIEFING
      </div>
      <div style="font-size:21px;font-weight:900;line-height:1.25;color:#0f172a;margin-bottom:8px;">
        ${escapeHtml(greetingTitle)}
      </div>
      <div style="font-size:14px;line-height:1.55;color:#334155;margin-bottom:14px;">
        No app or login required — everything works right inside your inbox. Briefings arrive at <strong>${escapeHtml(scheduleSummary)}</strong> answering one question: <strong>what your body is mostly burning right now (fat, carbs, or muscle) and when to eat next.</strong>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin-bottom:18px;font-size:13px;line-height:1.55;color:#334155;">
        <div style="font-weight:800;color:#0f172a;margin-bottom:4px;">How it works in 10 seconds:</div>
        1. <strong>Just hit Reply</strong> in plain English whenever you eat (e.g. <em>&ldquo;3 eggs, sourdough toast, and coffee at 9am&rdquo;</em>) or attach a meal / nutrition-label photo.<br/>
        2. <strong>Ask or adjust anytime</strong> — reply with <em>&ldquo;remove the toast&rdquo;</em>, <em>&ldquo;ping me at 8am EST&rdquo;</em>, or <em>&ldquo;morning only&rdquo;</em> and the CFO updates on the spot.<br/>
        3. <strong>Zero-login web ledger</strong> — tap <a href="${viewLedgerUrl}" style="color:#059669;font-weight:700;text-decoration:underline;">View Live Personal Ledger</a> anytime to see your itemized meals or remove an entry in one tap.
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

      <div style="font-size:13px;line-height:1.55;color:#0f172a;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:14px;">
        <strong>${escapeHtml(composed.lastFoodLine)}</strong><br/>
        <span style="color:#334155;"><strong>What else did you have?</strong> Hit <strong>Reply</strong> in plain English (e.g. <em>&ldquo;3 eggs and sourdough toast&rdquo;</em>) — or <strong>attach a meal or nutrition-label photo</strong> — and I&apos;ll update your clock automatically.</span>
      </div>

      <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:14px;">
        ${escapeHtml(composed.metricsLine)}
      </div>

      <div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:6px;">
          Or 1-Tap Quick Update
        </div>
        ${actionButtonsHtml}
      </div>

      <div style="font-size:12px;color:#475569;line-height:1.55;border-top:1px solid #f1f5f9;padding-top:12px;">
        <a href="${viewLedgerUrl}" style="color:#059669;font-weight:700;text-decoration:underline;">View Live Personal Ledger</a>
        &nbsp;·&nbsp;
        Optional visual dashboard &amp; wearables at <a href="${SITE_URL}" style="color:#2563eb;text-decoration:underline;">cfofitness.app</a>
      </div>

      <div style="margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;line-height:1.6;">
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
    cleanFirstName
      ? `WELCOME ABOARD, ${cleanFirstName.toUpperCase()} — THE CFO DAILY BRIEFING ($0)`
      : 'WELCOME TO THE CFO DAILY BRIEFING ($0)',
    `Schedule: ${scheduleSummary}`,
    '',
    'How it works in 10 seconds:',
    '1. Just hit Reply in plain English whenever you eat (or attach a meal/label photo).',
    '2. Ask or adjust anytime ("remove the toast", "ping me at 8am", "morning only").',
    `3. View your live personal ledger (no login required): ${viewLedgerUrl}`,
    '',
    '--- RIGHT NOW: YOUR LIVE STATUS ---',
    composed.headline,
    composed.body,
    '',
    composed.lastFoodLine,
    'What have you had so far today? Hit Reply in plain English — or attach a meal or nutrition-label photo — and I will update your clock automatically.',
    '',
    composed.metricsLine,
    '',
    'Quick Actions:',
    ...composed.quickActions.map(
      (btn) => `- ${btn.label}: ${buildOutreachActionUrl({ uid, action: btn.action, date: composed.localDate, window: composed.window })}`,
    ),
    '',
    `View Live Personal Ledger: ${viewLedgerUrl}`,
    `Optional dashboard & wearables (Google Health, Oura, Withings): ${SITE_URL}`,
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
  recipientFirstName?: string;
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
