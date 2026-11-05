import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Check, ChevronRight, CircleX, Copy, ScrollText, Square, TriangleAlert, Workflow } from 'lucide-react';
import { ConfirmDialog, type ConfirmTarget } from '@/components/confirm-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { flowPath, runPath } from '@/app/paths';
import { descendants, findIn, flatten, isOpen, isProblem, shortId, type RunNode } from '@/data/runs/run-history';
import type { ApiResult } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import { BAR } from './run-list';
import { duration, envelopes, StatusIcon, StatusPill, TRIGGER_LABEL } from './run-status';

type Props = {
  /** the tree open on the right */
  root: RunNode;
  /** the run of it the header is about (the root, or one it queued) */
  selected: RunNode;
  /** how many runs the tree has in all (the server sends the first ones of a big fan-out) */
  treeSize?: number;
  onSelect: (id: string) => void;
  /** Stop these runs (queued: cancelled at once; running: where they are) */
  onStop: (ids: string[]) => Promise<ApiResult<unknown>>;
  now: Date;
};

/**
 * A run's tree on the right: the chosen run (its status, ids, trigger, times, envelopes and batches), the fan-out
 * timeline of the whole tree (each run a bar from when it started to when it ended, or a dashed box while it waits for
 * a worker) and its problems, each one a click away. Stop: the chosen run while it goes on, and the runs it queued that
 * still go on (each is a run of its own: stopping one does not stop the others).
 */
