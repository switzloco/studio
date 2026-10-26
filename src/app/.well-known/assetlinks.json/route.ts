import { NextResponse } from 'next/server';

const UPLOAD_KEY_SHA256 =
  '16:C7:70:36:0D:20:AF:06:30:17:6F:91:B6:88:2D:BB:1C:D2:B7:E7:BC:9B:1C:B1:A5:19:2F:BE:EC:8B:B7:9C';

export async function GET() {
  const fingerprints = [UPLOAD_KEY_SHA256];
  if (
    process.env.ANDROID_APP_SIGNING_SHA256 &&
    !fingerprints.includes(process.env.ANDROID_APP_SIGNING_SHA256.trim())
  ) {
    fingerprints.push(process.env.ANDROID_APP_SIGNING_SHA256.trim());
  }

  const assetLinks = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'app.cfofitness',
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];

  return NextResponse.json(assetLinks, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
  });
}
