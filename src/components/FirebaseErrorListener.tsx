'use client';

import { useState, useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { ShieldAlert, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { rebootTerminal } from '@/lib/reboot';

/**
 * An overlay listener that catches globally emitted 'permission-error' events.
 * Instead of throwing and crashing the React tree, it displays a themed
 * CFO System Exception recovery dialog, giving the user a clean escape hatch.
 */
export function FirebaseErrorListener() {
  const [error, setError] = useState<FirestorePermissionError | null>(null);

  useEffect(() => {
    const handleError = (err: FirestorePermissionError) => {
      setError(err);
    };

    errorEmitter.on('permission-error', handleError);

    return () => {
      errorEmitter.off('permission-error', handleError);
    };
  }, []);

  const handleReboot = () => {
    rebootTerminal();
  };

  const handleDismiss = () => {
    setError(null);
  };

  if (!error) {
    return null;
  }

  // Extract failed request details if available
  const pathName = error.request?.path?.split('/').pop() || 'Unknown';
  const operation = error.request?.method || 'Access';

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-card border border-destructive/20 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
        {/* Header Alert */}
        <div className="bg-destructive/10 border-b border-destructive/20 p-5 flex items-center gap-3 text-destructive">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[12px] font-black uppercase tracking-widest italic leading-none">Ledger Access Suspended</h2>
            <p className="text-[10px] font-bold text-destructive/70 uppercase tracking-widest mt-1">Security Exception Detected</p>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            The CFO terminal encountered a database access exception while attempting to sync ledger data. This may be due to an expired session or temporary server rules synchronization.
          </p>

          <div className="bg-muted/50 border rounded-xl p-4.5 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Audit Log Details</p>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-bold">
              <div className="bg-background/60 p-2 rounded-lg border">
                <span className="text-[9px] font-bold text-muted-foreground block uppercase">Asset ledger</span>
                <span className="text-foreground font-mono truncate block capitalize">{pathName}</span>
              </div>
              <div className="bg-background/60 p-2 rounded-lg border">
                <span className="text-[9px] font-bold text-muted-foreground block uppercase">Operation</span>
                <span className="text-foreground font-mono block uppercase">{operation}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="border-t p-4 px-6 flex justify-end gap-3 bg-muted/20">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground h-9"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            Dismiss
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
