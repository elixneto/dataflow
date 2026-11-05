import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Handle, NodeToolbar, Position, useNodeConnections, useReactFlow, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { Circle, CircleAlert, CircleCheck, CircleDashed, CircleMinus, CircleX, CornerDownRight, Eye, LogIn, LoaderCircle, OctagonX, Pin, Play, Power, SkipForward, SlidersHorizontal, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CATEGORIES, componentInfo, isFixedType } from './catalog';
import { CARD_HEIGHT, CARD_WIDTH, portTop, SIDE_GAP } from './node-geometry';
import { useHistory } from './history';
import { pinnedOutput, runActions, useRunMark } from './run/run-marks';
import { nameIn, useProjectResources } from './project-resources';
import { componentSummary, START, startConfig, ERROR_PORT, type ComponentRun, type EnvelopeData, errorPort, inputPorts, outputPorts, type ErrorPolicy, type PortInfo } from '@dataflow/core';

export type ComponentData = {
  type: string;
  config: Record<string, unknown>;
  /** skipped in runs (shown faded, the name struck through) */
  disabled?: boolean;
  /** pinned output: the envelopes per port it sends in test runs instead of executing (what the Data tab showed) */
  pinned?: Record<string, EnvelopeData[]>;
  /** its name on the canvas (empty: the component's own, like Mapper) */
  label?: string;
  /** the key it writes in the envelope (empty: the component's default) */
  outputKey?: string;
  /** what it produces replaces the envelope's DATA (a component with Override) */
  override?: boolean;
  /** free notes (the window's Notes tab) */
  notes?: string;
};

export type ComponentNode = Node<ComponentData, 'component'>;

/**
 * MOCK of the On error choice (config.onError, read by the core's errorPolicy): what an envelope that fails in the
 * component does. Throw (the default) stops the run; Continue lets the envelope go on as it came in;
 * Divert sends it out through the error port, a red bump under the card. The port itself comes from the core (errorPort).
 */
export type OnError = ErrorPolicy;


const onErrorOf = (data: ComponentData): OnError => (data.config.onError === 'continue' || data.config.onError === 'divert' ? data.config.onError : 'throw');

/** the strip a side grows when its ports go below the card */
const EXTENSION_WIDTH = 28;

/**
 * A component on the canvas: its icon and name in the category's color, inputs on the left and outputs on the right
 * (from @dataflow/core), with their names when they have one. Every card has the same size: with more than one port
 * on a side (Lookup's input and lookup, Filter's true/false, a Router's cases), only that side grows down, as a strip under the
 * card holding the ports. No configuration yet.
 */
