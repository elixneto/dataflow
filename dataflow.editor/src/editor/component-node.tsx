import { memo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Handle, NodeToolbar, Position, useNodeConnections, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import { LoaderCircle, Pin, Play, Power } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CATEGORIES, componentInfo } from './catalog';
import { CARD_HEIGHT, CARD_WIDTH, portTop, SIDE_GAP } from './node-geometry';
import { inputPorts, outputPorts, type Port } from './ports';

export type ComponentData = {
  type: string;
  config: Record<string, unknown>;
  /** skipped in runs (shown faded, the name struck through) */
  disabled?: boolean;
  /** MOCK: the output is pinned (in editor runs it would replay it instead of running) */
  pinned?: boolean;
};

export type ComponentNode = Node<ComponentData, 'component'>;

/** the strip a side grows when its ports go below the card */
const EXTENSION_WIDTH = 28;

/**
 * A component on the canvas: its icon and name in the category's color, inputs on the left and outputs on the right
 * (from @dataflow/core), with their names when they have one. Every card has the same size: with more than one port
 * on a side (Union's inputs, Copy's outputs, Filter's true/false), only that side grows down, as a strip under the
 * card holding the ports. No configuration yet.
 */
function ComponentNodeView({ id, data, selected }: NodeProps<ComponentNode>) {
  const info = componentInfo(data.type);
  const incoming = useNodeConnections({ handleType: 'target' });
  const outgoing = useNodeConnections({ handleType: 'source' });
  const hover = useHover();
  if (!info) {
    return <div className="rounded-lg border border-destructive bg-card px-3 py-2 text-sm text-destructive">Unknown component {data.type}</div>;
  }

  const inputs = inputPorts(data.type, data.config);
  const outputs = outputPorts(data.type, data.config);
  const color = CATEGORIES[info.category].color;

  // the bar is a NodeToolbar: outside the card (a disabled node fades, its buttons do not) and outside the zoom
  return (
    <>
      <NodeActions id={id} data={data} visible={hover.on} hoverProps={hover.props} />
      <div {...hover.props} style={{ '--category': color, width: CARD_WIDTH - SIDE_GAP } as CSSProperties} className={cn('relative transition-opacity', data.disabled && 'opacity-50')}>
        <Plate inputs={inputs.length} outputs={outputs.length} selected={selected} />
        <div style={{ height: CARD_HEIGHT }} className="relative flex items-center text-card-foreground">
          <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
            <info.icon className="size-4 shrink-0" style={{ color }} />
            <span className={cn('line-clamp-2 text-xs leading-tight font-medium break-words', data.disabled && 'line-through')}>{info.label}</span>
            {/* pinned shows on the card too, not only on the bar (which appears on hover) */}
            {data.pinned && (
              <Pin role="img" aria-label="Output pinned" className="ml-auto size-3.5 shrink-0 rotate-45 text-blue-600 dark:text-blue-400">
                <title>Output pinned</title>
              </Pin>
            )}
          </div>

          {inputs.map((port, i) => (
            <PortHandle key={port.id} port={port} kind="target" style={{ top: portTop(i) }} connected={incoming.some(c => c.targetHandle === port.id)} />
          ))}
          {outputs.map((port, i) => (
            <PortHandle key={port.id} port={port} kind="source" style={{ top: portTop(i) }} connected={outgoing.some(c => c.sourceHandle === port.id)} />
          ))}
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
function Plate({ inputs, outputs, selected }: { inputs: number; outputs: number; selected: boolean }) {
  const strip = (ports: number) => ({ width: EXTENSION_WIDTH, height: portTop(ports - 1) + CARD_HEIGHT / 2 });
  const height = portTop(Math.max(inputs, outputs, 1) - 1) + CARD_HEIGHT / 2;
  const filter = `${outline(selected ? 'var(--category)' : 'var(--node-outline)')} drop-shadow(0 1px 2px rgb(0 0 0 / ${selected ? 0.18 : 0.1}))`;

  return (
    <div aria-hidden className="pointer-events-none absolute top-0 left-0" style={{ filter, height, width: `calc(100% + ${BUMP_WIDTH}px)` }}>
      {/* the mask is on this inner layer, so the line of the filter above also follows the holes */}
      <div className="absolute inset-0" style={inputHoles(inputs)}>
        <div className="absolute top-0 left-0 rounded-xl bg-card" style={{ height: CARD_HEIGHT, width: `calc(100% - ${BUMP_WIDTH}px)` }} />
        {inputs > 1 && <div className="absolute top-0 left-0 rounded-xl bg-card" style={strip(inputs)} />}
        {outputs > 1 && <div className="absolute top-0 rounded-xl bg-card" style={{ ...strip(outputs), right: BUMP_WIDTH }} />}
        {Array.from({ length: outputs }, (_, i) => (
          <div
            key={i}
            className="absolute rounded-r-full bg-card"
            style={{ top: portTop(i) - HOLE_RADIUS, right: 1, width: BUMP_WIDTH, height: HOLE_RADIUS * 2 }}
          />
        ))}
      </div>
    </div>
  );
}

/** a port: the dot inside the input's hole or the output's bump (the hole and the bump are the plate's) */
function PortHandle({ port, kind, style, connected }: { port: Port; kind: 'source' | 'target'; style: CSSProperties; connected: boolean }) {
  const input = kind === 'target';
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
            'pointer-events-none absolute -translate-y-[calc(100%+4px)] font-mono text-[10px] text-muted-foreground',
            input ? 'right-[calc(100%+6px)]' : 'left-[calc(100%+20px)]',
          )}
        >
          {port.label}
        </span>
      )}
    </>
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
 * The node's buttons, in a small bar right above it (in the PoC they sat next to the name): Disable, Run from here and
 * Pin output. MOCK: Disable and Pin only change the node; Run from here only shows it running for a moment.
 */
