import { NextResponse } from 'next/server';

// Fill in SHA256 fingerprint from Play Console → Setup → App signing
// after the first AAB upload.
const ASSET_LINKS = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'app.cfofitness',
      sha256_cert_fingerprints: [
        'REPLACE_WITH_SHA256_FROM_PLAY_CONSOLE_APP_SIGNING',
      ],
    },
  },
];

export async function GET() {
  return NextResponse.json(ASSET_LINKS, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
  });
}
