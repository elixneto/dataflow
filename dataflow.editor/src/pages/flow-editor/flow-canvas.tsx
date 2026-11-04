import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react';
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
  type ReactFlowInstance,
  type XYPosition,
} from '@xyflow/react';
import { Network, SquareDashed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import '@xyflow/react/dist/style.css';
import { union } from '@dataflow/core';
import { arrange } from '@/editor/arrange';
import { fittedConnections } from '@/editor/auto-connect';
import { CATEGORIES, componentInfo } from '@/editor/catalog';
import { ComponentNodeMemo, type ComponentNode } from '@/editor/component-node';
import { COMPONENT_DRAG_TYPE } from '@/editor/drag';
import { GROUP_COLORS, GROUP_SIZE, GROUP_Z, layerGroups, type GroupNode } from '@/editor/group';
import { GroupNodeMemo } from '@/editor/group-node';
import { ComponentPalette } from './component-palette';
import { ZoomControls } from './zoom-controls';

/** the grid: a small dot every DOT_GAP px (--grid on --canvas in index.css) */
const DOT_GAP = 16;
const DOT_SIZE = 1.5;

const NODE_TYPES = { component: ComponentNodeMemo, group: GroupNodeMemo };

/** what the canvas holds: components, and groups behind them */
type FlowNode = ComponentNode | GroupNode;

const isComponent = (node: FlowNode): node is ComponentNode => node.type === 'component';

/** on the minimap each component in its category's color, a group as a tint of its own */
const minimapColor = (node: FlowNode) => {
  if (!isComponent(node)) {
    return `color-mix(in oklch, ${node.data.color} 25%, transparent)`;
  }

  const info = componentInfo(node.data.type);
  return info ? CATEGORIES[info.category].color : 'var(--muted-foreground)';
};

/** MOCK: a new Union starts with 5 inputs, to see a side with many ports (the −/+ on the node comes later) */
const initialConfig = (type: string): Record<string, unknown> =>
  type === union.type ? { [union.variableInputs!.key]: 5 } : {};

/**
 * The flow's canvas: the dotted grid, the floating components panel, and the components dragged from it. Ports connect
 * output → input (each input takes one edge); Delete or Backspace removes what is selected. Pan with the middle/right
 * button or the scroll, zoom with Ctrl + scroll. Not saved yet: the flow's definition comes with the backend.
 */
export function FlowCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [flow, setFlow] = useState<ReactFlowInstance<FlowNode, Edge> | null>(null);
  // a smaller group above a bigger one, so a group inside another can be clicked
  const shownNodes = useMemo(() => layerGroups(nodes), [nodes]);

  const onConnect = useCallback((connection: Connection) => setEdges(current => addEdge(connection, current)), [setEdges]);

  // an input takes one edge; an output may feed only one input (to repeat the envelope there is the Copy)
  const isValidConnection = useCallback(
    (connection: Connection | Edge) =>
      connection.source !== connection.target &&
      !edges.some(
        e =>
          (e.target === connection.target && e.targetHandle === connection.targetHandle) ||
          (e.source === connection.source && e.sourceHandle === connection.sourceHandle),
      ),
    [edges],
  );

  // a card dropped with a port fitted on another card's free port (bump in hole) connects to it
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

  const onDragOver = (event: DragEvent) => {
    if (event.dataTransfer.types.includes(COMPONENT_DRAG_TYPE)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDrop = (event: DragEvent) => {
    const type = event.dataTransfer.getData(COMPONENT_DRAG_TYPE);
    if (!type || !flow) {
      return;
    }

    event.preventDefault();
    const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    // the pointer at the card's left middle, snapped to the grid
    const node: ComponentNode = {
      id: crypto.randomUUID(),
      type: 'component',
      position: { x: Math.round(position.x / DOT_GAP) * DOT_GAP, y: Math.round((position.y - 32) / DOT_GAP) * DOT_GAP },
      data: { type, config: initialConfig(type) },
      selected: true,
    };
    setNodes(current => [...current.map(n => ({ ...n, selected: false })), node]);
    connectFitted([node], nodes);
  };

  // a new group in the middle of what is on screen, behind everything, with the next color of the list
  const addGroup = () => {
    if (!flow) {
      return;
    }

    const box = document.querySelector('.react-flow')?.getBoundingClientRect();
    const center = box ? flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 }) : { x: 0, y: 0 };
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
    setNodes(current => arrange(current, edges));
    window.setTimeout(() => void flow?.fitView({ duration: 200, padding: 0.2, maxZoom: 1 }), 0);
  };

  // dragging a group takes along what is entirely inside it (and not selected: those move by themselves)
  const groupDrag = useRef<{ id: string; start: XYPosition; inside: Map<string, XYPosition> } | null>(null);

  const onNodeDragStart = (_: unknown, node: FlowNode) => {
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
    <ReactFlow
      nodes={shownNodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onInit={setFlow}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onNodeDragStart={onNodeDragStart}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={(_, __, moved) => connectFitted(moved, flow?.getNodes() ?? nodes)}
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
  );
}
