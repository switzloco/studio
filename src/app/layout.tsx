import type {Metadata, Viewport} from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { ServiceWorkerRegister } from '@/components/sw-register';
import { AddToHomePrompt } from '@/components/add-to-home-prompt';
import Link from 'next/link';
import pkg from '../../package.json';
import { SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'the CFO | Chief Fitness Officer',
  description: 'Manage your body like a high-stakes financial portfolio.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'the CFO',
  },
  icons: {
    icon: [
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  verification: {
    google: 'googlee89a7536a417e453',
  },
};

export const viewport: Viewport = {
  themeColor: '#3F51B5',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body antialiased bg-background text-foreground min-h-screen flex flex-col">
        <FirebaseClientProvider>
          {children}
        </FirebaseClientProvider>
        <Toaster />
        <ServiceWorkerRegister />
        <AddToHomePrompt />
        <footer className="w-full text-center text-[10px] text-muted-foreground py-4 mt-auto border-t flex flex-col gap-1 items-center">
          <p>v {process.env.NEXT_PUBLIC_PR_NUMBER || pkg.version}</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
            <span>•</span>
            <Link href="/terms" className="hover:underline">Terms of Service</Link>
            <span>•</span>
            <a href="mailto:nicholas.switzer@gmail.com" className="hover:underline">Support</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
