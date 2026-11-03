import {WifiOff} from 'lucide-react';
import {useConnectionProblem} from '#data/connection';

/** Red wifi icon while the runner is unreachable (the reason in the tooltip); nothing while connected. */
export function ConnectionStatus() {
  const problem = useConnectionProblem();
  if (!problem) return null;
  return (
    <span role="status" title={problem} aria-label={problem} className="flex size-7 items-center justify-center text-destructive">
      <WifiOff className="size-4" aria-hidden="true"/>
    </span>
  );
}
