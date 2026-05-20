'use client';

import { useEffect } from 'react';
import { ShieldAlert, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import './globals.css';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error for debugging
    console.error('CFO Terminal Global Layout Error:', error);
  }, [error]);

  const handleReboot = () => {
    try {
      sessionStorage.clear();
      sessionStorage.setItem('cfo_activeTab', 'chat');
    } catch (e) {
      console.error('[CFO Reboot] Failed to clear session:', e);
    }
    window.location.reload();
  };

  return (
    <html lang="en">
      <body className="font-sans antialiased bg-background text-foreground min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-card border border-destructive/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
          {/* Header */}
          <div className="bg-destructive/10 border-b border-destructive/20 p-5 flex items-center gap-3 text-destructive">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <div>
              <h2 className="text-[12px] font-black uppercase tracking-widest italic leading-none">System Lockdown</h2>
              <p className="text-[10px] font-bold text-destructive/70 uppercase tracking-widest mt-1">Global Layout Exception</p>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              The CFO core systems encountered a critical layout-level exception. A terminal reboot is recommended to restore operations and clear corrupted states.
            </p>

            {error.message && (
              <div className="bg-muted/50 border rounded-xl p-4.5 space-y-1.5 font-mono text-[10px] text-muted-foreground overflow-x-auto">
                <p className="font-bold text-[9px] uppercase tracking-widest text-muted-foreground/80 mb-1">Diagnostic Output</p>
                <p className="text-destructive/80 font-semibold">{error.name || 'Error'}: {error.message}</p>
                {error.digest && <p className="text-[9px] mt-1 opacity-70">Digest: {error.digest}</p>}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="border-t p-4 px-6 flex justify-end gap-3 bg-muted/20">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => reset()}
              className="text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground h-9"
            >
              Reset Layout
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleReboot}
              className="text-[10px] font-black uppercase tracking-widest h-9 bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin-reverse" />
              Reboot Terminal
            </Button>
          </div>
        </div>
      </body>
    </html>
  );
}
