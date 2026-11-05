import {Fragment, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode} from 'react';
import {
    ChevronDown,
    ChevronRight,
    ChevronUp,
    CircleAlert,
    CircleCheck,
    CircleDashed,
    CircleMinus,
    CircleStop,
    CircleX,
    Clock,
    LoaderCircle,
    Pin,
    Power,
    Square,
    X
} from 'lucide-react';
import {
    ERROR_PORT,
    inputPorts,
    type ComponentRun,
    type EnvelopeData,
    type LogLine,
    type RunRecord,
    type SubRun
} from '@dataflow/core';
import {Button} from '@/components/ui/button';
import type {RunUsage} from '@/data/flows/flows-api';
import {componentInfo} from '@/editor/catalog';
import {cn} from '@/lib/utils';
import {readChoice, rememberChoice} from '@/editor/run/run-choices';
import {portLabel} from '@/editor/run/port-label';
import {runActions, type RunAbout} from '@/editor/run/run-marks';
import {
    dataTabComponents,
    dataTabSelection,
    runErrors,
    subRunsOf,
    timelineSpan,
    type RunError,
    type Shown
} from './run-view';
import {JsonTree} from '@/editor/run/json-tree';

/*
 * A run's result under the canvas, live while it runs, as in the PoC (Logs, Metrics, Data), from the core's RunRecord. Its height is
 * dragged by the top edge and kept in this browser tab; it collapses to its header (status, time, envelopes).
 */

type Tab = 'errors' | 'logs' | 'metrics' | 'data';

const HEIGHT_KEY = 'dataflow.runPanel.height';
const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 140;

const readHeight = () => {
    try {
        const h = Number(sessionStorage.getItem(HEIGHT_KEY));
        return Number.isFinite(h) && h >= MIN_HEIGHT ? h : DEFAULT_HEIGHT;
    } catch {
        return DEFAULT_HEIGHT;
    }
};

const rememberHeight = (h: number) => {
    try {
        sessionStorage.setItem(HEIGHT_KEY, String(Math.round(h)));
    } catch {
        // no storage: the default height next time
    }
};

const TAB_KEY = 'dataflow.run.tab';
const VIEW_KEY = 'dataflow.run.dataView';
const TABS = ['errors', 'logs', 'metrics', 'data'] as const;
const VIEWS = ['table', 'json'] as const;