function ComponentNodeView({ id, data, selected }: NodeProps<ComponentNode>) {
  const info = componentInfo(data.type);
  const incoming = useNodeConnections({ handleType: 'target' });
  const outgoing = useNodeConnections({ handleType: 'source' });
  const hover = useHover();
  const [infoOpen, setInfoOpen] = useState(false);
  // the last run on this component: a spinner while it runs, then its status and the envelopes per port
  const mark = useRunMark(id);
  const run = mark?.run;
  // it ran in this run: its counts show
  const ran = run !== undefined && run.status !== 'not-run' && run.status !== 'skipped';
  const failed = run?.status === 'failed' || run?.status === 'with-errors';
  const closeInfo = useCallback(() => setInfoOpen(false), []);
  const updateNodeInternals = useUpdateNodeInternals();
  const inputCount = inputPorts(data.type, data.config).length;
  const outputCount = outputPorts(data.type, data.config).length;
  const hasErrorPort = errorPort(data.type, data.config) !== undefined;
  // a port that appears or goes (the error port on Divert, a Router's case) must be measured again, or React Flow
  // neither starts an edge from it nor draws the ones it has
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, inputCount, outputCount, hasErrorPort, updateNodeInternals]);
  if (!info) {
    return <div className="rounded-lg border border-destructive bg-card px-3 py-2 text-sm text-destructive">Unknown component {data.type}</div>;
  }

  const inputs = inputPorts(data.type, data.config);
  const outputs = outputPorts(data.type, data.config);
  const color = CATEGORIES[info.category].color;
  const onError = isFixedType(data.type) ? 'throw' : onErrorOf(data);
  // the Start shows what it is set with: an input, its parameters
  const start = data.type === START ? startConfig(data.config) : undefined;
  const parameterCount = start?.parameters.length ?? 0;

  // the bar is a NodeToolbar: outside the card (a disabled node fades, its buttons do not) and outside the zoom
  return (
    <>
      {/* Start and End are not run on their own: no Bypass, Run from here or Pin (the Start has only the eye) */}
      {(!isFixedType(data.type) || start) && (
        <NodeActions
          id={id}
          data={data}
          visible={hover.on}
          hoverProps={hover.props}
          infoOpen={infoOpen}
          onlyInfo={!!start}
          onInfo={() => setInfoOpen(open => !open)}
        />
      )}
      {infoOpen && <InfoPanel data={data} onClose={closeInfo} />}
      <div {...hover.props} style={{ '--category': color, width: CARD_WIDTH - SIDE_GAP } as CSSProperties} className={cn('relative transition-opacity', data.disabled && 'opacity-50')}>
        <Plate inputs={inputs.length} outputs={outputs.length} errorPort={hasErrorPort} selected={selected} failed={failed} fixed={isFixedType(data.type)} />
        {mark && <RunBadge running={mark.running} run={run} />}
        {/* what is set on the node (Continue, pinned), above it where the bar appears, in the plain color (the bar's
            buttons are the colored ones): the bar covers it on hover and the name keeps the whole card */}
        {(onError === 'continue' || data.pinned || start?.acceptsInput || parameterCount > 0) && (
          <div className="pointer-events-none absolute bottom-full left-1 mb-1 flex items-center gap-1 px-1">
            {data.pinned && (
              <Pin role="img" aria-label="Output pinned" className="size-3.5 rotate-45 text-muted-foreground">
                <title>Output pinned</title>
              </Pin>
            )}
            {start?.acceptsInput && (
              <LogIn role="img" aria-label="Accepts input" className="size-3.5 text-muted-foreground">
                <title>{start.testInput.trim() ? 'Accepts input (default input set)' : 'Accepts input'}</title>
              </LogIn>
            )}
            {parameterCount > 0 && (
              // a tooltip by attribute: a <title> outside an svg would become the page's title (React hoists it)
              <span
                role="img"
                aria-label={`${parameterCount} parameter${parameterCount === 1 ? '' : 's'}`}
                title={`${parameterCount} parameter${parameterCount === 1 ? '' : 's'}`}
                className="flex items-center gap-0.5 text-muted-foreground"
              >
                <SlidersHorizontal className="size-3.5" aria-hidden />
                <span className="font-mono text-[10px] leading-none font-medium">{parameterCount}</span>
              </span>
            )}
            {onError === 'continue' && (
              <SkipForward role="img" aria-label="On error: continue" className="size-3.5 text-muted-foreground">
                <title>On error: continue (the envelope goes on as it came in)</title>
              </SkipForward>
            )}
          </div>
        )}
        <div style={{ height: CARD_HEIGHT }} className="relative flex items-center text-card-foreground">
          <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
            <info.icon className="size-4 shrink-0" style={{ color }} />
            <span className={cn('line-clamp-2 text-xs leading-tight font-medium break-words', data.disabled && 'line-through')}>{data.label?.trim() || info.label}</span>
          </div>

          {inputs.map((port, i) => (
            <PortHandle key={port.id} port={port} kind="target" style={{ top: portTop(i) }} edges={incoming.filter(c => c.targetHandle === port.id).length} />
          ))}
          {outputs.map((port, i) => (
            <PortHandle
              key={port.id}
              port={port}
              kind="source"
              style={{ top: portTop(i) }}
              edges={outgoing.filter(c => c.sourceHandle === port.id).length}
              envelopes={ran ? (run.outputs[port.id] ?? 0) : undefined}
              onShow={() => mark?.show(port.id)}
            />
          ))}
          {/* Divert: the error port, a red bump under the card (what fails goes out through it) */}
          {hasErrorPort && (
            <Handle
              id={ERROR_PORT}
              type="source"
              position={Position.Bottom}
              aria-label="Error output"
              title="Error output: the envelopes that fail go out here"
              className={cn('node-port node-port-error', outgoing.some(c => c.sourceHandle === ERROR_PORT) && 'is-connected')}
            >
              <span className="node-port-dot" aria-hidden />
            </Handle>
          )}
          {/* after a run: the envelopes that went out through the error port, beside its bump (the badge is on the right) */}
          {hasErrorPort && ran && (
            <EnvelopeCount
              count={run.outputs[ERROR_PORT] ?? 0}
              onShow={() => mark?.show(ERROR_PORT)}
              className="top-full left-[calc(50%+22px)] mt-0.5"
              tone="error"
            />
          )}
        </div>
      </div>
    </>
  );
}

