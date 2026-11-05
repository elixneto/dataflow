import { Ban, CircleAlert, CircleCheck, CircleX, Clock, LoaderCircle, type LucideIcon } from 'lucide-react';
import type { RunStatus, RunTrigger } from '@/data/runs/run-history';
import { cn } from '@/lib/utils';

/** how each status looks: the same icons and colors as the editor's run panel */
export const STATUS: Record<RunStatus, { label: string; icon: LucideIcon; color: string; pill: string }> = {
  queued: { label: 'Queued', icon: Clock, color: 'text-muted-foreground', pill: 'bg-muted text-muted-foreground' },
  running: { label: 'Running', icon: LoaderCircle, color: 'text-sky-600 dark:text-sky-400', pill: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  completed: { label: 'Completed', icon: CircleCheck, color: 'text-emerald-600 dark:text-emerald-400', pill: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  'with-warnings': { label: 'With warnings', icon: CircleAlert, color: 'text-amber-600 dark:text-amber-400', pill: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  'with-errors': { label: 'With errors', icon: CircleX, color: 'text-destructive', pill: 'bg-destructive/15 text-destructive' },
  failed: { label: 'Failed', icon: CircleX, color: 'text-destructive', pill: 'bg-destructive/15 text-destructive' },
  cancelled: { label: 'Cancelled', icon: Ban, color: 'text-muted-foreground', pill: 'bg-muted text-muted-foreground' },
};

export const TRIGGER_LABEL: Record<RunTrigger, string> = {
  manual: 'Run for real',
  schedule: 'Schedule',
  webhook: 'Webhook',
  api: 'API',
  'flow-invoker': 'Fire and forget',
};

export function StatusIcon({ status, className }: { status: RunStatus; className?: string }) {
  const s = STATUS[status];
  return <s.icon className={cn('size-4 shrink-0', s.color, status === 'running' && 'animate-spin', className)} aria-label={s.label} />;
}

/** the status as a pill: icon and name */
export function StatusPill({ status, className }: { status: RunStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', s.pill, className)}>
      <s.icon className={cn('size-3', status === 'running' && 'animate-spin')} aria-hidden />
      {s.label}
    </span>
  );
}

/** 850 ms, 12 s, 2 min 5 s, 1 h 4 min */
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** "340 → 340", "1,250 → …" while it goes on, "—" before it starts */
export function envelopes(run: { envelopesIn?: number; envelopesOut?: number }): string {
  if (run.envelopesIn === undefined) return '—';
  const n = (v: number) => v.toLocaleString('en-US');
  return `${n(run.envelopesIn)} → ${run.envelopesOut === undefined ? '…' : n(run.envelopesOut)}`;
}