const ms = (value?: number) => (value === undefined ? '—' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`);
const total = (ports: Record<string, number>) => Object.values(ports).reduce((n, v) => n + v, 0);
const time = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleTimeString('en-US', {hour12: false})}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

/** when a run started: its time today, or its date and time */
const when = (iso: string) => {
    const d = new Date(iso);
    const today = d.toDateString() === new Date().toDateString();
    return today ? `today ${time(iso)}` : `${d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
    })} ${time(iso)}`;
};

/** a component's name in the run: the one given on the canvas, or the component's own (HTTP Request, not http-request) */
const nameOf = (c: {
    label: string;
    type: string
}) => (c.label && c.label !== c.type ? c.label : (componentInfo(c.type)?.label ?? c.type));

/** without the node's config: the core's default names */
const defaultPortName: PortName = (_nodeId, type, port) => portLabel(type, {}, port);

const STATUS: Record<string, { icon: typeof CircleCheck; color: string; label: string }> = {
    completed: {icon: CircleCheck, color: 'text-emerald-600 dark:text-emerald-400', label: 'Completed'},
    'with-warnings': {icon: CircleAlert, color: 'text-amber-600 dark:text-amber-400', label: 'With warnings'},
    'with-errors': {icon: CircleX, color: 'text-destructive', label: 'With errors'},
    failed: {icon: CircleX, color: 'text-destructive', label: 'Failed'},
    pinned: {icon: Pin, color: 'text-blue-600 dark:text-blue-400', label: 'Pinned output'},
    disabled: {icon: Power, color: 'text-muted-foreground', label: 'Bypassed'},
    'not-run': {icon: CircleMinus, color: 'text-muted-foreground', label: 'Not run'},
    skipped: {icon: CircleDashed, color: 'text-muted-foreground', label: 'Skipped: it only feeds pinned components'},
    running: {icon: LoaderCircle, color: 'text-muted-foreground animate-spin', label: 'Running'},
};

function StatusIcon({status, className}: { status: string; className?: string }) {
    const s = STATUS[status] ?? STATUS['not-run']!;
    return <s.icon className={cn('size-4 shrink-0', s.color, className)} aria-label={s.label}/>;
}

export type RunPanelProps = {
    /** a port's name (true, false, a Router's case): from the core and the node's config */
    portName?: PortName;
    record: Shown | null;
    /** what the run's worker process used (once it ended; none for older runs) */
    usage?: RunUsage | null;
    /** a run is in progress (a test run or for real) */
    running: 'test' | 'real' | null;
    /** it waits for a free worker (queued) */
    queued?: boolean;
    /** Stop the run going on; `stopping` once asked */
    onStop?: () => void;
    stopping?: boolean;
    onFocus: (nodeId: string) => void;
    /** the nodes whose output is pinned, and the action to pin or unpin one */
    pinned: Set<string>;
    onPin: (nodeId: string, pinned: boolean) => void;
    onClose: () => void;
    /** a port's count was clicked: the Data tab on that component, that port in view (`at` tells two clicks apart) */
    show?: { nodeId: string; port: string; at: number } | null;
    /** the run could not start or be followed (not saved, the server said no) */
    error?: string;
};

export function RunPanel({
                             record,
                             usage,
                             running,
                             queued,
                             onStop,
                             stopping,
                             onFocus,
                             pinned,
                             onPin,
                             onClose,
                             show,
                             error,
                             portName = defaultPortName
                         }: RunPanelProps) {
    const [height, setHeight] = useState(readHeight);
    const [collapsed, setCollapsed] = useState(false);
    const [tab, setTabState] = useState<Tab>(() => readChoice(TAB_KEY, TABS, 'logs'));
    const setTab = (next: Tab) => {
        setTabState(next);
        rememberChoice(TAB_KEY, next);
    };
    // what is being looked at, kept from one run to the next (the record is gone while the next one starts): the Data
    // tab's component and the Logs tab's filters
    const [selected, setSelected] = useState<string | undefined>(undefined);
    // info and up: what a component says of itself (counts, times, the run's own lines) is debug
    const [logsFilter, setLogsFilter] = useState<LogsFilter>({level: 'info', node: 'all'});
    // a count clicked on the canvas: open, on the Data tab, on that component (the request is applied once, when it changes)
    const [shown, setShown] = useState<number | undefined>(undefined);
    if (show && show.at !== shown) {
        setShown(show.at);
        setCollapsed(false);
        setTabState('data');
        setSelected(show.nodeId);
    }
    // a run that ended with errors opens on them, once (then the tab chosen stays)
    const errors = useMemo(() => (record ? runErrors(record) : []), [record]);
    const [errorsShownFor, setErrorsShownFor] = useState<string | undefined>(undefined);
    const ended = record !== null && record !== undefined && record.status !== 'running';
    if (ended && errors.length > 0 && !stoppedRun(record) && errorsShownFor !== record.run.id) {
        setErrorsShownFor(record.run.id);
        if (!show) {
            setTabState('errors');
        }
    }
    const [drag, setDrag] = useState<{ y: number; h: number } | null>(null);

    const startResize = (event: PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({y: event.clientY, h: height});
    };
    const resize = (event: PointerEvent<HTMLDivElement>) => {
        if (drag) {
            setHeight(Math.min(Math.max(drag.h + drag.y - event.clientY, MIN_HEIGHT), window.innerHeight * 0.75));
        }
    };
    const endResize = () => {
        if (drag) {
            rememberHeight(height);
            setDrag(null);
        }
    };

    const start = record?.components.find(c => c.type === 'start');
    const end = record?.components.find(c => c.type === 'end');

    return (
        <section aria-label="Run result"
                 className="relative flex shrink-0 flex-col border-t bg-card text-card-foreground"
                 style={{height: collapsed ? undefined : height}}>
            {!collapsed && (
                <div
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize the run panel"
                    onPointerDown={startResize}
                    onPointerMove={resize}
                    onPointerUp={endResize}
                    className="absolute inset-x-0 -top-1 z-10 h-2 cursor-ns-resize hover:bg-primary/20"
                />
            )}
            <header className="flex h-10 shrink-0 items-center gap-3 border-b px-3 text-sm">
                {running && queued ? (
                    <span className="flex items-center gap-2 font-medium" title="Waiting for a free worker">
            <Clock className="size-4 text-muted-foreground" aria-hidden/>
            Queued…
          </span>
                ) : running ? (
                    <span className="flex items-center gap-2 font-medium">
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden/>
                        {stopping ? 'Stopping…' : running === 'real' ? 'Running for real…' : 'Running…'}
                        {record && <span
                            className="font-mono text-xs font-normal text-muted-foreground">{ms(record.durationMs)}</span>}
          </span>
                ) : error ? (
                    <span className="flex items-center gap-2 font-medium text-destructive">
            <CircleX className="size-4" aria-hidden/>
            Could not run: {error}
          </span>
                ) : record ? (
                    <>
                        {stoppedRun(record) ? (
                            <span className="flex items-center gap-2 font-medium" title={(record as RunRecord).error}>
                <CircleStop className="size-4 text-muted-foreground" aria-hidden/>
                Stopped
              </span>
                        ) : (
                            <span className="flex items-center gap-2 font-medium">
                <StatusIcon status={record.status}/>
                                {STATUS[record.status]?.label}
              </span>
                        )}
                        <span className="text-xs text-muted-foreground">
              {record.run.mode === 'execution' ? 'Run for real' : 'Test run'}
                            {record.from && ` · from ${nameOf(record.components.find(c => c.nodeId === record.from?.nodeId) ?? {
                                label: record.from.label,
                                type: record.from.label
                            })}`}
            </span>
                        <span className="font-mono text-xs text-muted-foreground">{ms(record.durationMs)}</span>
                        <RunUsageText usage={usage} record={record}/>
                        <span className="font-mono text-xs text-muted-foreground"
                              title="Envelopes the Start sent → envelopes that reached the End">
              {start ? total(start.outputs) : 0} → {end ? total(end.inputs) : 0} envelopes
            </span>
                    </>
                ) : null}
                {!collapsed && record && !error && (
                    <div role="tablist" className="ml-4 flex gap-1">
                        {TABS.map(t => (
                            <button
                                key={t}
                                type="button"
                                role="tab"
                                aria-selected={tab === t}
                                onClick={() => setTab(t)}
                                className={cn('rounded-md px-2.5 py-1 text-xs capitalize transition-colors', tab === t ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground')}
                            >
                                {t}
                                {t === 'errors' && errors.length > 0 && (
                                    <span
                                        className="ml-1.5 rounded-full bg-destructive/15 px-1.5 font-mono text-[0.65rem] text-destructive">{errors.reduce((n, e) => n + e.count, 0)}</span>
                                )}
                            </button>
                        ))}
                    </div>
                )}
                <div className="ml-auto flex items-center gap-1">
                    {running && onStop && (
                        <Button variant="outline" size="sm" className="h-7" onClick={onStop} disabled={stopping}
                                title="Stop the run">
                            <Square className="size-3 fill-current" aria-hidden/>
                            Stop
                        </Button>
                    )}
                    <Button variant="ghost" size="icon-sm" aria-label={collapsed ? 'Expand' : 'Collapse'}
                            title={collapsed ? 'Expand' : 'Collapse'} onClick={() => setCollapsed(c => !c)}>
                        {collapsed ? <ChevronUp/> : <ChevronDown/>}
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Close the run panel" title="Close"
                            onClick={onClose} disabled={running !== null}>
                        <X/>
                    </Button>
                </div>
            </header>
            {!collapsed && record && !error && 'error' in record && record.error && !stoppedRun(record) && (
                // why the run failed, in sight without looking for it
                <p role="alert"
                   className="flex shrink-0 items-start gap-2 border-b bg-destructive/10 px-3 py-1.5 text-sm text-destructive">
                    <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden/>
                    <span className="min-w-0 break-words whitespace-pre-wrap">{record.error}</span>
                </p>
            )}
            {!collapsed && record && !error && (
                <div className="min-h-0 flex-1 overflow-auto">
                    {tab === 'errors' && <ErrorsTab record={record} errors={errors} onFocus={onFocus}/>}
                    {tab === 'logs' &&
                        <LogsTab record={record} onFocus={onFocus} filter={logsFilter} onFilter={setLogsFilter}/>}
                    {tab === 'metrics' && <MetricsTab record={record} onFocus={onFocus} portName={portName}/>}
                    {tab === 'data' && (
                        <DataTab record={record} onFocus={onFocus} pinned={pinned} onPin={onPin}
                                 show={show ?? undefined} portName={portName} selected={selected}
                                 onSelect={setSelected}/>
                    )}
                </div>
            )}
        </section>
    );
}

const LEVELS = ['debug', 'info', 'warning', 'error'] as const;
const LEVEL_COLOR: Record<string, string> = {
    debug: 'text-muted-foreground',
    info: 'text-sky-600 dark:text-sky-400',
    warning: 'text-amber-600 dark:text-amber-400',
    error: 'text-destructive'
};

/** the Logs tab's filters: a level and up, one component */
type LogsFilter = { level: string; node: string };

/** every log line of the run, by time; a click focuses its component */
/** the run's errors stacked: one row per component and message, how many times, the first time; a row shows the component */
function ErrorsTab({record, errors, onFocus}: {
    record: Shown;
    errors: RunError[];
    onFocus: (nodeId: string) => void
}) {
    if (errors.length === 0) {
        return (
            <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                <CircleCheck className="size-3.5" aria-hidden/>
                {record.status === 'running' ? 'No errors so far.' : 'No errors.'}
            </p>
        );
    }

    const byId = new Map(record.components.map(c => [c.nodeId, c]));
    return (
        <ul aria-label="Errors" className="text-xs">
            {errors.map(e => {
                const c = byId.get(e.nodeId);
                return (
                    <li key={`${e.nodeId}:${e.message}`} className="border-b last:border-b-0">
                        <button type="button" onClick={() => onFocus(e.nodeId)}
                                className="flex w-full items-start gap-3 px-3 py-1.5 text-left hover:bg-accent"
                                title="Show the component">
                            <CircleX className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden/>
                            <span
                                className="w-1/5 shrink-0 truncate font-medium text-foreground">{c ? nameOf(c) : e.nodeId}</span>
                            <span className="min-w-0 flex-1 font-mono break-words whitespace-pre-wrap text-destructive">
                {e.via && (
                    <span className="text-muted-foreground" title="In a flow it called">
                    {e.via}:{' '}
                  </span>
                )}
                                {e.message}
              </span>
                            {e.count > 1 && <span
                                className="shrink-0 rounded-full bg-destructive/15 px-1.5 font-mono text-destructive"
                                title={`${e.count} times`}>×{e.count}</span>}
                            <span className="shrink-0 font-mono text-muted-foreground">{time(e.at)}</span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

function LogsTab({record, onFocus, filter, onFilter}: {
    record: Shown;
    onFocus: (nodeId: string) => void;
    filter: LogsFilter;
    onFilter: (filter: LogsFilter) => void
}) {
    const {level, node} = filter;
    const setLevel = (next: string) => onFilter({...filter, level: next});
    const setNode = (next: string) => onFilter({...filter, node: next});
    const items = useMemo(() => logItems(record, level).filter(item => node === 'all' || item.nodeId === node), [record, level, node]);
    const select = 'h-7 rounded-md border bg-transparent px-2 text-xs';
    return (
        <div className="flex flex-col">
            <div className="sticky top-0 flex gap-2 border-b bg-card px-3 py-1.5">
                <select aria-label="Level" value={level} onChange={e => setLevel(e.target.value)} className={select}>
                    <option value="all">All levels</option>
                    {LEVELS.map(l => (
                        <option key={l} value={l}>
                            {l} and up
                        </option>
                    ))}
                </select>
                <select aria-label="Component" value={node} onChange={e => setNode(e.target.value)} className={select}>
                    <option value="all">All components</option>
                    {record.components.map(c => (
                        <option key={c.nodeId} value={c.nodeId}>
                            {nameOf(c)}
                        </option>
                    ))}
                </select>
            </div>
            {items.length === 0 &&
                <p className="p-3 text-xs text-muted-foreground">{level === 'all' ? 'No log lines.' : `No log lines at ${level} and up (the components' own lines are debug).`}</p>}
            <LogList items={items} level={level} onFocus={onFocus} depth={0}/>
        </div>
    );
}