/** a 1px line around a shape, drawn by four drop shadows (a CSS outline would follow each box, not the whole shape) */
const outline = (color: string) => ['1px 0', '-1px 0', '0 1px', '0 -1px'].map(offset => `drop-shadow(${offset} 0 ${color})`).join(' ');

/** the input hole's radius and the output bump's size (as in the PoC) */
const HOLE_RADIUS = 16;
const BUMP_WIDTH = 16;
/** the error port's bump, hanging under the card's middle (as in the PoC) */
const ERROR_BUMP = { width: 32, height: 17 };

/** the plate's mask: the card minus a half circle "bitten" out of its left edge at each input */
function inputHoles(inputs: number): CSSProperties {
  if (inputs === 0) {
    return {};
  }

  const holes = Array.from({ length: inputs }, (_, i) =>
    `radial-gradient(circle ${HOLE_RADIUS}px at -1px ${portTop(i)}px, transparent ${HOLE_RADIUS - 0.5}px, #000 ${HOLE_RADIUS}px)`,
  ).join(', ');
  return { maskImage: holes, maskComposite: 'intersect', WebkitMaskImage: holes, WebkitMaskComposite: 'source-in' } as CSSProperties;
}

/**
 * The card's body, one piece: the card; on a side with more than one port, the strip that goes down holding them; a
 * bump out of the right edge at each output and a hole bitten into the left edge at each input (the PoC's ports). The
 * pieces have no borders of their own; the line around (--node-outline, none in light) and the shadow are drawn on the
 * whole shape, so there is no seam and the holes and bumps get the same line. Selected, it takes the category's color.
 */
