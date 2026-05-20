'use client';

import { useEffect } from 'react';
import { ShieldAlert, RefreshCw, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { rebootTerminal } from '@/lib/reboot';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to console for debugging
    console.error('CFO Terminal Route Error:', error);
  }, [error]);

  const handleReboot = () => {
    rebootTerminal();
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md bg-card border border-destructive/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-destructive/10 border-b border-destructive/20 p-5 flex items-center gap-3 text-destructive">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <div>
            <h2 className="text-[12px] font-black uppercase tracking-widest italic leading-none">Terminal Interruption</h2>
            <p className="text-[10px] font-bold text-destructive/70 uppercase tracking-widest mt-1">Component Crash Caught</p>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            The application layout encountered an unexpected rendering error. You can attempt to restore your current session, or reboot the terminal to clear state.
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
            Restore Session
            <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
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
    </div>
  );
}
