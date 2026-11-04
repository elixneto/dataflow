import { useCallback, useState, type DragEvent } from 'react';
import {
  addEdge,
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { union } from '@dataflow/core';
import { fittedConnections } from '@/editor/auto-connect';
import { CATEGORIES, componentInfo } from '@/editor/catalog';
import { ComponentNodeMemo, type ComponentNode } from '@/editor/component-node';
import { COMPONENT_DRAG_TYPE } from '@/editor/drag';
import { ComponentPalette } from './component-palette';
import { ZoomControls } from './zoom-controls';

/** the grid: a small dot every DOT_GAP px (--grid on --canvas in index.css) */
const DOT_GAP = 16;
const DOT_SIZE = 1.5;

const NODE_TYPES = { component: ComponentNodeMemo };

/** on the minimap each component in its category's color */
const minimapColor = (node: ComponentNode) => {
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
  const [nodes, setNodes, onNodesChange] = useNodesState<ComponentNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [flow, setFlow] = useState<ReactFlowInstance<ComponentNode, Edge> | null>(null);

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
    (moved: ComponentNode[], all: ComponentNode[]) =>
      setEdges(current => {
        let next = current;
        for (const node of moved) {
          for (const connection of fittedConnections(node, all, next)) {
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

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onInit={setFlow}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onNodeDragStop={(_, __, moved) => connectFitted(moved, flow?.getNodes() ?? nodes)}
      snapToGrid
      snapGrid={[DOT_GAP, DOT_GAP]}
      deleteKeyCode={['Delete', 'Backspace']}
      panOnDrag={[1, 2]}
      panOnScroll
      zoomActivationKeyCode={['Meta', 'Control']}
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={DOT_GAP} size={DOT_SIZE} color="var(--grid)" />
      <ComponentPalette />
      <ZoomControls />
      {/* the whole flow in small, bottom right: drag on it to pan, scroll on it to zoom */}
      <MiniMap<ComponentNode>
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