/** a line of the Logs tab, or a run a Flow Invoker called (its lines inside, collapsed), each with its component */
type LogItem = { at: string; nodeId: string; label: string; via: string } & ({ kind: 'line'; line: LogLine } | {
    kind: 'sub';
    sub: SubRun & { record: Shown }
});

const atLevel = (line: string, level: string) => level === 'all' || LEVELS.indexOf(line as never) >= LEVELS.indexOf(level as never);

/** whether a run (or a run it called) has a line at the level and up */
const hasLinesAt = (shown: Shown, level: string): boolean =>
    shown.components.some(c => c.logs.some(l => atLevel(l.level, level)) || subRunsOf(c).some(sub => hasLinesAt(sub.record, level)));

/**
 * A run's log lines at the level and up, in time order, with the runs its Flow Invokers called where each started (a
 * called run without a line at the level is left out). `via`: the called flow, before the component's name.
 */
function logItems(shown: Shown, level: string, via = ''): LogItem[] {
    const name = (c: ComponentRun) => (via ? `${via} › ${nameOf(c)}` : nameOf(c));
    const items: LogItem[] = shown.components.flatMap(c => [
        ...c.logs.filter(l => atLevel(l.level, level)).map((line): LogItem => ({
            kind: 'line',
            at: line.at,
            nodeId: c.nodeId,
            label: name(c),
            via,
            line
        })),
        ...subRunsOf(c)
            .filter(sub => level === 'all' || hasLinesAt(sub.record, level))
            .map((sub): LogItem => ({
                kind: 'sub',
                at: sub.record.run.startedAt,
                nodeId: c.nodeId,
                label: name(c),
                via,
                sub
            })),
    ]);
    return items.sort((a, b) => a.at.localeCompare(b.at));
}

