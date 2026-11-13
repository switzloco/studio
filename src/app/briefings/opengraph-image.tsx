import { ImageResponse } from 'next/og';

export const alt = 'the CFO — Free 3x/Day Eat-By Briefings';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0f172a',
          color: '#ffffff',
          padding: '64px 72px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                background: '#10b981',
                color: '#052e16',
                fontWeight: 900,
                fontSize: 22,
                padding: '10px 20px',
                borderRadius: 999,
                letterSpacing: 2,
                textTransform: 'uppercase',
              }}
            >
              FREE · $0 FOREVER · 1-CLICK CANCEL
            </div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, fontStyle: 'italic', color: '#94a3b8' }}>
            cfofitness.app/briefings
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div
            style={{
              fontSize: 66,
              fontWeight: 900,
              lineHeight: 1.06,
              letterSpacing: -1.5,
            }}
          >
            3x/Day &ldquo;Eat-By&rdquo; Briefings via Email or Discord.
          </div>
          <div style={{ fontSize: 28, color: '#cbd5e1', lineHeight: 1.4, maxWidth: 980 }}>
            Morning, Midday &amp; Evening dispatches: know your exact protein window or when you&apos;re good through morning. Reply in plain English to log.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 20 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              background: '#064e3b',
              border: '2px solid #10b981',
              borderRadius: 20,
              padding: '18px 26px',
              flex: 1,
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 800, color: '#6ee7b7', letterSpacing: 1.5 }}>
              7:00 AM MORNING
            </span>
            <span style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>
              Good from yesterday until 12:30 PM
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              background: '#1e293b',
              border: '2px solid #f59e0b',
              borderRadius: 20,
              padding: '18px 26px',
              flex: 1,
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 800, color: '#fcd34d', letterSpacing: 1.5 }}>
              12:00 PM MIDDAY
            </span>
            <span style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>
              Eat ~45g protein by 2:30 PM
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              background: '#1e293b',
              border: '2px solid #38bdf8',
              borderRadius: 20,
              padding: '18px 26px',
              flex: 1,
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 800, color: '#7dd3fc', letterSpacing: 1.5 }}>
              7:00 PM EVENING
            </span>
            <span style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>
              Good through 8:00 AM · Close kitchen
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
