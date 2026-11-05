import { descendants, isOpen, isProblem, shortId, statusCounts, type RunNode } from '@/data/runs/run-history';
import { formatDateTime } from '@/lib/format';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import { duration, envelopes, StatusIcon, TRIGGER_LABEL } from './run-status';

/** the color of a run in a segmented bar or the timeline */
export const BAR: Record<RunNode['status'], string> = {
  queued: 'bg-muted-foreground/25',
  running: 'bg-sky-500',
  completed: 'bg-emerald-500',
  'with-warnings': 'bg-amber-500',
  'with-errors': 'bg-red-500',
  failed: 'bg-red-500',
  cancelled: 'bg-muted-foreground/40',
};

/** past this many runs in a tree, its bar has one segment per status (as wide as its count) instead of one per run */
const SEGMENTS = 40;

type Props = {
  roots: RunNode[];
  /** per top run: how many runs its tree has in all (the page may bring fewer) */
  treeSizes: Record<string, number>;
  /** there are older top runs: a button asks for them */
  hasMore: boolean;
  onMore: () => void;
  /** the top run whose tree is open on the right */
  selected?: string;
  onSelect: (id: string) => void;
  now: Date;
};

/**
 * The top runs, newest first: each one with how it went, when, its envelopes and, when it queued runs, a bar with one
 * segment per queued run in its color and what to know about them (still going, failed below); its error when it failed.
 */
export function RunList({ roots, treeSizes, hasMore, onMore, selected, onSelect, now }: Props) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
        <span>Root runs · children are grouped inside</span>
        <span>Duration · Envelopes</span>
      </div>
      <ul aria-label="Runs" className="divide-y">
        {roots.map(root => (
          <li key={root.id}>
            <RunCard run={root} treeSize={treeSizes[root.id] ?? 0} selected={selected === root.id} onSelect={onSelect} now={now} />
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-center gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
        <span>
          Showing {roots.length} root run{roots.length === 1 ? '' : 's'}
          {hasMore ? '' : ' (all)'}
        </span>
        {hasMore && (
          <button type="button" onClick={onMore} className="rounded-md border px-2 py-1 text-foreground hover:bg-accent">
            Load more
          </button>
        )}
      </div>
    </div>
  );
}

function RunCard({ run, treeSize, selected, onSelect, now }: { run: RunNode; treeSize: number; selected: boolean; onSelect: (id: string) => void; now: Date }) {
  const below = descendants(run);
  const total = Math.max(treeSize, below.length);
  const problems = below.filter(r => isProblem(r.status)).length;
  const going = below.filter(r => isOpen(r.status)).length;
  const started = run.startedAt ?? run.queuedAt;
  const took = run.durationMs ?? (run.startedAt ? now.getTime() - run.startedAt.getTime() : undefined);
  const muted = run.status === 'cancelled';
  return (
    <button
      type="button"
      aria-current={selected || undefined}
      onClick={() => onSelect(run.id)}
      className={cn(
        'flex w-full flex-col gap-2 border-l-2 px-4 py-3 text-left transition-colors hover:bg-accent/50',
        selected ? 'border-l-primary bg-accent/40' : 'border-l-transparent',
      )}
    >
      <div className="flex items-start gap-2.5">
        <StatusIcon status={run.status} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className={cn('truncate font-medium', muted && 'text-muted-foreground')}>{run.flowName}</span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {took === undefined ? '—' : duration(took)} · <span className="text-foreground">{envelopes(run)}</span>
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground" title={formatDateTime(started)}>
            {run.projectName} · {TRIGGER_LABEL[run.trigger]}
            {run.startedBy ? ` by ${run.startedBy}` : ''} · {run.status === 'queued' ? `waiting, ${relativeTime(run.queuedAt, now)}` : relativeTime(started, now)} ·{' '}
            <span className="font-mono">{shortId(run.id)}</span>
          </div>
        </div>
      </div>

      {below.length > 0 && (
        <div className="flex items-center gap-3 pl-6.5">
          <div className="flex h-1.5 flex-1 gap-0.5 overflow-hidden rounded-full" aria-label={`${total} queued run(s)`}>
            {below.length <= SEGMENTS
              ? below.map(child => (
                  <span key={child.id} className={cn('h-full flex-1', BAR[child.status], child.status === 'running' && 'animate-pulse')} title={`${child.flowName} · ${child.status}`} />
                ))
              : statusCounts(below).map(({ status, count }) => (
                  <span key={status} className={cn('h-full', BAR[status])} style={{ flexGrow: count }} title={`${count} ${status}`} />
                ))}
          </div>
          <span className={cn('shrink-0 text-xs', problems > 0 ? 'text-destructive' : 'text-muted-foreground')}>
            {problems > 0 ? `${problems} failed below` : going > 0 ? `${going} of ${total} going` : `${total} batch${total === 1 ? '' : 'es'}`}
          </span>
        </div>
      )}

      {run.error && isProblem(run.status) && (
        <p className="ml-6.5 truncate rounded-md bg-destructive/10 px-2 py-1 font-mono text-xs text-destructive">{run.error}</p>
      )}
    </button>
  );
}
