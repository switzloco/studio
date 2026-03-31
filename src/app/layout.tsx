import type {Metadata} from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { ServiceWorkerRegister } from '@/components/sw-register';
import pkg from '../../package.json';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'CFO Fitness | Chief Fitness Officer',
  description: 'Manage your body like a high-stakes financial portfolio.',
  manifest: '/manifest.json',
  themeColor: '#3F51B5',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'CFO Fitness',
  },
  icons: {
    icon: [
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <head />
      <body className="font-body antialiased bg-background text-foreground min-h-screen flex flex-col">
        <FirebaseClientProvider>
          {children}
        </FirebaseClientProvider>
        <Toaster />
        <ServiceWorkerRegister />
        <footer className="w-full text-center text-xs text-muted-foreground py-4 mt-auto border-t">
          v{pkg.version}{process.env.NEXT_PUBLIC_PR_NUMBER ? ` | PR #${process.env.NEXT_PUBLIC_PR_NUMBER}` : ''}
        </footer>
      </body>
    </html>
  );
}
