import { NextResponse } from 'next/server';

// Apple requires this served with application/json, no redirects, over HTTPS.
// Team ID N7DBYV74D4 (Nick Switzer) — from developer.apple.com/account → Membership.
const AASA = {
  applinks: {
    apps: [],
    details: [
      {
        appIDs: ['N7DBYV74D4.app.cfofitness'],
        components: [
          { '/': '/m/*', comment: 'Meal share deep links' },
          { '/': '/incoming-share*', comment: 'OS share sheet target' },
        ],
      },
    ],
  },
  webcredentials: {
    apps: ['N7DBYV74D4.app.cfofitness'],
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
