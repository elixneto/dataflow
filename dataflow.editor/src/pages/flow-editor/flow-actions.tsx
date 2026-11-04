import { useState } from 'react';
import { Download, LoaderCircle, Play, Upload, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useServerConnection, type ServerConnection } from '@/lib/server-connection';

const DISCONNECTED = 'Server disconnected';

/**
 * The flow's actions in the top bar. Run is a test run (components that write outside the flow do not write),
 * Run for real writes; Download gives the flow as a YAML file, Upload will read one. Run, Run for real and Upload only
 * show that they were pressed: they come with the runner and the saved definition. While the server does not answer
 * all four are disabled.
 */
export function FlowActions({ onDownload }: { onDownload?: () => void }) {
  return <FlowActionsView connection={useServerConnection()} onDownload={onDownload} />;
}

/** the actions for a given server state (what FlowActions shows; apart so it can be checked without a server) */
export function FlowActionsView({ connection, onDownload }: { connection: ServerConnection; onDownload?: () => void }) {
  const [started, setRunning] = useState<'test' | 'real' | null>(null);
  const online = connection.state === 'online';
  // the server went away during a run: it is not running anymore
  const running = online ? started : null;
  const run = (kind: 'test' | 'real') => {
    setRunning(kind);
    setTimeout(() => setRunning(null), 1200);
  };

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" aria-label="Download" title={online ? 'Download the flow (YAML)' : DISCONNECTED} disabled={!onDownload || !online} onClick={onDownload}>
        <Download />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Upload" title={online ? 'Upload a flow' : DISCONNECTED} disabled={!online}>
        <Upload />
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={running !== null || !online}
        title={online ? 'Run for real: components that write outside the flow do write' : DISCONNECTED}
        onClick={() => run('real')}
      >
        {running === 'real' ? <LoaderCircle className="animate-spin" /> : <Zap />} Run for real
      </Button>
      <Button
        size="sm"
        disabled={running !== null || !online}
        title={online ? 'Test run: components that write outside the flow do not write' : DISCONNECTED}
        onClick={() => run('test')}
      >
        {running === 'test' ? <LoaderCircle className="animate-spin" /> : <Play />} Run
      </Button>
    </div>
  );
}
