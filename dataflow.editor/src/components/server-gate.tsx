import type { ReactNode } from 'react';
import { LoaderCircle, WifiOff } from 'lucide-react';
import { useServerConnection, type ServerConnection } from '@/lib/server-connection';

/**
 * A screen that must not change while the server is away (the flow editor saves as it goes): blurred and blocked
 * (inert: no clicks, no keys) while the server does not answer, back by itself when it does.
 */
export function ServerGate({ children }: { children: ReactNode }) {
  const connection = useServerConnection();
  return <ServerGateView connection={connection}>{children}</ServerGateView>;
}

/** the gate for a given state (what ServerGate shows; apart so it can be checked without a server) */
export function ServerGateView({ connection, children }: { connection: ServerConnection; children: ReactNode }) {
  const offline = connection.state === 'offline';
  return (
    <div className="relative h-full w-full">
      <div inert={offline} aria-hidden={offline || undefined} className={offline ? 'h-full w-full blur-[2px] grayscale-[30%] transition-[filter]' : 'h-full w-full'}>
        {children}
      </div>
      {offline && <ServerDisconnectedOverlay />}
    </div>
  );
}

export function ServerDisconnectedOverlay() {
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="server-disconnected" className="absolute inset-0 z-50 flex items-center justify-center bg-background/40">
      <div className="flex w-80 flex-col items-center gap-3 rounded-xl border bg-card p-6 text-center shadow-lg">
        <WifiOff className="size-6 text-destructive" aria-hidden />
        <h2 id="server-disconnected" className="text-base font-semibold">
          Server disconnected
        </h2>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          Reconnecting…
        </p>
      </div>
    </div>
  );
}
