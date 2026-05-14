import { NextRequest, NextResponse } from 'next/server';
import { withingsService } from '@/lib/withings-service';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const userId = searchParams.get('uid');

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId (uid)' }, { status: 400 });
  }

  const authUrl = withingsService.getAuthUrl(userId);
  return NextResponse.redirect(authUrl);
}