/** how many error lines a run (and the runs it called) has */
const errorLines = (shown: Shown): number => shown.components.reduce((n, c) => n + c.logs.filter(l => l.level === 'error').length + subRunsOf(c).reduce((m, sub) => m + errorLines(sub.record), 0), 0);

/** the lines, and each called run as a group that opens on its own lines (nested when that one called flows too) */
function LogList({items, level, onFocus, depth, focus}: {
    items: LogItem[];
    level: string;
    onFocus: (nodeId: string) => void;
    depth: number;
    focus?: string
}) {
    const indent = {paddingLeft: `${0.75 + depth * 1.25}rem`};
    return (
        <ul className="font-mono text-xs">
            {items.map((item, i) =>
                item.kind === 'line' ? (
                    <li key={i}>
                        <button type="button" onClick={() => onFocus(focus ?? item.nodeId)}
                                className="flex w-full gap-3 px-3 py-0.5 text-left hover:bg-accent" style={indent}>
                            <span className="shrink-0 text-muted-foreground">{time(item.at)}</span>
                            <span className={cn('w-14 shrink-0', LEVEL_COLOR[item.line.level])}>{item.line.level}</span>
                            <span className="w-1/5 shrink-0 truncate text-foreground"
                                  title={item.label}>{item.label}</span>
                            <span className="min-w-0 break-words whitespace-pre-wrap">{item.line.message}</span>
                        </button>
                    </li>
                ) : (
                    <li key={`sub:${item.sub.id}`}>
                        <SubRunGroup item={item} level={level} onFocus={onFocus} depth={depth}
                                     focus={focus ?? item.nodeId}/>
                    </li>
                ),
            )}
        </ul>
    );
}

/** "Called Flow 2: Completed in 12 ms · 2 error lines", collapsed; open, the called run's lines under it */
function SubRunGroup({item, level, onFocus, depth, focus}: {
    item: Extract<LogItem, { kind: 'sub' }>;
    level: string;
    onFocus: (nodeId: string) => void;
    depth: number;
    focus: string
}) {
    const {sub} = item;
    const errors = errorLines(sub.record);
    const status = STATUS[sub.status]?.label ?? sub.status;
    return (
        <details className="group/sub">
            <summary
                className="flex cursor-pointer list-none gap-3 px-3 py-0.5 hover:bg-accent [&::-webkit-details-marker]:hidden"
                style={{paddingLeft: `${0.75 + depth * 1.25}rem`}}
                aria-label={`Run of ${sub.flow}`}
                title={sub.error ? `${status}: ${sub.error}` : status}
            >
                <span className="shrink-0 text-muted-foreground">{time(item.at)}</span>
                <span className="flex w-14 shrink-0 items-center gap-1 text-muted-foreground">
          <ChevronRight className="size-3.5 transition-transform group-open/sub:rotate-90" aria-hidden/>
          <StatusIcon status={sub.status} className="size-3.5"/>
        </span>
                <span className="w-1/5 shrink-0 truncate text-foreground" title={item.label}>{item.label}</span>
                <span className="min-w-0 break-words text-muted-foreground">
          Called <span
                    className="text-foreground">{sub.flow}</span>: {sub.status === 'running' ? 'running' : `${status.toLowerCase()} in ${ms(sub.durationMs)}`}
                    {errors > 0 &&
                        <span className="text-destructive"> · {errors} error line{errors === 1 ? '' : 's'}</span>}
        </span>
            </summary>
            <LogList items={logItems(sub.record, level, item.via ? `${item.via} › ${sub.flow}` : sub.flow)}
                     level={level} onFocus={onFocus} depth={depth + 1} focus={focus}/>
        </details>
    );
}

/** the order of a component's ports: out-0, out-1… (in-0, in-1…), the error port last */
const portRank = (port: string) => (port === ERROR_PORT ? Number.MAX_SAFE_INTEGER : Number(port.replace(/\D/g, '')) || 0);

/** envelopes per port, by the ports' names (true: 5 · false: 95), or the total when there is one port */
const ports = (counts: Record<string, number>, name: (port: string) => string) =>
    Object.keys(counts).length > 1
        ? Object.entries(counts)
            .sort(([a], [b]) => portRank(a) - portRank(b))
            .map(([p, n]) => `${name(p)}: ${n}`)
            .join(' · ')
        : String(total(counts));

/** an input's name (Lookup's input, lookup), from the core */
const inputName = (type: string, port: string) => inputPorts(type).find(p => p.id === port)?.label ?? port;

