import type { Metadata } from 'next';
import Link from 'next/link';
import { Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService as healthService } from '@/lib/health-service-admin';
import type { SharedMeal } from '@/lib/food-exercise-types';
import { ShareView, type ShareDTO } from './share-view';

// Shared meals are public, dynamic, and not known at build time.
export const dynamic = 'force-dynamic';

/** Returns the live share if it exists and is still resolvable (not revoked/expired). */
async function loadShare(shareId: string): Promise<SharedMeal | null> {
  const db = getAdminFirestore();
  const share = await healthService.getSharedMeal(db, shareId);
  if (!share || share.revoked) return null;

  // expiresAt is an admin Timestamp when set; null/absent means no expiry.
  const expiresAt = share.expiresAt as { toMillis?: () => number } | null | undefined;
  if (expiresAt?.toMillis && expiresAt.toMillis() < Date.now()) return null;

  return share;
}

function toDTO(share: SharedMeal): ShareDTO {
  return {
    id: share.id,
    title: share.title,
    createdByName: share.createdByName,
    items: share.items ?? [],
    totals: share.totals ?? { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
    logCount: share.logCount ?? 0,
    assessment: share.cfoAssessment,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  const share = await loadShare(shareId).catch(() => null);
  if (!share) return { title: 'Shared meal | the CFO' };

  const t = share.totals;
  const desc = `${Math.round(t.calories)} cal · ${Math.round(t.proteinG)}g protein · ${Math.round(t.carbsG)}g carbs · ${Math.round(t.fatG)}g fat`;
  const title = `${share.createdByName ? `${share.createdByName} shared: ` : ''}${share.title}`;

  return {
    title: `${title} | the CFO`,
    description: desc,
    openGraph: { title, description: desc, type: 'website', siteName: 'the CFO' },
    twitter: { card: 'summary_large_image', title, description: desc },
  };
}

function Unavailable() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <Briefcase className="h-8 w-8 text-muted-foreground" />
      <h1 className="text-lg font-semibold">This shared meal isn&apos;t available</h1>
      <p className="text-sm text-muted-foreground">
        The link may have expired or been revoked by whoever shared it.
      </p>
      <Button asChild>
        <Link href="/">Open the CFO</Link>
      </Button>
    </main>
  );
}

export default async function SharedMealPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const share = await loadShare(shareId);
  if (!share) return <Unavailable />;

  // Best-effort view tracking; never blocks render.
  void healthService.incrementShareViewCount(getAdminFirestore(), shareId);

  return <ShareView share={toDTO(share)} />;
}
