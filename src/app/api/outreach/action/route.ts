import { NextRequest, NextResponse } from 'next/server';
import { verifyOutreachToken } from '@/lib/outreach-auth';
import { buildLiveUserOutreach, executeOutreachQuickAction } from '@/lib/outreach-service';
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

async function renderLiveLedgerPage(uid: string, bannerNotice?: string): Promise<string> {
  const { composed, todayFoods, yesterdayFoods, proteinGoal, localDate } =
    await buildLiveUserOutreach({ uid });

  const totalKcal = Math.round(todayFoods.reduce((s, f) => s + (f.calories || 0), 0));
  const totalProtein = Math.round(todayFoods.reduce((s, f) => s + (f.proteinG || 0), 0));
  const totalCarbs = Math.round(todayFoods.reduce((s, f) => s + (f.carbsG || 0), 0));
  const totalFat = Math.round(todayFoods.reduce((s, f) => s + (f.fatG || 0), 0));
  const totalPlants = Math.round(todayFoods.reduce((s, f) => s + (f.plantMassG || 0), 0));

  const proteinPct = Math.min(100, Math.round((totalProtein / Math.max(1, proteinGoal)) * 100));
  const plantPct = Math.min(100, Math.round((totalPlants / 800) * 100));

  const renderFoodRows = (foods: typeof todayFoods, dateIso?: string) => {
    if (foods.length === 0) {
      return `<div style="padding:14px;border-radius:12px;background:#f8fafc;color:#64748b;font-size:13px;">No meals logged for this day.</div>`;
    }
    return foods
      .map((f, idx) => {
        const undoUrl =
          f.id && dateIso
            ? buildOutreachActionUrl({
                uid,
                action: 'undo_food',
                date: dateIso,
                foodId: f.id,
              })
            : null;
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:8px;background:#ffffff;">
          <div style="min-width:0;flex:1;">
            <div style="font-size:13px;font-weight:800;color:#0f172a;">#${idx + 1} · ${escapeHtml(f.name)}</div>
            <div style="font-size:12px;color:#475569;margin-top:2px;">
              ${escapeHtml(f.consumedAt || 'Logged')} · <strong>${Math.round(f.calories || 0)} kcal</strong> · <strong>${Math.round(f.proteinG || 0)}g protein</strong> · ${Math.round(f.carbsG || 0)}g C · ${Math.round(f.fatG || 0)}g F${f.plantMassG ? ` · ${Math.round(f.plantMassG)}g plants` : ''}
            </div>
          </div>
          ${
            undoUrl
              ? `<a href="${undoUrl}" style="flex-shrink:0;padding:6px 11px;border-radius:8px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;font-size:11px;font-weight:800;text-decoration:none;">Remove</a>`
              : ''
          }
        </div>`;
      })
      .join('');
  };

  const bannerHtml = bannerNotice
    ? `<div style="background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;padding:10px 14px;border-radius:12px;font-size:13px;font-weight:700;margin-bottom:16px;">${escapeHtml(bannerNotice)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Live Nutrition Ledger — the CFO</title>
  </head>
  <body style="margin:0;padding:20px 14px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
    <div style="max-width:560px;margin:12px auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;padding:24px 20px;box-shadow:0 8px 24px rgba(15,23,42,0.05);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="font-size:11px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#059669;">
          the CFO · Live Personal Ledger
        </div>
        <div style="font-size:11px;font-weight:700;color:#64748b;">${escapeHtml(localDate)}</div>
      </div>

      ${bannerHtml}

      <div style="background:#ecfdf5;border-left:4px solid #10b981;border-radius:12px;padding:14px 16px;margin-bottom:18px;">
        <div style="font-size:16px;font-weight:900;color:#0f172a;margin-bottom:4px;">${escapeHtml(composed.headline)}</div>
        <div style="font-size:13px;color:#334155;line-height:1.5;">${escapeHtml(composed.body)}</div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px;">
        <div style="border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;background:#f8fafc;">
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#64748b;">Protein</div>
          <div style="font-size:16px;font-weight:900;color:#0f172a;margin:2px 0;">${totalProtein}g <span style="font-size:12px;color:#64748b;font-weight:700;">/ ${proteinGoal}g</span></div>
          <div style="height:6px;background:#e2e8f0;border-radius:999px;overflow:hidden;"><div style="height:100%;width:${proteinPct}%;background:#10b981;"></div></div>
        </div>
        <div style="border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;background:#f8fafc;">
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#64748b;">Calories In</div>
          <div style="font-size:16px;font-weight:900;color:#0f172a;margin:2px 0;">${totalKcal} <span style="font-size:12px;color:#64748b;font-weight:700;">kcal</span></div>
          <div style="font-size:10px;color:#64748b;">${totalCarbs}g C · ${totalFat}g F</div>
        </div>
        <div style="border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;background:#f8fafc;">
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#64748b;">Plants (800g)</div>
          <div style="font-size:16px;font-weight:900;color:#0f172a;margin:2px 0;">${totalPlants}g <span style="font-size:12px;color:#64748b;font-weight:700;">/ 800g</span></div>
          <div style="height:6px;background:#e2e8f0;border-radius:999px;overflow:hidden;"><div style="height:100%;width:${plantPct}%;background:#059669;"></div></div>
        </div>
      </div>

      <h2 style="font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.06em;color:#334155;margin:18px 0 8px;">
        Today's Logged Meals (${todayFoods.length})
      </h2>
      ${renderFoodRows(todayFoods, localDate)}

      <h2 style="font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;margin:20px 0 8px;">
        Yesterday's Logged Meals (${yesterdayFoods.length})
      </h2>
      ${renderFoodRows(yesterdayFoods)}

      <div style="margin-top:22px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#64748b;">
        <span>Reply in Discord or Email to add or remove items</span>
        <a href="${SITE_URL}" style="color:#0f172a;font-weight:800;text-decoration:none;">Open Full App →</a>
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
    if (verified.action === 'view_ledger') {
      const html = await renderLiveLedgerPage(verified.uid);
      return new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const result = await executeOutreachQuickAction({
      uid: verified.uid,
      action: verified.action,
      date: verified.date,
      window: verified.window,
      foodId: verified.foodId,
    });

    if (verified.action === 'undo_food') {
      const html = await renderLiveLedgerPage(
        verified.uid,
        'Removed meal entry — your live ledger and Eat-By clock have been updated.',
      );
      return new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

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