/** a time a component worked or waited: below 10 ms the fraction is worth showing (most components take tenths of a ms) */
const shortMs = (value?: number) => (value === undefined ? '—' : value < 10 ? `${value.toLocaleString('en-US', {maximumFractionDigits: 2})} ms` : ms(value));
const bytes = (value: number) => (value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`);

/** the Metrics columns, with what each one measures */
const METRICS: { label: string; hint: string; right?: boolean }[] = [
    {label: 'Component', hint: 'Its name on the canvas and what it is'},
    {label: 'In', hint: 'Envelopes that came in (per input, when it has several)', right: true},
    {label: 'Out', hint: 'Envelopes that went out (per output, when it has several)', right: true},
    {
        label: 'Open',
        hint: 'From its first envelope until it finished: its active and waiting time, and the time it spent waiting for envelopes or for the next component to take them',
        right: true
    },
    {
        label: 'Active',
        hint: 'Time processing, its own work only (practically the CPU it used): not waiting for anything',
        right: true
    },
    {
        label: 'Waiting',
        hint: 'Time waiting for an outside system: an HTTP call (and its OAuth 2.0 token), database rows, a MongoDB write, a called flow',
        right: true
    },
    {
        label: 'Memory',
        hint: 'Most it held at once (the Lookup table, an Aggregate batch, a Sort): envelopes and an estimate of their size',
        right: true
    },
    {label: 'Start', hint: 'When its first envelope arrived', right: true},
    {
        label: 'Timeline',
        hint: 'When it was open in the run, in the order of the columns: light = open, middle = active (working), dark = waiting for an outside system'
    },
];

/**
 * When the component was open, on the run's time axis (as in the PoC): light from its first envelope until it finished;
 * left to right in the order and shades of the columns (Open, Active, Waiting: lighter to darker), the rest of the open
 * time, then how much of it it spent working, then waiting for an outside system (their share of the open time).
 */
export function Timeline({c, runStart, runMs}: { c: ComponentRun; runStart: number; runMs: number }) {
    if (!c.start || runMs <= 0) {
        return <span className="text-muted-foreground">—</span>;
    }

    const share = (value: number) => Math.min(100, Math.max(0, (value / runMs) * 100));
    // a component still running: open until now
    const open = Math.max(c.durationMs ?? runMs - (Date.parse(c.start) - runStart), 0);
    // inside the axis: where it opened, and how long, never past its end
    const left = share(Date.parse(c.start) - runStart);
    const width = Math.min(share(open), 100 - left);
    const active = Math.min(c.activeTimeMs ?? 0, open);
    const waiting = Math.min(c.waitingMs ?? 0, open - active);
    const title = `Open ${ms(open)} (from ${time(c.start)}) · active ${shortMs(active)}${c.waitingMs !== undefined ? ` · waiting ${shortMs(waiting)}` : ''}`;
    return (
        <span className="relative block h-3 w-full min-w-40 overflow-hidden rounded-sm bg-muted/60" title={title}
              aria-label={title}>
      <span
          // the active and waiting parts at the end of the open track: left to right Open, Active, Waiting (as the columns)
          className="absolute inset-y-0 flex min-w-0.5 justify-end overflow-hidden rounded-sm bg-primary/25"
          // one that opened at the very end still shows a sliver inside the axis
          style={{left: `min(${left}%, calc(100% - 2px))`, width: `${width}%`}}
      >
        <span data-part="active" className="h-full bg-primary/55"
              style={{width: open ? `${(active / open) * 100}%` : 0}}/>
        <span data-part="waiting" className="h-full bg-primary"
              style={{width: open ? `${(waiting / open) * 100}%` : 0}}/>
      </span>
    </span>
    );
}

/**
 * One row per component: status, envelopes in and out per port, its times, memory and timeline; a click shows it. A
 * Flow Invoker's called runs come after it, collapsed: open, each one's components (on the same time axis).
 */
function MetricsTab({record, onFocus, portName}: {
    record: Shown;
    onFocus: (nodeId: string) => void;
    portName: PortName
}) {
    const runStart = Date.parse(record.run.startedAt);
    // the axis: the whole run, or further when a component's times (finer than the run's ms) end after it
    const span = timelineSpan(record, runStart);
    const [open, setOpen] = useState<Set<string>>(new Set());
    const toggle = (key: string) =>
        setOpen(prev => {
            const next = new Set(prev);
            if (!next.delete(key)) {
                next.add(key);
            }

            return next;
        });
    return (
        <table className="w-full min-w-[1100px] text-xs">
            <thead className="sticky top-0 z-10 bg-card text-left text-muted-foreground">
            <tr className="border-b">
                {METRICS.map((h, i) => (
                    // the component's name stays in view when the table is wider than the panel
                    <th key={h.label} title={h.hint}
                        className={cn(CELL, 'cursor-help font-medium', h.right && 'text-right', h.label === 'Timeline' && 'w-1/4', i === 0 && 'sticky left-0 bg-card')}>
                        {h.label}
                    </th>
                ))}
            </tr>
            </thead>
            <tbody>
            <MetricsRows components={record.components} runStart={runStart} span={span} onFocus={onFocus}
                         portName={portName} depth={0} open={open} onToggle={toggle}/>
            </tbody>
        </table>
    );
}

const CELL = 'px-3 py-1.5';

/** the rows of a run's components; under a Flow Invoker, a row per called run that opens on that run's rows */
function MetricsRows(props: {
    components: ComponentRun[];
    runStart: number;
    span: number;
    onFocus: (nodeId: string) => void;
    portName: PortName;
    depth: number;
    open: Set<string>;
    onToggle: (key: string) => void;
    /** inside a called run: the Flow Invoker a click shows, and the key of the run (its rows are keyed under it) */
    focus?: string;
    under?: string;
}) {
    const {components, runStart, span, onFocus, portName, depth, open, onToggle, focus, under} = props;
    const indent = {paddingLeft: `${0.75 + depth * 1.25}rem`};
    return components.map(c => {
        const subs = subRunsOf(c);
        return (
            <Fragment key={c.nodeId}>
                <tr onClick={() => onFocus(focus ?? c.nodeId)} title="Show on the canvas"
                    className="group cursor-pointer border-b hover:bg-accent">
                    <td className={cn(CELL, 'sticky left-0 bg-card group-hover:bg-accent')} style={indent}>
            <span className="flex items-center gap-2">
              <StatusIcon status={c.status}/>
              <span className="font-medium">{nameOf(c)}</span>
                {nameOf(c) !== componentInfo(c.type)?.label &&
                    <span className="text-muted-foreground">{componentInfo(c.type)?.label}</span>}
            </span>
                    </td>
                    <td className={cn(CELL, 'text-right font-mono')}>{c.type === 'start' && total(c.inputs) === 0 ? '—' : ports(c.inputs, port => inputName(c.type, port))}</td>
                    <td className={cn(CELL, 'text-right font-mono')}>{c.type === 'end' ? '—' : ports(c.outputs, port => (focus ? portLabel(c.type, {}, port) : portName(c.nodeId, c.type, port)))}</td>
                    <td className={cn(CELL, 'text-right font-mono')}>{ms(c.durationMs)}</td>
                    <td className={cn(CELL, 'text-right font-mono')}>{shortMs(c.activeTimeMs)}</td>
                    <td className={cn(CELL, 'text-right font-mono', c.waitingMs === undefined && 'text-muted-foreground')}>{shortMs(c.waitingMs)}</td>
                    <td className={cn(CELL, 'text-right font-mono')}>
                        {c.memory && c.memory.peakEnvelopes > 0 ? (
                            <span className="flex flex-col items-end">
                <span>{bytes(c.memory.peakBytes)}</span>
                <span className="text-muted-foreground">{c.memory.peakEnvelopes.toLocaleString('en-US')} env.</span>
              </span>
                        ) : (
                            <span className="text-muted-foreground">—</span>
                        )}
                    </td>
                    <td className={cn(CELL, 'text-right font-mono text-muted-foreground')}>{c.start ? time(c.start) : '—'}</td>
                    <td className={CELL}>
                        <Timeline c={c} runStart={runStart} runMs={span}/>
                    </td>
                </tr>
                {subs.map((sub, index) => {
                    const key = `${under ?? ''}/${c.nodeId}/${sub.id}`;
                    const expanded = open.has(key);
                    const status = STATUS[sub.status]?.label ?? sub.status;
                    return (
                        <Fragment key={sub.id}>
                            <tr className="border-b bg-muted/30">
                                <td colSpan={METRICS.length} className="sticky left-0 p-0">
                                    <button
                                        type="button"
                                        aria-expanded={expanded}
                                        onClick={() => onToggle(key)}
                                        className="flex w-full items-center gap-2 px-3 py-1 text-left text-muted-foreground hover:bg-accent"
                                        style={{paddingLeft: `${0.75 + (depth + 1) * 1.25}rem`}}
                                        title={sub.error ? `${status}: ${sub.error}` : 'Show what its components did'}
                                    >
                                        <ChevronRight
                                            className={cn('size-3.5 transition-transform', expanded && 'rotate-90')}
                                            aria-hidden/>
                                        <StatusIcon status={sub.status} className="size-3.5"/>
                                        <span>
                      Call {index + 1}: <span
                                            className="text-foreground">{sub.flow}</span> {sub.status === 'running' ? 'running' : `${status.toLowerCase()} in ${ms(sub.durationMs)}`}
                    </span>
                                    </button>
                                </td>
                            </tr>
                            {expanded && (
                                <MetricsRows components={sub.record.components} runStart={runStart} span={span}
                                             onFocus={onFocus} portName={portName} depth={depth + 2} open={open}
                                             onToggle={onToggle} focus={focus ?? c.nodeId} under={key}/>
                            )}
                        </Fragment>
                    );
                })}
            </Fragment>
        );
    });
}

/** a component's input and output envelopes (the first ones), side by side, as a table or JSON; Pin output here */
function DataTab(props: {
    record: Shown;
    onFocus: (nodeId: string) => void;
    pinned: Set<string>;
    onPin: (nodeId: string, pinned: boolean) => void;
    show?: { nodeId: string; port: string; at: number };
    portName: PortName;
    /** the component chosen (kept across runs), and the action to choose one */
    selected?: string;
    onSelect: (nodeId: string) => void;
}) {
    const {record, onFocus, pinned, onPin, show, portName, onSelect} = props;
    const shown = dataTabComponents(record);
    const selected = dataTabSelection(record, props.selected);
    const setSelected = onSelect;
    // Table or JSON: the same for every component, kept in this browser tab
    const [view, setViewState] = useState<'table' | 'json'>(() => readChoice(VIEW_KEY, VIEWS, 'table'));
    const setView = (next: 'table' | 'json') => {
        setViewState(next);
        rememberChoice(VIEW_KEY, next);
    };
    const c = shown.find(x => x.nodeId === selected);
    return (
        <div className="flex h-full min-h-0">
            <ul aria-label="Components" className="w-52 shrink-0 overflow-auto border-r py-1 text-xs">
                {shown.map(x => (
                    <li key={x.nodeId}>
                        <button
                            type="button"
                            onClick={() => {
                                setSelected(x.nodeId);
                                onFocus(x.nodeId);
                            }}
                            className={cn('flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-accent', x.nodeId === selected && 'bg-accent font-medium')}
                        >
                            <StatusIcon status={x.status} className="size-3.5"/>
                            <span className="truncate">{nameOf(x)}</span>
                        </button>
                    </li>
                ))}
            </ul>
            {c && (
                <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2 border-b px-3 py-1.5">
                        <div role="radiogroup" aria-label="View" className="flex gap-1">
                            {VIEWS.map(v => (
                                <button
                                    key={v}
                                    type="button"
                                    role="radio"
                                    aria-checked={view === v}
                                    onClick={() => setView(v)}
                                    className={cn('rounded-md px-2 py-0.5 text-xs uppercase', view === v ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground')}
                                >
                                    {v}
                                </button>
                            ))}
                        </div>
                        {record.status !== 'running' && c.type !== 'start' && c.type !== 'end' && runActions(c, pinned.has(c.nodeId)).pin && (
                            <Button variant="outline" size="sm" className="ml-auto h-7 text-xs"
                                    onClick={() => onPin(c.nodeId, !pinned.has(c.nodeId))}>
                                <Pin
                                    className={cn(pinned.has(c.nodeId) && 'rotate-45 text-blue-600 dark:text-blue-400')}/> {pinned.has(c.nodeId) ? 'Unpin output' : 'Pin output'}
                            </Button>
                        )}
                    </div>
                    {/* the Start only sends (its input is its output), the End only receives */}
                    <div
                        className={cn('grid min-h-0 flex-1 overflow-hidden', oneSide(c) ? 'grid-cols-1' : 'grid-cols-2 divide-x')}>
                        {c.type !== 'start' &&
                            <Envelopes title={`Input (${total(c.inputs)})`} envelopes={c.inputSample} view={view}
                                       treeKey={`${c.nodeId}:in`}/>}
                        {c.type !== 'end' && (
                            <OutputPorts key={`${c.nodeId}:${show?.nodeId === c.nodeId ? show.at : ''}`} c={c}
                                         view={view} portName={portName}
                                         show={show?.nodeId === c.nodeId ? show.port : undefined}/>
                        )}
                    </div>
                </div>
            )}
            {!c && selected && (
                // chosen, but this run has not reached it yet
                <p className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Clock className="size-3.5" aria-hidden/>
                    Not run yet
                </p>
            )}
        </div>
    );
}

/** the Start shows only its output (what it received is what it sends), the End only its input */
const oneSide = (c: ComponentRun) => c.type === 'start' || c.type === 'end';

/** a port's name for the Data tab (true, false, a Router's case, error), from the core and the node's config */
export type PortName = (nodeId: string, type: string, port: string) => string;

/** the port shown last for each component, while the page is open */
const shownPort = new Map<string, string>();

/**
 * A component's output, one port at a time: the ports as tabs with their names and counts (true (5), false (95),
 * error (1)); the one chosen fills the column with its own scroll. First: the port clicked on the canvas, the one shown
 * last for this component, or the first that sent envelopes.
 */
function OutputPorts({c, view, portName, show}: {
    c: ComponentRun;
    view: 'table' | 'json';
    portName: PortName;
    show?: string
}) {
    // in the component's order (out-0, out-1… as the core lists them), the error port last
    const ports = [...new Set([...Object.keys(c.outputs), ...Object.keys(c.outputSample)])].sort((a, b) => portRank(a) - portRank(b));
    const count = (port: string) => c.outputs[port] ?? c.outputSample[port]?.length ?? 0;
    const [port, setPortState] = useState(() => {
        // a port clicked on the canvas is the one this component shows from now on
        if (show) {
            shownPort.set(c.nodeId, show);
        }

        return show ?? shownPort.get(c.nodeId) ?? ports.find(p => count(p) > 0) ?? ports[0];
    });
    const setPort = (next: string) => {
        setPortState(next);
        shownPort.set(c.nodeId, next);
    };
    if (ports.length === 0 || port === undefined) {
        return <Envelopes title="Output (0)" envelopes={[]} view={view} treeKey={`${c.nodeId}:out`}/>;
    }

    if (ports.length === 1) {
        return <Envelopes title={`Output (${count(port)})`} envelopes={c.outputSample[port] ?? []} view={view}
                          inView={show === port} treeKey={`${c.nodeId}:${port}`}/>;
    }

    return (
        <div className="flex min-h-0 flex-col">
            <div role="tablist" aria-label="Output ports" className="flex shrink-0 flex-wrap gap-1 border-b px-2 py-1">
                {ports.map(p => (
                    <button
                        key={p}
                        type="button"
                        role="tab"
                        aria-selected={p === port}
                        onClick={() => setPort(p)}
                        className={cn(
                            'rounded-md px-2 py-0.5 font-mono text-[11px]',
                            p === port ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground',
                            p === 'error' && 'text-destructive',
                        )}
                    >
                        {portName(c.nodeId, c.type, p)} ({count(p)})
                    </button>
                ))}
            </div>
            <Envelopes
                title={`Output${portName(c.nodeId, c.type, port) === 'output' ? '' : ` ${portName(c.nodeId, c.type, port)}`} (${count(port)})`}
                envelopes={c.outputSample[port] ?? []}
                view={view}
                inView={show === port}
                treeKey={`${c.nodeId}:${port}`}
            />
        </div>
    );
}

const cell = (value: unknown): ReactNode => (value === null || value === undefined ? <span
    className="text-muted-foreground">null</span> : typeof value === 'object' ? JSON.stringify(value) : String(value));

/** where each column (a component's input, a port's output) was scrolled to, while the page is open */
const scrolledTo = new Map<string, number>();

function Envelopes(props: {
    title: string;
    envelopes: EnvelopeData[];
    view: 'table' | 'json';
    inView?: boolean;
    treeKey: string
}) {
    const {title, envelopes, view, inView, treeKey} = props;
    const columns = [...new Set(envelopes.flatMap(e => Object.keys(e)))];
    // the next run shows the same place: back to where it was, as soon as the envelopes reach that far, unless the
    // user scrolls first
    const section = useRef<HTMLElement | null>(null);
    const restoring = useRef(true);
    useLayoutEffect(() => {
        const saved = scrolledTo.get(`${treeKey}:${view}`) ?? 0;
        if (!restoring.current || !section.current || saved === 0) {
            restoring.current = false;
            return;
        }

        section.current.scrollTop = saved;
        if (section.current.scrollTop >= saved - 1) {
            restoring.current = false;
        }
    });
    const userScrolls = () => {
        restoring.current = false;
    };
    return (
        <section
            // the port whose count was clicked on the canvas: scrolled into view and marked
            ref={element => {
                section.current = element;
                if (inView) {
                    element?.scrollIntoView({block: 'nearest'});
                }
            }}
            onWheel={userScrolls}
            onPointerDown={userScrolls}
            onKeyDown={userScrolls}
            onScroll={event => {
                if (!restoring.current) {
                    scrolledTo.set(`${treeKey}:${view}`, event.currentTarget.scrollTop);
                }
            }}
            data-shown={inView || undefined}
            className={cn('flex min-h-0 flex-1 flex-col overflow-auto', inView && 'ring-1 ring-primary/40 ring-inset')}
        >
            <h4 className="sticky top-0 border-b bg-card px-3 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h4>
            {envelopes.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">No envelopes.</p>
            ) : view === 'json' ? (
                // its own state per component and port (key: another port starts from what it had)
                <JsonTree key={treeKey} value={envelopes} memoryKey={treeKey}/>
            ) : (
                <table className="w-max min-w-full font-mono text-xs">
                    <thead className="text-left text-muted-foreground">
                    <tr className="border-b">
                        {columns.map(col => (
                            <th key={col} className="px-3 py-1 font-medium">
                                ${col}
                            </th>
                        ))}
                    </tr>
                    </thead>
                    <tbody>
                    {envelopes.map((e, i) => (
                        <tr key={i} className="border-b align-top">
                            {columns.map(col => (
                                <td key={col} className="max-w-80 truncate px-3 py-1"
                                    title={typeof e[col] === 'object' ? JSON.stringify(e[col]) : String(e[col] ?? '')}>
                                    {cell(e[col])}
                                </td>
                            ))}
                        </tr>
                    ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}

/** a run that Stop ended (the server stores it cancelled; its record says it failed with this) */
const stoppedRun = (record: Shown): boolean => record.status === 'failed' && /^Run cancelled/.test((record as RunRecord).error ?? '');

const USAGE_HINT =
    "What the run's worker process used. Memory: its peak, Bun included (about 50 MB before any run); in brackets, " +
    'how much it grew during the run, close to what the run itself used. Process CPU: the processing time of the whole ' +
    "worker process during the run: the components' code and also the engine (scheduling, samples, progress sent to the " +
    'server, memory sampling, garbage collection) and any flows called by a Flow Invoker. Components: the sum of the Active ' +
    "column of the Metrics tab, the time inside the components' own code only.";

/** the Active time of the components, summed (what the Metrics tab's Active column adds up to) */
const componentsActiveMs = (record: Shown) => record.components.reduce((n, c) => n + (c.activeTimeMs ?? 0), 0);

/** "Memory 98 MB peak (+50 MB) · Process CPU 94 ms · Components 3 ms", or dashes for a run without them (older runs) */
function RunUsageText({usage, record}: { usage?: RunUsage | null; record: Shown }) {
    const peak = usage?.peakRssBytes ?? null;
    const start = usage?.startRssBytes ?? null;
    const cpu = usage?.cpuMs ?? null;
    const grew = peak !== null && start !== null ? `(+${bytes(Math.max(peak - start, 0))})` : '';
    return (
        <span className="cursor-help font-mono text-xs text-muted-foreground" title={USAGE_HINT}>
      Memory {peak === null ? '—' : `${bytes(peak)} peak ${grew}`.trim()} · Process CPU {cpu === null ? '—' : `${Math.round(cpu)} ms`} · Components{' '}
            {shortMs(componentsActiveMs(record))}
    </span>
    );
}

/**
 * One component's part of the last run (a component window's Last run tab): how it ended, its counts and times, what
 * came in and what went out per port (as the Data tab shows them), and its log lines.
 */
export function ComponentLastRun({c, about, portName = defaultPortName}: {
    c: ComponentRun | undefined;
    about?: RunAbout;
    portName?: PortName
}) {
    const [view, setViewState] = useState<'table' | 'json'>(() => readChoice(VIEW_KEY, VIEWS, 'table'));
    const setView = (next: 'table' | 'json') => {
        setViewState(next);
        rememberChoice(VIEW_KEY, next);
    };
    if (!c || c.status === 'not-run') {
        return <p className="p-4 text-sm text-muted-foreground">Not run yet: run the flow to see what came in and went
            out here.</p>;
    }

    const facts: [string, string][] = [
        ['In', String(total(c.inputs))],
        ['Out', String(total(c.outputs))],
        ['Open', ms(c.durationMs)],
        ['Active', shortMs(c.activeTimeMs)],
        ['Waiting', shortMs(c.waitingMs)],
        ...(c.memory && c.memory.peakEnvelopes > 0 ? [['Memory', bytes(c.memory.peakBytes)] as [string, string]] : []),
    ];
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {about && (
                // which run this is: Test run or Run for real (from a component), and when it started
                <p className="border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
                    <span
                        className="font-medium text-foreground">{about.mode === 'execution' ? 'Run for real' : 'Test run'}</span>
                    {about.from && ` · from ${about.from}`}
                    {` · ${when(about.startedAt)}`}
                </p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          <StatusIcon status={c.status} className="size-3.5"/>
            {STATUS[c.status]?.label ?? c.status}
        </span>
                {facts.map(([label, value]) => (
                    <span key={label} className="text-muted-foreground">
            {label} <span className="font-mono text-foreground">{value}</span>
          </span>
                ))}
                <div role="radiogroup" aria-label="View" className="ml-auto flex gap-1">
                    {VIEWS.map(v => (
                        <button
                            key={v}
                            type="button"
                            role="radio"
                            aria-checked={view === v}
                            onClick={() => setView(v)}
                            className={cn('rounded-md px-2 py-0.5 text-xs uppercase', view === v ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground')}
                        >
                            {v}
                        </button>
                    ))}
                </div>
            </div>
            <div
                className={cn('grid min-h-48 flex-1 overflow-hidden border-b', oneSide(c) ? 'grid-cols-1' : 'grid-cols-2 divide-x')}>
                {c.type !== 'start' &&
                    <Envelopes title={`Input (${total(c.inputs)})`} envelopes={c.inputSample} view={view}
                               treeKey={`${c.nodeId}:in`}/>}
                {c.type !== 'end' && <OutputPorts key={c.nodeId} c={c} view={view} portName={portName}/>}
            </div>
            <ul aria-label="Log lines" className="max-h-40 shrink-0 overflow-auto py-1 font-mono text-xs">
                {c.logs.length === 0 && <li className="px-4 py-0.5 text-muted-foreground">No log lines.</li>}
                {c.logs.map((l: LogLine, i: number) => (
                    <li key={i} className="flex gap-3 px-4 py-0.5">
                        <span className="shrink-0 text-muted-foreground">{time(l.at)}</span>
                        <span className={cn('w-14 shrink-0', LEVEL_COLOR[l.level])}>{l.level}</span>
                        <span className="min-w-0 break-words">{l.message}</span>
                    </li>
                ))}
            </ul>
            {subRunsOf(c).length > 0 && <CalledRuns c={c}/>}
        </div>
    );
}

/** a Flow Invoker's called runs (the first MAX_SUB_RUNS): each collapsed on how it went, open on its log lines */
function CalledRuns({c}: { c: ComponentRun }) {
    const subs = subRunsOf(c);
    const kept = c.subRuns?.length ?? 0;
    return (
        <div className="max-h-56 shrink-0 overflow-auto border-t">
            <p className="px-4 pt-2 pb-1 text-xs font-medium">
                Called flows <span
                className="font-normal text-muted-foreground">({kept === total(c.inputs) ? kept : `the first ${kept} of ${total(c.inputs)} calls`})</span>
            </p>
            <ul aria-label="Called flows" className="pb-1 font-mono text-xs">
                {subs.map((sub, index) => (
                    <li key={sub.id}>
                        <SubRunGroup item={{
                            kind: 'sub',
                            at: sub.record.run.startedAt,
                            nodeId: c.nodeId,
                            label: `Call ${index + 1}`,
                            via: '',
                            sub
                        }} level="all" onFocus={() => {
                        }} depth={0} focus={c.nodeId}/>
                    </li>
                ))}
            </ul>
        </div>
    );
}
