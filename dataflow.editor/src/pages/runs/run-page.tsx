import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { ChevronLeft, CircleX, History, LoaderCircle, TriangleAlert, Workflow } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { flowPath, runInHistoryPath, runPath, RUNS_PATH } from '@/app/paths';
import type { RunView } from '@/data/flows/flows-api';
import { shortId } from '@/data/runs/run-history';
import { useRun } from '@/data/runs/use-run';
import { formatDateTime } from '@/lib/format';
import { firstTab, RUN_TABS, RunDetails, RunUsageText, type RunTab } from '@/pages/flow-editor/run-panel';
import { duration, StatusIcon, StatusPill, TRIGGER_LABEL } from './run-status';

/**
 * A run's own page (/runs/:runId?tab=): its errors, the lines its components wrote, their metrics and the envelopes
 * they saw, live while it goes on, with the flows it called and waited for inside, for whoever looks at the run (the
 * observability's logs are for who runs the platform). The runs it queued (fire and forget) are runs of their own:
 * each one a link to its own page, as is the run that queued it.
 */
export function RunPage() {
  const { runId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { state } = useRun(runId);

  if (state.status === 'loading') {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <BackToRuns />
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <TriangleAlert className="size-4" />
          {state.error.code === 'not-found' || state.error.code === 'validation' ? `No run with the id ${runId}.` : `Could not read the run: ${state.error.message}`}
        </p>
      </div>
    );
  }

  const run = state.value;
  const record = run.record;
  const asked = params.get('tab') as RunTab | null;
  const tab = asked && RUN_TABS.includes(asked) ? asked : firstTab(record);
  const setTab = (next: RunTab) => setParams({ tab: next }, { replace: true });
  const failure = record && 'error' in record && record.error ? record.error : undefined;
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <Header run={run} />
      <Family run={run} />
      {failure && run.status !== 'cancelled' && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 break-words whitespace-pre-wrap">{failure}</span>
        </p>
      )}
      <section aria-label="Run result" className="min-h-[24rem] flex-1 overflow-hidden rounded-lg border bg-card">
        {record ? (
          <RunDetails record={record} tab={tab} onTab={setTab} />
        ) : (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Waiting for a free worker: nothing yet.
          </p>
        )}
      </section>
    </div>
  );
}

/** the old address of a run's log (/runs/:runId/logs): its page, on Logs */
export function OldRunLogsUrl() {
  const { runId = '' } = useParams();
  return <Navigate to={runPath(runId, 'logs')} replace />;
}

function BackToRuns() {
  return (
    <Link to={RUNS_PATH} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-4" /> Runs
    </Link>
  );
}

/** the run's flow, status, trigger, when it started, how long it took and what its worker used */
function Header({ run }: { run: RunView }) {
  const record = run.record;
  const took = record?.durationMs;
  const name = run.flowName ?? record?.run.flow ?? 'Run';
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <BackToRuns />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="truncate text-xl font-semibold">{name}</h1>
          <StatusPill status={run.status} />
        </div>
        <p className="mt-0.5 flex flex-wrap gap-x-1 text-xs text-muted-foreground">
          <span className="font-mono">{run.id}</span>
          {run.trigger && <span>· {TRIGGER_LABEL[run.trigger]}</span>}
          {run.startedAt ? <span>· started {formatDateTime(new Date(run.startedAt))}</span> : run.queuedAt && <span>· queued {formatDateTime(new Date(run.queuedAt))}</span>}
          {took !== undefined && (
            <span className="font-mono">
              · {duration(took)}
              {run.status === 'running' ? ' so far' : ''}
            </span>
          )}
        </p>
        {record && run.status !== 'running' && run.status !== 'queued' && (
          <p className="mt-0.5">
            <RunUsageText usage={run.usage} record={record} />
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link to={runInHistoryPath(run.id)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <History /> In history
        </Link>
        {run.projectId && (
          <Link to={flowPath(run.projectId, run.flowId)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Workflow /> Open flow
          </Link>
        )}
      </div>
    </header>
  );
}

/** the run that queued this one and the runs this one queued (fire and forget), each a link to its own page */
function Family({ run }: { run: RunView }) {
  const queued = run.calledRuns ?? [];
  if (!run.parentId && queued.length === 0) return null;
  return (
    <nav aria-label="Related runs" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      {run.parentId && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          Queued by
          <Link to={runPath(run.parentId)} className="font-mono text-foreground hover:underline">
            {shortId(run.parentId)}
          </Link>
          {run.rootId && run.rootId !== run.parentId && (
            <>
              · top
              <Link to={runPath(run.rootId)} className="font-mono text-foreground hover:underline">
                {shortId(run.rootId)}
              </Link>
            </>
          )}
        </span>
      )}
      {queued.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
          Queued {queued.length} run{queued.length === 1 ? '' : 's'}:
          {queued.map(r => (
            <Link
              key={r.id}
              to={runPath(r.id)}
              title={`${r.flow} · ${r.status}${r.error ? `: ${r.error}` : ''}`}
              className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-foreground hover:bg-accent"
            >
              <StatusIcon status={r.status} className="size-3" />
              {shortId(r.id)}
            </Link>
          ))}
        </span>
      )}
    </nav>
  );
}
