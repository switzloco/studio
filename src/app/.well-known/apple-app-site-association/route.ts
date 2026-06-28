import { NextResponse } from 'next/server';

// Apple requires this served with application/json, no redirects, over HTTPS.
// Fill in TEAMID after Apple Developer enrollment completes (10-char Team ID
// from developer.apple.com/account → Membership).
const AASA = {
  applinks: {
    apps: [],
    details: [
      {
        appIDs: ['TEAMID.app.cfofitness'],
        components: [
          { '/': '/m/*', comment: 'Meal share deep links' },
          { '/': '/incoming-share*', comment: 'OS share sheet target' },
        ],
      },
    ],
  },
  webcredentials: {
    apps: ['TEAMID.app.cfofitness'],
  },
};

export async function GET() {
  return NextResponse.json(AASA, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
  });
}
