import { useState, type ReactNode } from 'react';
import { ChevronRight, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { expressionPath, PAGE, summaryOf, type Path } from './json-paths';

/*
 * The run panel's JSON view as a tree: objects and arrays open and close (a caret; closed, `{…} 12 keys` or
 * `[…] 100 items`), Expand all and Collapse all, long arrays shown 100 items at a time. Opened at two levels (the
 * envelopes and their keys). What was opened or closed is kept per component and port while the page is open.
 * Hovering a line offers to copy its value, or its path as an expression (`$response.headers["set-cookie"]`).
 */

/** levels open at first: the list of envelopes and each envelope's keys */
const OPEN_DEPTH = 2;

/** what was opened, closed or shown more of in one tree (a component's port) */
type TreeState = { all: boolean | null; open: Map<string, boolean>; shown: Map<string, number> };

/** the trees' states while the page is open, by component and port */
const memory = new Map<string, TreeState>();

const fresh = (): TreeState => ({ all: null, open: new Map(), shown: new Map() });
const pathKey = (path: Path) => JSON.stringify(path);

const copy = (text: string) => {
  void navigator.clipboard?.writeText(text).catch(() => {});
};

export function JsonTree({ value, memoryKey }: { value: unknown; memoryKey: string }) {
  const [state, setState] = useState<TreeState>(() => memory.get(memoryKey) ?? fresh());
  const update = (change: (draft: TreeState) => void) => {
    const next: TreeState = { all: state.all, open: new Map(state.open), shown: new Map(state.shown) };
    change(next);
    memory.set(memoryKey, next);
    setState(next);
  };

  // Collapse all keeps the list of envelopes open: one closed line per envelope
  const isOpen = (path: Path) => state.open.get(pathKey(path)) ?? (state.all === false && path.length === 0 ? true : (state.all ?? path.length < OPEN_DEPTH));
  const toggle = (path: Path) => update(s => void s.open.set(pathKey(path), !isOpen(path)));
  const showMore = (path: Path) => update(s => void s.shown.set(pathKey(path), (s.shown.get(pathKey(path)) ?? PAGE) + PAGE));
  const all = (open: boolean) =>
    update(s => {
      s.all = open;
      s.open.clear();
    });

  return (
    <div className="p-3 font-mono text-xs">
      <div className="mb-1 flex gap-2">
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => all(true)}>
          Expand all
        </button>
        <span className="text-muted-foreground/50" aria-hidden>
          ·
        </span>
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => all(false)}>
          Collapse all
        </button>
      </div>
      <Node value={value} path={[]} isOpen={isOpen} toggle={toggle} shown={path => state.shown.get(pathKey(path)) ?? PAGE} showMore={showMore} />
    </div>
  );
}

type NodeProps = {
  value: unknown;
  path: Path;
  /** its key in the parent (an object's key or an array's index) */
  name?: string | number;
  last?: boolean;
  isOpen: (path: Path) => boolean;
  toggle: (path: Path) => void;
  shown: (path: Path) => number;
  showMore: (path: Path) => void;
};

function Node(props: NodeProps) {
  const { value, path, name, last = true, isOpen, toggle, shown, showMore } = props;
  const label = name === undefined ? null : typeof name === 'number' ? null : <span className="text-sky-700 dark:text-sky-300">{JSON.stringify(name)}: </span>;
  const comma = last ? '' : ',';

  if (value === null || typeof value !== 'object') {
    return (
      <Line path={path} value={value}>
        {label}
        <Primitive value={value} />
        {comma}
      </Line>
    );
  }

  const array = Array.isArray(value);
  const entries: [string | number, unknown][] = array ? value.map((v, i) => [i, v]) : Object.entries(value);
  const [open, close] = array ? ['[', ']'] : ['{', '}'];
  const expanded = isOpen(path);
  const caret = (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={expanded ? 'Collapse' : 'Expand'}
      onClick={() => toggle(path)}
      className="-ml-4 inline-flex w-4 justify-center text-muted-foreground hover:text-foreground"
    >
      <ChevronRight className={cn('size-3 transition-transform', expanded && 'rotate-90')} aria-hidden />
    </button>
  );

  if (!expanded || entries.length === 0) {
    return (
      <Line path={path} value={value}>
        {entries.length > 0 && caret}
        {label}
        {entries.length === 0 ? (
          `${open}${close}`
        ) : (
          <button type="button" onClick={() => toggle(path)} className="text-muted-foreground hover:text-foreground">
            {summaryOf(value)}
          </button>
        )}
        {comma}
      </Line>
    );
  }

  const limit = shown(path);
  const visible = entries.slice(0, limit);
  return (
    <div>
      <Line path={path} value={value}>
        {caret}
        {label}
        {open}
      </Line>
      <div className="ml-2 border-l border-border/60 pl-4">
        {visible.map(([key, child], i) => (
          <Node key={key} {...props} value={child} path={[...path, key]} name={key} last={i === entries.length - 1} />
        ))}
        {entries.length > limit && (
          <button type="button" onClick={() => showMore(path)} className="text-muted-foreground hover:text-foreground">
            Show {Math.min(PAGE, entries.length - limit)} more of {entries.length - limit}
          </button>
        )}
      </div>
      <div>
        {close}
        {comma}
      </div>
    </div>
  );
}

/** one line of the tree; on hover, copy its value or its path */
function Line({ path, value, children }: { path: Path; value: unknown; children: ReactNode }) {
  return (
    <div className="group flex items-start gap-2">
      <span className="min-w-0 break-all whitespace-pre-wrap">{children}</span>
      <span className="hidden shrink-0 gap-1 group-hover:inline-flex">
        <button type="button" title="Copy the value" aria-label="Copy the value" onClick={() => copy(JSON.stringify(value, null, 2))} className="text-muted-foreground hover:text-foreground">
          <Copy className="size-3" aria-hidden />
        </button>
        {path.length > 1 && (
          <button type="button" title="Copy the path" aria-label="Copy the path" onClick={() => copy(expressionPath(path))} className="text-[10px] text-muted-foreground hover:text-foreground">
            $path
          </button>
        )}
      </span>
    </div>
  );
}

function Primitive({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">null</span>;
  }

  if (typeof value === 'string') {
    return <span className="text-emerald-700 dark:text-emerald-400">{JSON.stringify(value)}</span>;
  }

  if (typeof value === 'number') {
    return <span className="text-amber-700 dark:text-amber-300">{String(value)}</span>;
  }

  if (typeof value === 'boolean') {
    return <span className="text-violet-700 dark:text-violet-300">{String(value)}</span>;
  }

  return <span>{JSON.stringify(value)}</span>;
}