export function RunOverview({ root, selected, treeSize = 0, onSelect, onStop, now }: Props) {
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  const below = descendants(selected);
  const going = below.filter(r => isOpen(r.status));
  const problems = below.filter(r => isProblem(r.status)).length;
  const nested = flatten(selected).filter(r => r.depth > 1).length;
  const took = selected.durationMs ?? (selected.startedAt ? now.getTime() - selected.startedAt.getTime() : undefined);
  const parent = selected.parentId ? findIn(root, selected.parentId) : undefined;
  const stopThis = () =>
    setConfirm({
      title: (
        <>
          Stop <strong className="font-bold">{selected.flowName}</strong>?
        </>
      ),
      description:
        selected.status === 'queued' ? (
          'It has not started: it is cancelled at once and never runs.'
        ) : (
          <>
            It stops at its next step; what it already wrote stays.
            {going.length > 0 && ` The ${going.length} run(s) it queued that still go on are runs of their own: they go on.`}
          </>
        ),
      confirmLabel: 'Stop',
      busyLabel: 'Stopping...',
      destructive: true,
      onConfirm: () => onStop([selected.id]),
    });
  const stopBelow = () =>
    setConfirm({
      title: `Stop ${going.length} run(s) still going?`,
      description: (
        <>
          The runs <strong className="font-bold text-foreground">{selected.flowName}</strong> queued that are waiting or running: those waiting are
          cancelled at once, those running stop at their next step.
        </>
      ),
      confirmLabel: `Stop ${going.length}`,
      busyLabel: 'Stopping...',
      destructive: true,
      onConfirm: () => onStop(going.map(r => r.id)),
    });
  return (
    <div className="flex min-w-0 flex-col">
      {confirm && <ConfirmDialog target={confirm} onClose={() => setConfirm(null)} />}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{selected.flowName}</h2>
            <StatusPill status={selected.status} />
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {selected.projectName} · <CopyId id={selected.id} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isOpen(selected.status) && going.length > 0 && (
            <span className="rounded-md bg-sky-500/10 px-2 py-1 text-xs text-sky-700 dark:text-sky-300">{going.length} still going</span>
          )}
          {problems > 0 && (
            <span className="flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
              <CircleX className="size-3" /> {problems} failed below
            </span>
          )}
          {isOpen(selected.status) && (
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={stopThis}>
              <Square className="fill-current" /> Stop
            </Button>
          )}
          {going.length > 0 && (
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={stopBelow} title="Stop the runs it queued that are waiting or running">
              <Square className="fill-current" /> Stop {going.length} below
            </Button>
          )}
          <Link to={flowPath(selected.projectId, selected.flowId)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Workflow /> Open flow
          </Link>
          <Link to={runPath(selected.id)} title="Its errors, logs, metrics and data" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <ScrollText /> Details
          </Link>
        </div>
      </header>

      <dl className="flex flex-wrap border-b [&>div]:-mr-px [&>div]:-mb-px [&>div]:flex-1 [&>div]:basis-32 [&>div]:border-r [&>div]:border-b">
        {parent ? (
          <Stat label="Queued by">
            <button type="button" onClick={() => onSelect(parent.id)} className="truncate hover:underline">
              {parent.flowName} <span className="font-mono text-muted-foreground">{shortId(parent.id)}</span>
            </button>
          </Stat>
        ) : (
          <Stat label="Trigger">
            {TRIGGER_LABEL[selected.trigger]}
            {selected.startedBy ? ` · ${selected.startedBy}` : ''}
          </Stat>
        )}
        <Stat label="Started" title={selected.startedAt ? formatDateTime(selected.startedAt) : undefined}>
          {selected.startedAt ? relativeTime(selected.startedAt, now) : `waiting, ${relativeTime(selected.queuedAt, now)}`}
        </Stat>
        <Stat label="Duration" mono>
          {took === undefined ? '—' : `${duration(took)}${isOpen(selected.status) ? ' so far' : ''}`}
        </Stat>
        <Stat label="Envelopes" mono>
          {envelopes(selected)}
        </Stat>
        <Stat label="Batches">{below.length ? `${below.length - nested}${nested ? ` · ${nested} nested` : ''}` : '—'}</Stat>
      </dl>

      {selected.error && !isProblem(selected.status) && <p className="mx-4 mt-4 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{selected.error}</p>}

      <Timeline root={root} selected={selected.id} treeSize={treeSize} onSelect={onSelect} now={now} />
      <Problems root={root} onSelect={onSelect} now={now} />
    </div>
  );
}

function Stat({ label, title, mono, children }: { label: string; title?: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3" title={title}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('truncate text-sm', mono && 'font-mono')}>{children}</dd>
    </div>
  );
}

/** the whole id behind its short form, copied on a click */
function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`${id} (copy)`}
      aria-label="Copy the run id"
      onClick={() => {
        void navigator.clipboard?.writeText(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-1 rounded font-mono hover:text-foreground"
    >
      {shortId(id)}
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

/** a step for the time axis that gives about six marks over `span` ms */
function axisStep(span: number): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].map(s => s * 1000);
  return steps.find(step => span / step <= 6) ?? steps[steps.length - 1]!;
}

const axisLabel = (ms: number) => (ms < 60_000 ? `${ms / 1000}s` : ms < 3_600_000 ? `${ms / 60_000}m` : `${ms / 3_600_000}h`);

/**
 * The fan-out timeline: every run of the tree on one time axis that starts when the top run started; a bar from when
 * a run started to when it ended (striped while it runs), a dashed box from when it was queued while it waits.
 */
function Timeline({ root, selected, treeSize, onSelect, now }: { root: RunNode; selected: string; treeSize: number; onSelect: (id: string) => void; now: Date }) {
  const rows = flatten(root);
  const origin = (root.startedAt ?? root.queuedAt).getTime();
  const end = Math.max(...rows.map(({ run }) => (run.finishedAt ?? now).getTime()), origin + 1000);
  const step = axisStep(end - origin);
  const span = Math.ceil((end - origin) / step) * step;
  const marks = Array.from({ length: span / step + 1 }, (_, i) => i * step);
  const at = (t: Date) => `${(Math.max(0, t.getTime() - origin) / span) * 100}%`;
  const width = (from: Date, to: Date) => `${Math.max(0.6, ((to.getTime() - from.getTime()) / span) * 100)}%`;

  return (
    <section className="border-b p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {rows.length > 1 ? 'Fan-out timeline' : 'Timeline'}
          {treeSize > rows.length - 1 && <span className="ml-2 text-xs font-normal text-muted-foreground">the first {rows.length - 1} of {treeSize} runs</span>}
        </h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {(['completed', 'running', 'failed'] as const).map(s => (
            <span key={s} className="flex items-center gap-1">
              <span className={cn('size-2 rounded-sm', BAR[s])} /> {s === 'completed' ? 'Completed' : s === 'running' ? 'Running' : 'Failed'}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm border border-dashed border-muted-foreground" /> Queued
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(9rem,14rem)_1fr_4.5rem] items-center gap-x-3 text-xs">
        <span />
        <div className="relative h-5 text-muted-foreground">
          {marks.map(m => (
            <span key={m} className="absolute -translate-x-1/2 font-mono" style={{ left: `${(m / span) * 100}%` }}>
              {axisLabel(m)}
            </span>
          ))}
        </div>
        <span className="text-right text-muted-foreground">in → out</span>

        {rows.map(({ run, depth }) => {
          const failed = isProblem(run.status);
          const rejected = run.status === 'with-errors' && run.envelopesIn !== undefined && run.envelopesOut !== undefined ? run.envelopesIn - run.envelopesOut : 0;
          const took = run.durationMs ?? (run.startedAt ? now.getTime() - run.startedAt.getTime() : 0);
          return (
            <button
              key={run.id}
              type="button"
              onClick={() => onSelect(run.id)}
              aria-current={run.id === selected || undefined}
              className={cn(
                'col-span-3 grid grid-cols-subgrid items-center rounded-md py-1.5 text-left hover:bg-accent/50',
                failed && 'bg-destructive/5',
                run.id === selected && 'bg-accent ring-1 ring-border',
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: `${depth * 0.9}rem` }}>
                <StatusIcon status={run.status} className="size-3.5" />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{run.flowName}</span>
                  <span className="block truncate text-muted-foreground">
                    <span className="font-mono">{shortId(run.id)}</span>
                    {run.batchSize ? ` · batch of ${run.batchSize}` : ''}
                    {run.status === 'with-errors' ? ' · with errors' : ''}
                  </span>
                </span>
              </span>

              <span className="relative h-5">
                {marks.map(m => (
                  <span key={m} className="absolute inset-y-0 w-px bg-border/60" style={{ left: `${(m / span) * 100}%` }} aria-hidden />
                ))}
                {run.status === 'queued' ? (
                  <span
                    className="absolute inset-y-0.5 flex items-center overflow-hidden rounded border border-dashed border-muted-foreground/60 px-1.5 whitespace-nowrap text-muted-foreground"
                    style={{ left: at(run.queuedAt), width: width(run.queuedAt, now) }}
                  >
                    waiting since {relativeTime(run.queuedAt, now)}
                  </span>
                ) : (
                  run.startedAt && (
                    <span
                      className={cn(
                        'absolute inset-y-0.5 flex items-center overflow-hidden rounded px-1.5 font-mono whitespace-nowrap text-white',
                        BAR[run.status],
                        run.status === 'running' && 'bg-[repeating-linear-gradient(135deg,rgb(14_165_233)_0_8px,rgb(56_189_248)_8px_16px)]',
                        root.id === run.id && rows.length > 1 && 'inset-y-1.5 bg-foreground',
                      )}
                      style={{ left: at(run.startedAt), width: width(run.startedAt, run.finishedAt ?? now) }}
                      title={`${formatDateTime(run.startedAt)} · ${duration(took)}`}
                    >
                      {!(root.id === run.id && rows.length > 1) && `${duration(took)}${run.status === 'running' ? ' · running' : ''}${rejected ? ` · ${rejected} rejected` : ''}`}
                    </span>
                  )
                )}
              </span>

              <span className={cn('text-right font-mono', failed && 'text-destructive')}>{envelopes(run)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** the runs of the tree that failed or ended with errors, the newest first: what went wrong, a click shows the run */
function Problems({ root, onSelect, now }: { root: RunNode; onSelect: (id: string) => void; now: Date }) {
  const problems = flatten(root)
    .map(r => r.run)
    .filter(r => isProblem(r.status))
    .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0));
  if (problems.length === 0) {
    return null;
  }

  return (
    <section className="p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        Problems <span className="rounded-full bg-destructive/10 px-1.5 text-xs text-destructive">{problems.length}</span>
      </h3>
      <ul className="grid gap-2 [&>li]:min-w-0">
        {problems.map(run => (
          <li key={run.id}>
            <button type="button" onClick={() => onSelect(run.id)} className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left hover:bg-accent/50">
              {run.status === 'failed' ? <CircleX className="size-4 shrink-0 text-destructive" /> : <TriangleAlert className="size-4 shrink-0 text-destructive" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {run.flowName} <span className="font-mono text-xs text-muted-foreground">{shortId(run.id)}</span>
                </span>
                {run.error && <span className="block truncate font-mono text-xs text-destructive">{run.error}</span>}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{run.finishedAt ? relativeTime(run.finishedAt, now) : ''}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
