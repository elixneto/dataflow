import { Download, LoaderCircle, Play, Upload, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useServerConnection, type ServerConnection } from '@/lib/server-connection';

const DISCONNECTED = 'Server disconnected';

/**
 * The flow's actions in the top bar. Run is a test run (components that write outside the flow do not write),
 * Run for real writes; Download gives the flow as a YAML file; Upload (soon) will read one. Run and Run for real make up
 * a mock result for now: they come with the runner. While the server does not answer
 * all four are disabled.
 */
export function FlowActions(props: { onDownload?: () => void; running?: 'test' | 'real' | null; onRun?: (kind: 'test' | 'real') => void }) {
  return <FlowActionsView connection={useServerConnection()} {...props} />;
}

/** the actions for a given server state (what FlowActions shows; apart so it can be checked without a server) */
export function FlowActionsView(props: { connection: ServerConnection; onDownload?: () => void; running?: 'test' | 'real' | null; onRun?: (kind: 'test' | 'real') => void }) {
  const { connection, onDownload, onRun } = props;
  const online = connection.state === 'online';
  const running = props.running ?? null;
  const run = (kind: 'test' | 'real') => onRun?.(kind);

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" aria-label="Download" title={online ? 'Download the flow (YAML)' : DISCONNECTED} disabled={!onDownload || !online} onClick={onDownload}>
        <Download />
      </Button>
      {/* Upload comes later: shown, blocked */}
      <Button variant="ghost" size="icon-sm" aria-label="Upload" title={online ? 'Soon' : DISCONNECTED} disabled>
        <Upload />
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={running !== null || !online || !onRun}
        title={online ? 'Run for real: components that write outside the flow do write' : DISCONNECTED}
        onClick={() => run('real')}
      >
        {running === 'real' ? <LoaderCircle className="animate-spin" /> : <Zap />} Run for real
      </Button>
      <Button
        size="sm"
        disabled={running !== null || !online || !onRun}
        title={online ? 'Test run: components that write outside the flow do not write' : DISCONNECTED}
        onClick={() => run('test')}
      >
        {running === 'test' ? <LoaderCircle className="animate-spin" /> : <Play />} Run
      </Button>
    </div>
  );
}
