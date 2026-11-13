import { NextRequest, NextResponse } from 'next/server';
import { verifyOutreachToken } from '@/lib/outreach-auth';
import { executeOutreachQuickAction } from '@/lib/outreach-service';
import { buildOutreachActionUrl } from '@/lib/outreach-email';
import { SITE_URL } from '@/lib/site';

/**
 * @fileOverview Stateless 1-tap Email action & RFC 8058 One-Click Unsubscribe endpoint.
 *
 * - HEAD: no-op 200 (guards against email link prefetchers mutating state)
 * - POST: RFC 8058 `List-Unsubscribe=One-Click` native Gmail/Yahoo unsubscribe
 * - GET:  Executes signed preset / pause / cancel token and renders confirmation HTML
 */

export const dynamic = 'force-dynamic';

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderConfirmationPage(params: {
  title: string;
  detail: string;
  updatedHeadline?: string;
  updatedBody?: string;
  secondaryActionLabel?: string;
  secondaryActionUrl?: string;
  isError?: boolean;
}): string {
  const accent = params.isError ? '#dc2626' : '#059669';
  const runwayCard = params.updatedHeadline
    ? `<div style="background:#ecfdf5;border-left:4px solid #10b981;border-radius:10px;padding:14px 16px;margin:18px 0;text-align:left;">
         <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#059669;margin-bottom:4px;">Updated Live Clock</div>
         <div style="font-size:17px;font-weight:800;color:#0f172a;margin-bottom:4px;">${escapeHtml(params.updatedHeadline)}</div>
         ${params.updatedBody ? `<div style="font-size:13px;color:#334155;line-height:1.5;">${escapeHtml(params.updatedBody)}</div>` : ''}
       </div>`
    : '';

  const secondaryBtn =
    params.secondaryActionLabel && params.secondaryActionUrl
      ? `<a href="${params.secondaryActionUrl}" style="display:inline-block;margin:6px;padding:10px 16px;border-radius:10px;border:1px solid #cbd5e1;color:#334155;font-size:13px;font-weight:700;text-decoration:none;">${escapeHtml(params.secondaryActionLabel)}</a>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(params.title)} — the CFO</title>
  </head>
  <body style="margin:0;padding:24px 16px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
    <div style="max-width:480px;margin:24px auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;padding:28px 24px;text-align:center;box-shadow:0 8px 24px rgba(15,23,42,0.05);">
      <div style="font-size:11px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:${accent};margin-bottom:8px;">
        the CFO · Portfolio Dispatch
      </div>
      <h1 style="font-size:22px;font-weight:900;margin:0 0 10px;">${escapeHtml(params.title)}</h1>
      <p style="font-size:14px;color:#475569;line-height:1.55;margin:0 0 16px;">${escapeHtml(params.detail)}</p>
      ${runwayCard}
      <div style="margin-top:20px;">
        <a href="${SITE_URL}" style="display:inline-block;margin:6px;padding:10px 18px;border-radius:10px;background:#0f172a;color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;">Open CFO App</a>
        ${secondaryBtn}
      </div>
    </div>
  </body>
</html>`;
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const verified = verifyOutreachToken(token);
  if (!verified) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });
  }

  const result = await executeOutreachQuickAction({
    uid: verified.uid,
    action: verified.action,
    date: verified.date,
    window: verified.window,
    foodId: verified.foodId,
  });

  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const verified = verifyOutreachToken(token);

  if (!verified) {
    return new NextResponse(
      renderConfirmationPage({
        title: 'Link Expired or Invalid',
        detail: 'This quick-action link has expired. Open CFO Fitness to update your ledger or preferences.',
        isError: true,
      }),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  try {
    const result = await executeOutreachQuickAction({
      uid: verified.uid,
      action: verified.action,
      date: verified.date,
      window: verified.window,
      foodId: verified.foodId,
    });

    let secondaryActionLabel: string | undefined;
    let secondaryActionUrl: string | undefined;

    if (result.loggedFoodId) {
      secondaryActionLabel = 'Undo Meal Entry';
      secondaryActionUrl = buildOutreachActionUrl({
        uid: verified.uid,
        action: 'undo_food',
        date: verified.date,
        foodId: result.loggedFoodId,
      });
    } else if (verified.action === 'unsubscribe' || verified.action === 'pause_7d') {
      secondaryActionLabel = 'Re-Enable 3x/Day Briefings';
      secondaryActionUrl = buildOutreachActionUrl({
        uid: verified.uid,
        action: 'resume_3x',
      });
    }

    return new NextResponse(
      renderConfirmationPage({
        title: result.title,
        detail: result.detail,
        updatedHeadline: result.updatedHeadline,
        updatedBody: result.updatedBody,
        secondaryActionLabel,
        secondaryActionUrl,
      }),
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  } catch (err: any) {
    console.error('[OutreachAction] Error executing quick action:', err);
    return new NextResponse(
      renderConfirmationPage({
        title: 'Could Not Process Action',
        detail: 'Something went wrong while updating your ledger. Please try again in the app.',
        isError: true,
      }),
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}