function NodeActions({ id, data, visible, hoverProps }: { id: string; data: ComponentData; visible: boolean; hoverProps: ReturnType<typeof useHover>['props'] }) {
  const { updateNodeData } = useReactFlow<ComponentNode>();
  const [running, setRunning] = useState(false);

  const runFromHere = () => {
    setRunning(true);
    setTimeout(() => setRunning(false), 800);
  };

  // NodeToolbar is drawn outside the canvas' zoom: the bar keeps its size at any zoom, right above the card's left
  return (
    <NodeToolbar isVisible={visible} position={Position.Top} align="start" offset={4} {...hoverProps}>
      <div className="flex items-center gap-0.5 rounded-md border bg-card/90 p-0.5 shadow-xs">
        <ActionButton
          label={data.disabled ? 'Enable' : 'Disable'}
          pressed={data.disabled ?? false}
          className={data.disabled ? 'text-destructive' : undefined}
          onClick={() => updateNodeData(id, { disabled: !data.disabled })}
        >
          <Power />
        </ActionButton>
        <ActionButton label="Run from here" disabled={running || data.disabled} onClick={runFromHere}>
          {running ? <LoaderCircle className="animate-spin" /> : <Play />}
        </ActionButton>
        <ActionButton
          label={data.pinned ? 'Unpin output' : 'Pin output'}
          pressed={data.pinned ?? false}
          className={data.pinned ? 'text-blue-600 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-400' : undefined}
          onClick={() => updateNodeData(id, { pinned: !data.pinned })}
        >
          <Pin className={cn('transition-transform', data.pinned && 'rotate-45')} />
        </ActionButton>
      </div>
    </NodeToolbar>
  );
}

function ActionButton(props: { label: string; pressed?: boolean; disabled?: boolean; className?: string; onClick: () => void; children: ReactNode }) {
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

export const ComponentNodeMemo = memo(ComponentNodeView);