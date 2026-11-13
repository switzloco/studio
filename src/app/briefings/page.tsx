import type { Metadata } from 'next';
import { BriefingsEnrollView } from '@/components/briefings-enroll-view';
import { SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Free 3x/Day Eat-By Briefings | the CFO',
  description:
    'Get free automated Morning, Midday, and Evening "Eat-By" briefings via Email or Discord. $0 forever, plain-English reply logging, 1-click cancel.',
  openGraph: {
    title: 'Free 3x/Day "Eat-By" Briefings · the CFO',
    description:
      'Morning, Midday & Evening nutrition clocks via Email or Discord. Always $0, reply in plain English to log, 1-click cancel.',
    url: `${SITE_URL}/briefings`,
    siteName: 'the CFO',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Free 3x/Day "Eat-By" Briefings · the CFO',
    description:
      'Morning, Midday & Evening nutrition clocks via Email or Discord. Always $0, 1-click cancel.',
  },
};

export default function BriefingsPage() {
  return <BriefingsEnrollView />;
}
