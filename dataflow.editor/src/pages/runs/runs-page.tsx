import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronRight, History, Layers, LoaderCircle, RotateCw, Search, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { RUNS_PATH } from '@/app/paths';
import { cancelRun } from '@/data/flows/flows-api';
import { listProjects } from '@/data/projects/projects-api';
import { useRunNumbers, useRunPage } from '@/data/runs/use-runs';
import { descendants, findIn, isOpen, rootOf, RUN_PERIOD_LABEL, runTree, type RunFilter, type RunPeriod, type RunTrigger } from '@/data/runs/run-history';
import { useResource } from '@/data/use-resource';
import { cn } from '@/lib/utils';
import { RunList } from './run-list';
import { RunOverview } from './run-overview';
import { duration, StatusIcon, TRIGGER_LABEL } from './run-status';


const SELECT = 'h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/30';

/** the statuses the strip above the list filters by */
const STRIP: RunFilter['status'][] = ['all', 'running', 'queued', 'problems', 'completed'];

/** the period the page looks at when the URL names none */
const DEFAULT_PERIOD: RunPeriod = '24h';
/** its short form, beside the numbers */
const PERIOD_HINT: Record<RunPeriod, string> = { '24h': 'last 24 h', '7d': 'last 7 days' };

/** the filter from the URL (?status=&project=&trigger=&q=&period=), so a reload or a link keeps it */
function filterOf(params: URLSearchParams): RunFilter & { period: RunPeriod } {
  const status = params.get('status') as RunFilter['status'] | null;
  const trigger = params.get('trigger') as RunFilter['trigger'] | null;
  const period = params.get('period') as RunPeriod | null;
  return {
    status: status && STRIP.includes(status) ? status : 'all',
    projectId: params.get('project') ?? '',
    trigger: trigger && trigger in TRIGGER_LABEL ? trigger : 'all',
    search: params.get('q') ?? '',
    period: period && period in RUN_PERIOD_LABEL ? period : DEFAULT_PERIOD,
  };
}

/** the search waits this long after the last key before it asks the server (Enter asks at once) */
const SEARCH_DELAY_MS = 400;

/** the search as a run id, or its start (8 hex digits or more): then the run with it is the one chosen */
export function idSearch(search: string): string | undefined {
  const value = search.trim().toLowerCase();
  return /^[0-9a-f]{8}(-[0-9a-f]{0,4}){0,4}[0-9a-f]*$/.test(value) ? value : undefined;
}

/**
 * The time now: a second at a time while something goes on (the durations of the runs still going count up), every
 * 15 s otherwise ("2 minutes ago" moves on), and again whenever the list changes (a run that just came is "now", never
 * "in 1 minute")
 */
function useNow(ticking: boolean, changed: unknown) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), ticking ? 1000 : 15_000);
    return () => clearInterval(timer);
  }, [ticking, changed]);
  return now;
}

/**
 * The organization's runs for real (/runs): Run for real, schedules, webhooks, the API, and the runs a Flow Invoker
 * queued (fire and forget, a run per batch). Test runs stay in the editor. On the left the top runs (the server
 * filters and pages them), each with a bar of the runs it queued; on the right the chosen one's tree: its numbers, a
 * timeline of every run of it and its problems, each run with its own status. Live follows the organization's run
 * changes (SSE) and asks again what changed. A link to a run is /runs?q=<its id>: the list shows only its tree, that
 * run chosen (or nothing, when there is no such run).
 */