function Plate(props: { inputs: number; outputs: number; errorPort: boolean; selected: boolean; failed?: boolean; fixed?: boolean }) {
  const { inputs, outputs, errorPort, selected, failed, fixed } = props;
  // Start and End: a slightly different plate, so the flow's ends stand out from its components
  const fill = fixed ? 'bg-[var(--node-fixed)]' : 'bg-card';
  const strip = (ports: number) => ({ width: EXTENSION_WIDTH, height: portTop(ports - 1) + CARD_HEIGHT / 2 });
  const height = Math.max(portTop(Math.max(inputs, outputs, 1) - 1) + CARD_HEIGHT / 2, errorPort ? CARD_HEIGHT + ERROR_BUMP.height : 0);
  // failed in the last run: a red line around it
  const line = failed ? 'var(--destructive)' : selected ? 'var(--category)' : 'var(--node-outline)';
  const filter = `${outline(line)} drop-shadow(0 1px 2px rgb(0 0 0 / ${selected ? 0.18 : 0.1}))`;

  return (
    <div aria-hidden className="pointer-events-none absolute top-0 left-0" style={{ filter, height, width: `calc(100% + ${BUMP_WIDTH}px)` }}>
      {/* the mask is on this inner layer, so the line of the filter above also follows the holes */}
      <div className="absolute inset-0" style={inputHoles(inputs)}>
        <div className={`absolute top-0 left-0 rounded-xl ${fill}`} style={{ height: CARD_HEIGHT, width: `calc(100% - ${BUMP_WIDTH}px)` }} />
        {inputs > 1 && <div className={`absolute top-0 left-0 rounded-xl ${fill}`} style={strip(inputs)} />}
        {outputs > 1 && <div className={`absolute top-0 rounded-xl ${fill}`} style={{ ...strip(outputs), right: BUMP_WIDTH }} />}
        {errorPort && (
          <div
            className={`absolute rounded-b-full ${fill}`}
            style={{ top: CARD_HEIGHT - 1, left: `calc((100% - ${BUMP_WIDTH}px) / 2 - ${ERROR_BUMP.width / 2}px)`, ...ERROR_BUMP }}
          />
        )}
        {Array.from({ length: outputs }, (_, i) => (
          <div
            key={i}
            className={`absolute rounded-r-full ${fill}`}
            style={{ top: portTop(i) - HOLE_RADIUS, right: 1, width: BUMP_WIDTH, height: HOLE_RADIUS * 2 }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * a port: the dot inside the input's hole or the output's bump (the hole and the bump are the plate's); an output with
 * several edges shows how many under it (2x, 3x)
 */
function PortHandle(props: { port: PortInfo; kind: 'source' | 'target'; style: CSSProperties; edges: number; envelopes?: number; onShow?: () => void }) {
  const { port, kind, style, edges, envelopes, onShow } = props;
  const input = kind === 'target';
  const connected = edges > 0;
  return (
    <>
      <Handle
        id={port.id}
        type={kind}
        position={input ? Position.Left : Position.Right}
        style={style}
        aria-label={port.label ? `${input ? 'Input' : 'Output'} ${port.label}` : input ? 'Input' : 'Output'}
        className={cn('node-port', input ? 'node-port-in' : 'node-port-out', connected && 'is-connected', port.optional && 'is-optional')}
      >
        <span className="node-port-dot" aria-hidden />
      </Handle>
      {port.label && (
        <span
          aria-hidden
          style={style}
          className={cn(
            'pointer-events-none absolute -translate-y-[calc(100%+4px)] font-mono text-[10px] whitespace-nowrap text-muted-foreground',
            input ? 'right-[calc(100%+6px)]' : 'left-[calc(100%+20px)]',
          )}
        >
          {port.label}
        </span>
      )}
      {!input && edges > 1 && (
        <span
          style={style}
          title={`Goes to ${edges} components (each gets its own copy)`}
          className="pointer-events-none absolute left-[calc(100%+20px)] translate-y-[3px] rounded-sm bg-muted px-1 font-mono text-[10px] leading-4 font-medium text-muted-foreground"
        >
          {edges}x
        </span>
      )}
      {/* after a run: how many envelopes went out through it, inside the card next to the port (outside it would sit on
          the next component, glued to this one) */}
      {!input && envelopes !== undefined && (
        <EnvelopeCount style={style} count={envelopes} onShow={onShow} className="right-1.5 -translate-y-1/2" tone="ok" />
      )}
    </>
  );
}

/**
 * how many envelopes went out through a port in the last run; a click shows them (the run's Data tab, that port). It is
 * a button of its own: pressing it neither drags the card nor starts an edge
 */
export function EnvelopeCount(props: { count: number; onShow?: () => void; className?: string; style?: CSSProperties; tone: 'ok' | 'error' }) {
  const { count, onShow, className, style, tone } = props;
  const text = `Show ${count} envelope${count === 1 ? '' : 's'}`;
  return (
    <button
      type="button"
      style={style}
      title={text}
      aria-label={text}
      onPointerDown={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        onShow?.();
      }}
      className={cn(
        'nodrag nopan absolute z-10 cursor-pointer rounded px-1.5 font-mono text-xs leading-5 font-semibold hover:ring-1 hover:ring-current',
        count === 0 ? 'bg-muted text-muted-foreground' : tone === 'error' ? 'bg-destructive/15 text-destructive' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
        className,
      )}
    >
      {count}
    </button>
  );
}

/** the component's status in the last run, on its bottom right corner (the top is the hover bar's) */
function RunBadge({ running, run }: { running: boolean; run?: ComponentRun }) {
  // while the run goes on: a spinner on what is running, a faint circle on what has not started (all of them while
  // the run waits for a worker)
  const [Icon, color, text] = run?.status === 'running'
    ? [LoaderCircle, 'text-muted-foreground animate-spin', 'Running']
    : !run || run.status === 'not-run'
      ? running
        ? [Circle, 'text-muted-foreground/50', 'Waiting']
        : [CircleMinus, 'text-muted-foreground', 'Not run']
      : run.status === 'completed'
        ? [CircleCheck, 'text-emerald-600 dark:text-emerald-400', 'Completed']
        : run.status === 'pinned'
          ? [Pin, 'text-blue-600 dark:text-blue-400', 'Pinned output']
          : run.status === 'skipped'
            ? [CircleDashed, 'text-muted-foreground', 'Skipped: it only feeds pinned components']
          : run.status === 'disabled'
            ? [Power, 'text-muted-foreground', 'Bypassed']
            : run.status === 'with-warnings'
              ? [CircleAlert, 'text-amber-600 dark:text-amber-400', 'With warnings']
              : [CircleX, 'text-destructive', run.status === 'failed' ? 'Failed' : 'With errors'];
  return (
    <span role="img" aria-label={text} title={text} className="pointer-events-none absolute right-1 z-10 flex size-4 -translate-y-1/2 items-center justify-center rounded-full bg-card"
      style={{ top: CARD_HEIGHT }}>
      <Icon className={cn('size-4', color)} aria-hidden />
    </span>
  );
}

/**
 * Over the card or its bar. Leaving waits a moment, so the pointer can cross the gap between them (and the bar does not
 * flicker).
 */
function useHover() {
  const [on, setOn] = useState(false);
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined);
  const props = {
    onMouseEnter: () => {
      clearTimeout(leaving.current);
      setOn(true);
    },
    onMouseLeave: () => {
      leaving.current = setTimeout(() => setOn(false), 120);
    },
  };

  return { on, props };
}
/**
 * The node's buttons, in a small bar right above it (in the PoC they sat next to the name): Bypass (Enable), Run from here,
 * Pin output, and On error (Throw / Continue / Divert). MOCK: they only change the node; Run from here only shows it
 * running for a moment. Leaving Divert removes the edges of the error port.
 */
function NodeActions(props: {
  id: string;
  data: ComponentData;
  visible: boolean;
  hoverProps: ReturnType<typeof useHover>['props'];
  infoOpen: boolean;
  /** only the eye (the Start) */
  onlyInfo?: boolean;
  onInfo: () => void;
}) {
  const { id, data, visible, hoverProps } = props;
  // Run from here and Pin output come after a run, by what went in and out of this component (run-marks.ts)
  const mark = useRunMark(id);
  // a component without outputs (Discard) has nothing to pin, nothing after it to run, no error to divert
  const hasOutputs = outputPorts(data.type, data.config).length > 0;
  const actions = runActions(mark?.running ? undefined : mark?.run, Boolean(data.pinned));
  // Run from here starts from the last full test run: it is offered by what reached the component there
  const fromFull = runActions(mark?.running ? undefined : mark?.full, false);
  const offers = { pin: hasOutputs && actions.pin, runFromHere: hasOutputs && fromFull.runFromHere };
  const { updateNodeData, setEdges } = useReactFlow<ComponentNode>();
  const { record } = useHistory();
  const onError = onErrorOf(data);
  const setOnError = (next: OnError) => {
    if (next === onError) {
      return;
    }

    record();
    if (next !== 'divert') {
      setEdges(edges => edges.filter(e => !(e.source === id && e.sourceHandle === ERROR_PORT)));
    }

    updateNodeData(id, { config: { ...data.config, onError: next } });
  };
  // a run going on: Run from here waits for it
  const running = mark?.running ?? false;
  const change = (changes: Partial<ComponentData>) => {
    record();
    updateNodeData(id, changes);
  };

  // a test run of this component and what follows it, from what reached it in the last run
  const runFromHere = () => mark?.runFrom();

  // NodeToolbar is drawn outside the canvas' zoom: the bar keeps its size at any zoom, right above the card's left
  return (
    <NodeToolbar isVisible={visible} position={Position.Top} align="start" offset={4} {...hoverProps}>
      <div className="flex items-center gap-0.5 rounded-md border bg-card/90 p-0.5 shadow-xs">
        {!props.onlyInfo && (
          <>
            <ActionButton
              label={data.disabled ? 'Enable' : 'Bypass'}
              pressed={data.disabled ?? false}
              className={data.disabled ? 'text-destructive' : undefined}
              onClick={() => change({ disabled: !data.disabled })}
            >
              <Power />
            </ActionButton>
            {offers.runFromHere && (
              <ActionButton label="Run from here" disabled={running || data.disabled} onClick={runFromHere}>
                {running ? <LoaderCircle className="animate-spin" /> : <Play />}
              </ActionButton>
            )}
            {offers.pin && (
              <ActionButton
                label={data.pinned ? 'Unpin output' : 'Pin output'}
                pressed={Boolean(data.pinned)}
                className={data.pinned ? 'text-blue-600 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-400' : undefined}
                // pinned: what went out of it in the last run, as the Data tab shows it
                onClick={() => change({ pinned: data.pinned ? undefined : pinnedOutput(mark?.run) })}
              >
                <Pin className={cn('transition-transform', data.pinned && 'rotate-45')} />
              </ActionButton>
            )}
            {hasOutputs && (
              <>
                <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
                <div role="radiogroup" aria-label="On error" className="flex items-center gap-0.5">
                  {ON_ERROR.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={option.value === onError}
                      aria-label={`On error: ${option.label}`}
                      title={`On error: ${option.label}. ${option.hint}`}
                      onClick={() => setOnError(option.value)}
                      className={cn(
                        'flex size-5 items-center justify-center rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3',
                        option.value !== onError && 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        option.value === onError && option.active,
                      )}
                    >
                      <option.icon aria-hidden />
                    </button>
                  ))}
                </div>
              </>
            )}
            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          </>
        )}
        <ActionButton
          label={props.infoOpen ? 'Hide details' : 'Show details'}
          pressed={props.infoOpen}
          className={props.infoOpen ? 'bg-accent text-foreground' : undefined}
          onClick={props.onInfo}
        >
          <Eye />
        </ActionButton>
      </div>
    </NodeToolbar>
  );
}

/** the On error choices, in the bar: the core's values (ErrorPolicy), in this order */
const ON_ERROR: { value: OnError; label: string; icon: LucideIcon; hint: string; active: string }[] = [
  { value: 'throw', label: 'Throw', icon: OctagonX, hint: 'The run stops (default)', active: 'bg-accent text-foreground' },
  { value: 'continue', label: 'Continue', icon: SkipForward, hint: 'The envelope goes on as it came in', active: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  { value: 'divert', label: 'Divert', icon: CornerDownRight, hint: 'The envelope goes out through the error port', active: 'bg-destructive/15 text-destructive' },
];

function ActionButton(props: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        'flex size-5 items-center justify-center rounded text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3',
        props.className,
      )}
    >
      {props.children}
    </button>
  );
}

/**
 * The eye's panel: what the component does, read from its config by the core (componentSummary), right under the card
 * and outside the zoom. Several can be open. It stays open while the card moves (it follows it) and
 * closes with the eye, its X or Esc.
 */
function InfoPanel({ data, onClose }: { data: ComponentData; onClose: () => void }) {
  const info = componentInfo(data.type);
  const resources = useProjectResources();
  const sections = componentSummary(data.type, data.config, nameIn(resources));
  const notes = data.notes?.trim();
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  return (
    <NodeToolbar isVisible position={Position.Bottom} align="start" offset={12}>
      <div
        role="dialog"
        aria-label={`Details: ${data.label?.trim() || info?.label || data.type}`}
        className="nowheel w-72 rounded-md border bg-card text-card-foreground shadow-md"
      >
        <div className="flex items-center gap-2 border-b px-2 py-1.5">
          {info && <info.icon className="size-3.5 shrink-0" style={{ color: CATEGORIES[info.category].color }} />}
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{data.label?.trim() || info?.label || data.type}</span>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3"
          >
            <X />
          </button>
        </div>
        <div className="max-h-80 space-y-2 overflow-auto p-2 text-xs">
          {sections.length === 0 && !notes && <p className="text-muted-foreground italic">Not set yet</p>}
          {sections.map(section => (
            <section key={section.title} className="space-y-1">
              <h4 className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{section.title}</h4>
              {section.lines.map((line, i) => (
                <div key={i} className="flex min-w-0 gap-2">
                  {line.label && <span className="shrink-0 font-mono text-muted-foreground">{asText(line.label)}</span>}
                  {/* always text (the core's summary gives text; anything else is shown as JSON, never rendered as an object) */}
                  <span className={cn('min-w-0 break-words whitespace-pre-wrap', line.code && 'font-mono')}>{asText(line.value)}</span>
                </div>
              ))}
            </section>
          ))}
          {notes && (
            <section className="space-y-1">
              <h4 className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Notes</h4>
              <p className="break-words whitespace-pre-wrap">{notes}</p>
            </section>
          )}
        </div>
      </div>
    </NodeToolbar>
  );
}

/** a summary value as text, whatever it is */
const asText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value) ?? '');

export const ComponentNodeMemo = memo(ComponentNodeView);