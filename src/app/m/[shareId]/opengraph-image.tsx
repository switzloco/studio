import { ImageResponse } from 'next/og';
import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService as healthService } from '@/lib/health-service-admin';

export const alt = 'Shared meal';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Briefcase SVG path (Lucide icon, scaled for 28×28 viewBox)
const BriefcasePath = () => (
  <svg
    width={32}
    height={32}
    viewBox="0 0 24 24"
    fill="none"
    stroke="white"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0 }}
  >
    <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
);

function MacroPill({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: number;
  unit: string;
  accent: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: accent,
        borderRadius: 16,
        padding: '18px 28px',
        minWidth: 200,
        gap: 6,
      }}
    >
      <span style={{ fontSize: 40, fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>
        {Math.round(value)}{unit}
      </span>
      <span style={{ fontSize: 15, fontWeight: 700, color: '#64748b', letterSpacing: 2, textTransform: 'uppercase' }}>
        {label}
      </span>
    </div>
  );
}

export default async function OgImage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;

  let title = 'Shared meal';
  let attribution = '';
  let totals = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  let itemCount = 1;

  try {
    const db = getAdminFirestore();
    const share = await healthService.getSharedMeal(db, shareId);
    if (share && !share.revoked) {
      title = share.title;
      attribution = share.createdByName ? `${share.createdByName} shared this meal` : 'Shared via the CFO';
      totals = share.totals;
      itemCount = share.items?.length ?? 1;
    }
  } catch {
    /* fall through to defaults */
  }

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          padding: 60,
          justifyContent: 'space-between',
        }}
      >
        {/* Header: wordmark + attribution */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <BriefcasePath />
            <span style={{ color: '#94a3b8', fontSize: 20, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>
              the CFO
            </span>
          </div>
          {attribution ? (
            <span style={{ color: '#64748b', fontSize: 22, fontWeight: 500 }}>
              {attribution}
            </span>
          ) : null}
        </div>

        {/* Meal title */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ color: '#ffffff', fontSize: 64, fontWeight: 900, lineHeight: 1.1, letterSpacing: -1 }}>
            {title}
          </span>
          {itemCount > 1 && (
            <span style={{ color: '#64748b', fontSize: 22, fontWeight: 500 }}>
              {itemCount} items
            </span>
          )}
        </div>

        {/* Macro pills */}
        <div style={{ display: 'flex', gap: 16 }}>
          <MacroPill label="Calories" value={totals.calories} unit="" accent="#fef9c3" />
          <MacroPill label="Protein" value={totals.proteinG} unit="g" accent="#d1fae5" />
          <MacroPill label="Carbs" value={totals.carbsG} unit="g" accent="#fef3c7" />
          <MacroPill label="Fat" value={totals.fatG} unit="g" accent="#fce7f3" />
        </div>

        {/* Footer tagline */}
        <span style={{ color: '#334155', fontSize: 18, fontWeight: 600 }}>
          Track your nutrition like a portfolio · CFO Fitness
        </span>
      </div>
    ),
    {
      ...size,
    },
  );
}