export function RunsPage() {
  const [params, setParams] = useSearchParams();
  const filter = filterOf(params);
  const [live, setLive] = useState(true);
  // a run's id in the search (a link to a run) finds it however old it is
  const page = useRunPage(idSearch(filter.search) ? { ...filter, period: undefined } : filter, live);
  const numbersState = useRunNumbers(live, filter.period);
  const hint = PERIOD_HINT[filter.period];
  const projects = useResource('projects:active', () => listProjects('active'));
  const runs = page.value?.runs ?? [];
  const treeSizes = page.value?.treeSizes ?? {};
  const now = useNow(runs.some(r => isOpen(r.status)), runs);
  const refresh = () => {
    page.refresh();
    numbersState.refresh();
  };

  const shown = useMemo(() => runTree(runs), [runs]);
  const numbers = numbersState.state.status === 'ready' ? numbersState.state.value : { all: 0, running: 0, inFlight: 0, queued: 0, oldestWaitMs: 0, problems: 0, completed: 0 };

  // the run chosen with a click; else the one whose id the search names (a run under a top run too); else the first
  const [chosen, setChosen] = useState<string | null>(null);
  const searched = idSearch(filter.search);
  const pick = (id: string | null | undefined) => (id ? rootOf(shown, id) : undefined);
  const byId = searched ? shown.flatMap(r => [r, ...descendants(r)]).find(r => r.id.startsWith(searched))?.id : undefined;
  const selectedId = (chosen && pick(chosen) ? chosen : undefined) ?? byId ?? shown[0]?.id;
  const root = pick(selectedId);
  const selected = root && selectedId ? findIn(root, selectedId) : undefined;
  const treeSize = root ? (treeSizes[root.id] ?? 0) : 0;

  // the search box: typed here, in the URL (and asked of the server) once typing stops, or on Enter
  const [search, setSearch] = useState(filter.search);
  useEffect(() => setSearch(filter.search), [filter.search]);
  useEffect(() => {
    if (search === filter.search) return;
    const timer = setTimeout(() => applySearch(search), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  });

  const set = (changes: Record<string, string | undefined>, replace = false) => {
    setChosen(null);
    setParams(
      current => {
        const next = new URLSearchParams(current);
        // the old way to link a run: its id goes to the search now
        next.delete('run');
        for (const [key, value] of Object.entries(changes)) {
          if (value === undefined || value === '' || value === 'all' || (key === 'period' && value === DEFAULT_PERIOD)) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace },
    );
  };
  function applySearch(value: string) {
    if (value.trim() !== filter.search.trim()) set({ q: value.trim() }, true);
  }
  const select = (id: string) => setChosen(id);
  // Stop one or several runs, then the lists again (the first failure, if any, goes back to the dialog)
  const stop = async (ids: string[]) => {
    const results = await Promise.all(ids.map(id => cancelRun(id)));
    refresh();
    return results.find(r => !r.ok) ?? results[0]!;
  };

  // an old link (?run=id): its id in the search
  const legacy = params.get('run');
  useEffect(() => {
    if (legacy) set({ q: legacy }, true);
  }, [legacy]);

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          <Link to={RUNS_PATH} className="hover:text-foreground">
            Runs
          </Link>
          {root && (
            <>
              <ChevronRight className="size-3.5 shrink-0" />
              <button type="button" onClick={() => select(root.id)} className={cn('truncate hover:text-foreground', selected === root && 'text-foreground')}>
                {root.flowName}
              </button>
            </>
          )}
          {selected && root && selected !== root && (
            <>
              <ChevronRight className="size-3.5 shrink-0" />
              <span className="truncate text-foreground">{selected.flowName}</span>
            </>
          )}
        </nav>
        <div className="flex items-center gap-2">
          <select aria-label="Period" title="The numbers and the runs listed: the ones of this period" className={SELECT} value={filter.period} onChange={event => set({ period: event.target.value })}>
            {(Object.keys(RUN_PERIOD_LABEL) as RunPeriod[]).map(p => (
              <option key={p} value={p}>
                {RUN_PERIOD_LABEL[p]}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" aria-pressed={live} onClick={() => setLive(l => !l)} title={live ? 'Live: the runs change here as they go (a click pauses)' : 'Paused (a click goes live)'}>
            <span className={cn('size-1.5 rounded-full', live ? 'animate-pulse bg-emerald-500' : 'bg-muted-foreground')} aria-hidden />
            {live ? 'Live' : 'Paused'}
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Refresh" title="Refresh" onClick={refresh}>
            <RotateCw />
          </Button>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
      </div>

      <div role="tablist" aria-label="Status" className="grid overflow-hidden rounded-xl border bg-card sm:grid-cols-3 lg:grid-cols-5">
        <StripTab active={filter.status === 'all'} onClick={() => set({ status: 'all' })} icon={<Layers className="size-3.5" />} label="All runs" count={numbers.all} hint={hint} />
        <StripTab
          active={filter.status === 'running'}
          onClick={() => set({ status: 'running' })}
          icon={<StatusIcon status="running" className="size-3.5" />}
          label="Running now"
          count={numbers.running}
          hint={numbers.running ? `${numbers.inFlight.toLocaleString('en-US')} envelope${numbers.inFlight === 1 ? '' : 's'} in flight` : 'none'}
        />
        <StripTab
          active={filter.status === 'queued'}
          onClick={() => set({ status: 'queued' })}
          icon={<StatusIcon status="queued" className="size-3.5" />}
          label="Waiting for a worker"
          count={numbers.queued}
          hint={numbers.queued ? `oldest ${duration(numbers.oldestWaitMs)}` : 'none'}
        />
        <StripTab
          active={filter.status === 'problems'}
          onClick={() => set({ status: 'problems' })}
          icon={<StatusIcon status="failed" className="size-3.5" />}
          label="Problems"
          count={numbers.problems}
          hint={hint}
          alert={numbers.problems > 0}
        />
        <StripTab active={filter.status === 'completed'} onClick={() => set({ status: 'completed' })} icon={<StatusIcon status="completed" className="size-3.5" />} label="Completed" count={numbers.completed} hint={hint} />
      </div>

      {!page.value && page.state.status === 'loading' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(22rem,2fr)_3fr]" aria-busy="true">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      )}

      {!page.value && page.state.status === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-12 text-center">
          <TriangleAlert className="size-8 text-destructive" />
          <p className="text-sm text-muted-foreground">{page.state.error.message}</p>
          <Button variant="outline" onClick={refresh}>
            <RotateCw /> Try again
          </Button>
        </div>
      )}

      {page.value && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(22rem,2fr)_3fr]">
          <section aria-label="Run list" aria-busy={page.loading} className="min-w-0 overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <form
                role="search"
                className="relative min-w-40 flex-1"
                onSubmit={event => {
                  event.preventDefault();
                  applySearch(search);
                }}
              >
                {page.loading ? (
                  <LoaderCircle className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                ) : (
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                )}
                <Input aria-label="Search" placeholder="Run id or flow" className="h-8 pl-8" value={search} onChange={event => setSearch(event.target.value)} />
              </form>
              <select aria-label="Project" className={SELECT} value={filter.projectId} onChange={event => set({ project: event.target.value })}>
                <option value="">All projects</option>
                {(projects.state.status === 'ready' ? projects.state.value : []).map(project => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <select aria-label="Trigger" className={SELECT} value={filter.trigger} onChange={event => set({ trigger: event.target.value })}>
                <option value="all">Any trigger</option>
                {(Object.keys(TRIGGER_LABEL) as RunTrigger[]).map(t => (
                  <option key={t} value={t}>
                    {TRIGGER_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            {shown.length === 0 && !page.loading ? (
              <div className="flex flex-col items-center gap-2 p-12 text-center">
                <History className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {searched && filter.status === 'all' && !filter.projectId && filter.trigger === 'all'
                    ? `No run with the id ${filter.search.trim()}.`
                    : filter.status !== 'all' || filter.projectId || filter.trigger !== 'all' || filter.search
                      ? 'No run fits these filters.'
                      : `No runs in the ${hint}: Run for real in the editor starts one.`}
                </p>
              </div>
            ) : (
              <div className={cn('transition-opacity', page.loading && 'opacity-60')}>
                <RunList roots={shown} treeSizes={treeSizes} hasMore={page.value.next !== null} onMore={() => void page.more()} selected={root?.id} onSelect={select} now={now} />
              </div>
            )}
          </section>

          <section aria-label="Run" className="min-w-0 overflow-hidden rounded-xl border bg-card">
            {root && selected && !(page.loading && shown.length === 0) ? (
              <RunOverview root={root} selected={selected} treeSize={treeSize} onSelect={select} onStop={stop} now={now} />
            ) : (
              <p className="p-12 text-center text-sm text-muted-foreground">Choose a run.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function StripTab(props: { active: boolean; onClick: () => void; icon: ReactNode; label: string; count: number; hint: string; alert?: boolean }) {
  const { active, onClick, icon, label, count, hint, alert } = props;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex flex-col gap-1 border-b-2 px-4 py-3 text-left transition-colors not-last:border-r hover:bg-accent/50',
        active ? 'border-b-foreground' : 'border-b-transparent',
        alert && 'bg-destructive/5 text-destructive',
      )}
    >
      <span className={cn('flex items-center gap-1.5 text-xs', !alert && (active ? 'text-foreground' : 'text-muted-foreground'))}>
        {icon} {label}
      </span>
      <span className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{count}</span>
        <span className={cn('text-xs', alert ? 'text-destructive/80' : 'text-muted-foreground')}>{hint}</span>
      </span>
    </button>
  );
}
