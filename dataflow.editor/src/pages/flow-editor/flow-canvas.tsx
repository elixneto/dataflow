import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  addEdge,
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  SelectionMode,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type FitViewOptions,
  type ReactFlowInstance,
  type XYPosition,
} from '@xyflow/react';
import { Network, Redo2, SquareDashed, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import '@xyflow/react/dist/style.css';
import { connectionProblem, END, START } from '@dataflow/core';
import { arrange } from '@/editor/arrange';
import { fittedConnections } from '@/editor/auto-connect';
import { CATEGORIES, componentInfo } from '@/editor/catalog';
import { ComponentNodeMemo, type ComponentNode } from '@/editor/component-node';
import { COMPONENT_DRAG_TYPE } from '@/editor/drag';
import { canSplice, edgeUnder, pointerBox, splice } from '@/editor/edge-splice';
import { GROUP_COLORS, GROUP_SIZE, GROUP_Z, layerGroups, type GroupNode } from '@/editor/group';
import { GroupNodeMemo } from '@/editor/group-node';
import { HistoryContext, isEditableField, UndoStack } from '@/editor/history';
import { CARD_WIDTH } from '@/editor/node-geometry';
import { ComponentPalette } from './component-palette';
import { ZoomControls } from './zoom-controls';

/** the grid: a small dot every DOT_GAP px (--grid on --canvas in index.css) */
const DOT_GAP = 16;
const DOT_SIZE = 1.5;

const NODE_TYPES = { component: ComponentNodeMemo, group: GroupNodeMemo };

/** what the canvas holds: components, and groups behind them */
type FlowNode = ComponentNode | GroupNode;

const isComponent = (node: FlowNode): node is ComponentNode => node.type === 'component';

/** what Ctrl+Z goes back to */
type Snapshot = { nodes: FlowNode[]; edges: Edge[] };

/** on the minimap each component in its category's color, a group as a tint of its own */
const minimapColor = (node: FlowNode) => {
  if (!isComponent(node)) {
    return `color-mix(in oklch, ${node.data.color} 25%, transparent)`;
  }

  const info = componentInfo(node.data.type);
  return info ? CATEGORIES[info.category].color : 'var(--muted-foreground)';
};


/** what fits the flow on screen: room on the left for the components panel, never past 100% */
const FIT_VIEW: FitViewOptions = { maxZoom: 1, padding: { top: '96px', right: '64px', bottom: '96px', left: '320px' } };

/** a new flow: its Start and End, as in the PoC (they cannot be deleted; the canvas has nothing else to begin with) */
const FIXED_NODES: ComponentNode[] = [
  { id: START, type: 'component', position: { x: 0, y: 0 }, deletable: false, data: { type: START, config: {} } },
  { id: END, type: 'component', position: { x: 4 * CARD_WIDTH, y: 0 }, deletable: false, data: { type: END, config: {} } },
];

/**
 * The flow's canvas: the dotted grid, the floating components panel, and the components dragged from it. Ports connect
 * output → input (the core's rules); a new component dropped from the palette on an edge goes into it; Delete or
 * Backspace removes what is selected. Pan with the middle/right
 * button or the scroll, zoom with Ctrl + scroll. Not saved yet: the flow's definition comes with the backend.
 */
export function FlowCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(FIXED_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [flow, setFlow] = useState<ReactFlowInstance<FlowNode, Edge> | null>(null);
  // a smaller group above a bigger one, so a group inside another can be clicked
  const shownNodes = useMemo(() => layerGroups(nodes), [nodes]);

  // ---- Ctrl+Z / Ctrl+Y (editor/history.ts): each change saves the canvas first
  const [stack] = useState(() => new UndoStack<Snapshot>());
  const [steps, setSteps] = useState({ undo: false, redo: false });
  const synced = useCallback(() => setSteps({ undo: stack.canUndo, redo: stack.canRedo }), [stack]);
  const snapshot = useCallback((): Snapshot => ({ nodes: flow?.getNodes() ?? nodes, edges: flow?.getEdges() ?? edges }), [flow, nodes, edges]);
  const record = useCallback(() => {
    stack.record(snapshot());
    synced();
  }, [stack, snapshot, synced]);
  const recordEdit = useCallback(
    (key: string) => {
      stack.recordEdit(snapshot(), key);
      synced();
    },
    [stack, snapshot, synced],
  );
  const restore = useCallback(
    (state: Snapshot | undefined) => {
      if (state) {
        setNodes(state.nodes);
        setEdges(state.edges);
      }

      synced();
    },
    [setNodes, setEdges, synced],
  );
  const undo = useCallback(() => restore(stack.undo(snapshot())), [restore, stack, snapshot]);
  const redo = useCallback(() => restore(stack.redo(snapshot())), [restore, stack, snapshot]);
  const history = useMemo(() => ({ record, recordEdit }), [record, recordEdit]);

  // Ctrl+Z undoes; Ctrl+Y or Ctrl+Shift+Z redoes (Cmd on a Mac); typing in a field keeps the field's own undo
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || isEditableField(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const onConnect = useCallback(
    (connection: Connection) => {
      record();
      setEdges(current => addEdge(connection, current));
    },
    [record, setEdges],
  );

  // who may connect to what is the core's rule (connectionProblem): one edge per port but the Start's output and the
  // End's input, never Start straight to End, never the same two ports twice
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const typeOf = (id: string) => {
        const node = flow?.getNode(id) ?? nodes.find(n => n.id === id);
        return node && isComponent(node) ? node.data.type : undefined;
      };
      const asPorts = (e: Connection | Edge) => ({ source: e.source, sourcePort: e.sourceHandle ?? '', target: e.target, targetPort: e.targetHandle ?? '' });
      return !connectionProblem(asPorts(connection), edges.map(asPorts), typeOf);
    },
    [edges, flow, nodes],
  );

  // a card dropped with a port fitted on another card's free output (bump in hole) connects to it (editor/auto-connect.ts)
  const connectFitted = useCallback(
    (moved: FlowNode[], all: FlowNode[]) =>
      setEdges(current => {
        let next = current;
        for (const node of moved.filter(isComponent)) {
          for (const connection of fittedConnections(node, all.filter(isComponent), next)) {
            next = addEdge(connection, next);
          }
        }

        return next;
      }),
    [setEdges],
  );

  // ---- drop on an edge (editor/edge-splice.ts): only a NEW component, dragged from the palette. The edge under the
  // pointer is highlighted and the component dropped there goes into it; moving a component already on the canvas over
  // an edge does neither
  const [spliceEdge, setSpliceEdge] = useState<string | null>(null);
  const shownEdges = useMemo(
    () =>
      edges.map(e => {
        // an edge out of an error port (On error = Divert) is red; the one a new component would go into, highlighted
        const className = [e.sourceHandle === 'error' && 'is-error-edge', e.id === spliceEdge && 'is-splice-target'].filter(Boolean).join(' ');
        return className ? { ...e, className } : e;
      }),
    [edges, spliceEdge],
  );
  const typeOfNode = useCallback(
    (id: string) => {
      const node = flow?.getNode(id) ?? nodes.find(n => n.id === id);
      return node && isComponent(node) ? node.data.type : undefined;
    },
    [flow, nodes],
  );
  const edgeAt = (clientX: number, clientY: number, nodeId?: string) =>
    flow ? edgeUnder(pointerBox(flow.screenToFlowPosition({ x: clientX, y: clientY })), edges, nodeId) : undefined;
  const spliceInto = (edge: Edge | undefined, node: ComponentNode) => {
    if (edge && canSplice(node, edges)) {
      setEdges(current => splice(current, edge, node.id, typeOfNode) ?? current);
    }
  };

  const onDragOver = (event: DragEvent) => {
    if (event.dataTransfer.types.includes(COMPONENT_DRAG_TYPE)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      const id = edgeAt(event.clientX, event.clientY)?.id ?? null;
      if (id !== spliceEdge) {
        setSpliceEdge(id);
      }
    }
  };

  const onDrop = (event: DragEvent) => {
    const type = event.dataTransfer.getData(COMPONENT_DRAG_TYPE);
    if (!type || !flow) {
      return;
    }

    event.preventDefault();
    record();
    const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    // the pointer at the card's left middle, snapped to the grid
    const node: ComponentNode = {
      id: crypto.randomUUID(),
      type: 'component',
      position: { x: Math.round(position.x / DOT_GAP) * DOT_GAP, y: Math.round((position.y - 32) / DOT_GAP) * DOT_GAP },
      data: { type, config: {} },
      selected: true,
    };
    setNodes(current => [...current.map(n => ({ ...n, selected: false })), node]);
    setSpliceEdge(null);
    // on an edge: goes into it; elsewhere: snap-to-connect if it fits next to a card
    const edge = edgeAt(event.clientX, event.clientY);
    if (edge && canSplice(node, edges)) {
      spliceInto(edge, node);
    } else {
      connectFitted([node], nodes);
    }
  };

  // a new group in the middle of what is on screen, behind everything, with the next color of the list
  const addGroup = () => {
    if (!flow) {
      return;
    }

    const box = document.querySelector('.react-flow')?.getBoundingClientRect();
    const center = box ? flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 }) : { x: 0, y: 0 };
    record();
    const snap = (value: number) => Math.round(value / DOT_GAP) * DOT_GAP;
    const group: GroupNode = {
      id: crypto.randomUUID(),
      type: 'group',
      selected: true,
      zIndex: GROUP_Z,
      ...GROUP_SIZE,
      position: { x: snap(center.x - GROUP_SIZE.width / 2), y: snap(center.y - GROUP_SIZE.height / 2) },
      data: { title: '', color: GROUP_COLORS[nodes.filter(n => n.type === 'group').length % GROUP_COLORS.length]! },
    };
    setNodes(current => [group, ...current.map(n => ({ ...n, selected: false }))]);
  };

  // Arrange: the components left to right, glued (editor/arrange.ts), then the whole flow on screen
  const arrangeFlow = () => {
    record();
    setNodes(current => arrange(current, edges));
    window.setTimeout(() => void flow?.fitView({ ...FIT_VIEW, duration: 200 }), 0);
  };

  // dragging a group takes along what is entirely inside it (and not selected: those move by themselves)
  const groupDrag = useRef<{ id: string; start: XYPosition; inside: Map<string, XYPosition> } | null>(null);

  const onNodeDragStart = (_: unknown, node: FlowNode) => {
    record();
    groupDrag.current = null;
    if (node.type !== 'group') {
      return;
    }

    const width = node.measured?.width ?? node.width ?? 0;
    const height = node.measured?.height ?? node.height ?? 0;
    const inside = new Map<string, XYPosition>();
    for (const other of flow?.getNodes() ?? nodes) {
      const w = other.measured?.width ?? 0;
      const h = other.measured?.height ?? 0;
      const within =
        other.position.x >= node.position.x &&
        other.position.y >= node.position.y &&
        other.position.x + w <= node.position.x + width &&
        other.position.y + h <= node.position.y + height;
      if (other.id !== node.id && !other.selected && within) {
        inside.set(other.id, other.position);
      }
    }

    groupDrag.current = { id: node.id, start: node.position, inside };
  };

  const onNodeDrag = (_: unknown, node: FlowNode) => {
    const drag = groupDrag.current;
    if (!drag || drag.id !== node.id || drag.inside.size === 0) {
      return;
    }

    const dx = node.position.x - drag.start.x;
    const dy = node.position.y - drag.start.y;
    setNodes(current =>
      current.map(n => {
        const start = drag.inside.get(n.id);
        return start ? { ...n, position: { x: start.x + dx, y: start.y + dy } } : n;
      }),
    );
  };

  return (
    <HistoryContext.Provider value={history}>
    <ReactFlow
      nodes={shownNodes}
      edges={shownEdges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onInit={setFlow}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={event => !event.currentTarget.contains(event.relatedTarget as Node | null) && setSpliceEdge(null)}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={(_, __, moved) => connectFitted(moved, flow?.getNodes() ?? nodes)}
      onSelectionDragStart={record}
      onBeforeDelete={async () => {
        record();
        return true;
      }}
      onNodeDrag={onNodeDrag}
      // opens with the whole flow on screen (Start and End at first), never zoomed past 100%, clear of the palette
      fitView
      fitViewOptions={FIT_VIEW}
      snapToGrid
      snapGrid={[DOT_GAP, DOT_GAP]}
      deleteKeyCode={['Delete', 'Backspace']}
      selectionOnDrag
      selectionMode={SelectionMode.Partial}
      multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
      elevateNodesOnSelect={false}
      panOnDrag={[1, 2]}
      panOnScroll
      zoomActivationKeyCode={['Meta', 'Control']}
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={DOT_GAP} size={DOT_SIZE} color="var(--grid)" />
      <ComponentPalette />
      <Panel position="top-right" className="nopan nowheel nodrag flex gap-2" style={{ margin: 12 }}>
        <div className="flex rounded-md bg-card shadow-md">
          <Button variant="outline" size="icon-sm" className="rounded-r-none" disabled={!steps.undo} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo">
            <Undo2 />
          </Button>
          <Button variant="outline" size="icon-sm" className="-ml-px rounded-l-none" disabled={!steps.redo} onClick={redo} title="Redo (Ctrl+Y)" aria-label="Redo">
            <Redo2 />
          </Button>
        </div>
        <Button variant="outline" size="sm" className="bg-card shadow-md" onClick={arrangeFlow} title="Arrange from left to right, the cards glued">
          <Network className="-rotate-90" /> Arrange
        </Button>
        <Button variant="outline" size="sm" className="bg-card shadow-md" onClick={addGroup} title="Group: a colored rectangle behind the components">
          <SquareDashed /> Group
        </Button>
      </Panel>
      <ZoomControls />
      {/* the whole flow in small, bottom right: drag on it to pan, scroll on it to zoom */}
      <MiniMap<FlowNode>
        pannable
        zoomable
        nodeColor={minimapColor}
        nodeBorderRadius={6}
        bgColor="var(--card)"
        maskColor="color-mix(in oklch, var(--canvas) 70%, transparent)"
        className="overflow-hidden rounded-lg border shadow-md"
        ariaLabel="Minimap"
      />
    </ReactFlow>
    </HistoryContext.Provider>
  );
}
