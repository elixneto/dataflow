import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from 'react';
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
import { Network, Redo2, SquareDashed, Undo2, X } from 'lucide-react';
import { useParams } from 'react-router';
import { ProjectResourcesContext, ScriptGlobalsContext, useLoadProjectResources } from '@/editor/project-resources';
import { Button } from '@/components/ui/button';
import '@xyflow/react/dist/style.css';
import { componentSettings, connectionProblem, dataTypeFromSamples, END, ERROR_PORT, inputVariables, scriptGlobals, settingsDefaults, START, startParameters, systemVariables, type EnvelopeData, type KnownVariables } from '@dataflow/core';
import { arrange } from '@/editor/arrange';
import { fittedConnections } from '@/editor/auto-connect';
import { CATEGORIES, componentInfo, isFixedType } from '@/editor/catalog';
import type { ComponentDraft } from '@/editor/component-draft';
import { ComponentWindow } from '@/editor/component-window';
import { FloatingWindow, type WindowPosition, type WindowSize } from '@/editor/floating-window';
import { readViewport, readWindow, rememberViewport, rememberWindow } from '@/editor/window-memory';
import { useFlowDraft, type DraftSave } from '@/editor/flow-save';
import { RunFromContext, RunMarksContext, type RunMarks } from '@/editor/run/run-marks';
import { ExpressionVariablesContext, type InputSamples } from '@/editor/expression-variables';
import { ComponentNodeMemo, type ComponentData, type ComponentNode } from '@/editor/component-node';
import { COMPONENT_DRAG_TYPE } from '@/editor/drag';
import { canSplice, edgeUnder, pointerBox, splice } from '@/editor/edge-splice';
import { GROUP_COLORS, GROUP_SIZE, GROUP_Z, layerGroups, type GroupNode } from '@/editor/group';
import { GroupNodeMemo } from '@/editor/group-node';
import { HistoryContext, isEditableField, UndoStack } from '@/editor/history';
import { canvasHasFocus, copiedComponents, pastedComponents } from '@/editor/clipboard';
import { preloadCodeEditor } from '@/editor/code-editor-loader';
import { CARD_HEIGHT, CARD_WIDTH } from '@/editor/node-geometry';
import { ComponentPalette } from './component-palette';
import { ZoomControls } from './zoom-controls';

/** the grid: a small dot every DOT_GAP px (--grid on --canvas in index.css) */
const DOT_GAP = 16;
const DOT_SIZE = 1.5;
/** how far a paste lands from what was copied (one grid step more each paste) */
const PASTE_OFFSET = 32;

const NODE_TYPES = { component: ComponentNodeMemo, group: GroupNodeMemo };

/** what the canvas holds: components, and groups behind them */
type FlowNode = ComponentNode | GroupNode;

/** what the page does with the canvas: read it as it is now (Download, Run), focus a component, pin its output */
export type CanvasHandle = {
  snapshot: () => { nodes: FlowNode[]; edges: Edge[] };
  focus: (nodeId: string) => void;
  /** pins the component with these envelopes per port (what went out of it in the run), or unpins it (undefined) */
  setPinned: (nodeId: string, pinned: Record<string, EnvelopeData[]> | undefined) => void;
};

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
/** the size a window with a code editor or a table opens with */
const WIDE_WINDOW = { w: 760, h: null };

const noRunFrom = () => {};

export function FlowCanvas(props: {
  exportRef?: RefObject<CanvasHandle | null>;
  onSave?: (save: DraftSave) => void;
  marks?: RunMarks | null;
  /** the components whose output is pinned, each time that changes (the run's Data tab shows Pin or Unpin) */
  onPinned?: (nodeIds: string[]) => void;
  /** what the runs so far saw going out of each port (expression fields suggest it) */
  known?: KnownVariables;
  /** the envelopes the runs saw reaching each component (a TypeScript component's Data type) */
  inputSamples?: InputSamples;
  /** Run from here on a component */
  onRunFrom?: (nodeId: string) => void;
}) {
  const { exportRef, onSave, marks = null, onPinned, known, inputSamples, onRunFrom = noRunFrom } = props;
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(FIXED_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  // what the page's Download takes: the canvas as it is now
  const [flow, setFlow] = useState<ReactFlowInstance<FlowNode, Edge> | null>(null);
  const { flowId = '', projectId = '' } = useParams();

  // ---- the draft on the server (editor/flow-save.ts): opened here, saved by itself; the view comes back where it was
  const opened = useRef<{ nodes: FlowNode[]; edges: Edge[] } | null>(null);
  const draft = useFlowDraft(flowId, { nodes, edges }, loaded => {
    opened.current = loaded;
    setNodes(loaded.nodes);
    setEdges(loaded.edges);
  });
  // once the draft is on the canvas and the canvas is ready: the remembered view, or the whole flow on screen
  useEffect(() => {
    if (!flow || !opened.current || draft.state.status === 'loading') {
      return;
    }

    opened.current = null;
    const view = readViewport(flowId);
    window.setTimeout(() => (view ? void flow.setViewport(view) : void flow.fitView(FIT_VIEW)), 0);
  }, [flow, flowId, draft.state.status]);
  useEffect(() => {
    onSave?.(draft);
  }, [onSave, draft]);
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

  const pinnedKey = nodes.filter(n => isComponent(n) && n.data.pinned).map(n => n.id).join(',');
  useEffect(() => {
    onPinned?.(pinnedKey ? pinnedKey.split(',') : []);
  }, [onPinned, pinnedKey]);

  // the page's handle on the canvas (CanvasHandle)
  useEffect(() => {
    if (exportRef) {
      exportRef.current = {
        snapshot: () => ({ nodes, edges }),
        // the component in the middle of the screen, selected (a click on a log line or a row of the run)
        focus: nodeId => {
          const node = nodes.find(n => n.id === nodeId);
          if (!node || !flow) {
            return;
          }

          setNodes(current => current.map(n => ({ ...n, selected: n.id === nodeId })));
          void flow.setCenter(node.position.x + CARD_WIDTH / 2, node.position.y + CARD_HEIGHT / 2, { zoom: Math.max(flow.getZoom(), 1), duration: 300 });
        },
        // pinning from the run's Data tab, as the bar's Pin does (one Ctrl+Z step): the envelopes it keeps, or none
        setPinned: (nodeId, pinned) => {
          record();
          setNodes(current => current.map(n => (n.id === nodeId && isComponent(n) ? ({ ...n, data: { ...n.data, pinned } } as FlowNode) : n)));
        },
      };
    }
  }, [exportRef, nodes, edges, flow, setNodes, record]);

  // Ctrl+S saves now (anywhere, as in any editor); Ctrl+Z undoes; Ctrl+Y or Ctrl+Shift+Z redoes (Cmd on a Mac); typing
  // in a field keeps the field's own undo
  const saveNow = draft.saveNow;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        saveNow();
        return;
      }

      if (isEditableField(event.target)) {
        return;
      }

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
  }, [undo, redo, saveNow]);

  // the code editor (Monaco) in the background: a window with code opens with it at once
  useEffect(preloadCodeEditor, []);

  // Ctrl+C with components selected copies them (editor/clipboard.ts); Ctrl+V pastes them, a little further each time.
  // Typing in a field, or text selected on the page: the browser's own copy and paste
  const pastes = useRef<{ at: { x: number; y: number } | null; count: number }>({ at: null, count: 0 });
  // the pointer over the canvas (screen coordinates), null once it left: a paste lands there
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const busy = () => !canvasHasFocus(document.activeElement) || Boolean(window.getSelection()?.toString());
    const onCopy = (event: ClipboardEvent) => {
      if (busy() || !event.clipboardData) {
        return;
      }

      const text = copiedComponents(nodes, edges);
      if (text) {
        event.preventDefault();
        event.clipboardData.setData('text/plain', text);
        pastes.current = { at: null, count: 0 };
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!canvasHasFocus(document.activeElement) || !event.clipboardData) {
        return;
      }

      // at the pointer on the canvas; away from it, in the middle of what is on screen (snapped to the grid). Again at
      // the same place: a step further, so the copies do not hide each other
      const box = document.querySelector('.react-flow')?.getBoundingClientRect();
      const point = pointer.current ?? (box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null);
      const spot = flow && point ? flow.screenToFlowPosition(point) : { x: 0, y: 0 };
      const snap = (value: number) => Math.round(value / DOT_GAP) * DOT_GAP;
      const at = { x: snap(spot.x), y: snap(spot.y) };
      const again = pastes.current.at?.x === at.x && pastes.current.at?.y === at.y;
      const count = again ? pastes.current.count + 1 : 0;
      const pasted = pastedComponents(event.clipboardData.getData('text/plain'), nodes, at, { offset: PASTE_OFFSET * count, center: !pointer.current });
      if (!pasted) {
        return;
      }

      event.preventDefault();
      pastes.current = { at, count };
      record();
      setNodes(current => [...current.map(n => ({ ...n, selected: false })), ...pasted.nodes]);
      setEdges(current => [...current, ...pasted.edges]);
    };
    window.addEventListener('copy', onCopy);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('paste', onPaste);
    };
  }, [nodes, edges, record, setNodes, setEdges, flow]);

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
        const className = [e.sourceHandle === ERROR_PORT && 'is-error-edge', e.id === spliceEdge && 'is-splice-target'].filter(Boolean).join(' ');
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
      data: { type, config: settingsDefaults(componentSettings(type)) },
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

  // ---- the components' windows (editor/floating-window.tsx): a double click opens one; several stay open, the last
  // one in front
  // minimized: hidden but kept (its size and unsaved edits), a chip in the bottom-left tray, in the order minimized
  type OpenWindow = { id: string; position: WindowPosition; size?: WindowSize; minimized?: number; changed?: boolean };
  const [windows, setWindows] = useState<OpenWindow[]>([]);
  // each window comes back where it was and with its size (this browser tab, per flow and component)
  const resources = useLoadProjectResources(projectId);
  const openWindow = (id: string) => {
    // the component goes out of the selection: the window is where the work goes on (its Ctrl+C copies its text)
    setNodes(current => (current.some(n => n.selected) ? current.map(n => (n.selected ? { ...n, selected: false } : n)) : current));
    openWindowOnly(id);
  };
  const openWindowOnly = (id: string) =>
    setWindows(current => {
      const open = current.find(w => w.id === id);
      if (open) {
        // already open: to the front, restored when minimized
        return [...current.filter(w => w.id !== id), { ...open, minimized: undefined }];
      }

      const remembered = readWindow(flowId, id);
      const n = current.length % 8;
      const type = nodes.filter(isComponent).find(node => node.id === id)?.data.type;
      // a code editor or a table needs room: those windows open wider (a size the user left wins)
      const wide = componentSettings(String(type)).some(setting => setting.kind === 'code' || setting.kind === 'grid');
      return [...current, { id, position: remembered.position ?? { x: 320 + n * 28, y: 24 + n * 28 }, size: remembered.size ?? (wide ? WIDE_WINDOW : undefined) }];
    });
  const closeWindow = (id: string) => setWindows(current => current.filter(w => w.id !== id));
  const focusWindow = (id: string) =>
    setWindows(current => (current.at(-1)?.id === id ? current : [...current.filter(w => w.id !== id), current.find(w => w.id === id)!]));
  const updateWindow = (id: string, changes: Partial<OpenWindow>) => setWindows(current => current.map(w => (w.id === id ? { ...w, ...changes } : w)));
  const minimizeWindow = (id: string) => updateWindow(id, { minimized: Date.now() });
  // closing a minimized window: right away; with unsaved changes it comes back first and asks (Discard changes?)
  const closeMinimized = (w: OpenWindow) => {
    if (!w.changed) {
      closeWindow(w.id);
      return;
    }

    openWindow(w.id);
    closers.current.get(w.id)?.();
  };
  // only when it changes: the window reports it on every render
  const markChanged = (id: string, changed: boolean) =>
    setWindows(current => (current.some(w => w.id === id && !!w.changed !== changed) ? current.map(w => (w.id === id ? { ...w, changed } : w)) : current));
  // Save in a window: all its changes at once, one Ctrl+Z step, and the window closes
  const saveComponent = (id: string, draft: ComponentDraft) => {
    record();
    const changes: Partial<ComponentData> = {
      config: draft.config,
      label: draft.label?.trim() || undefined,
      outputKey: draft.outputKey?.trim() || undefined,
      override: draft.override || undefined,
      notes: draft.notes || undefined,
    };
    setNodes(current => current.map(n => (n.id === id && isComponent(n) ? { ...n, data: { ...n.data, ...changes } } : n)));
    closeWindow(id);
  };
  const removeComponent = (id: string) => {
    record();
    setNodes(current => current.filter(n => n.id !== id));
    setEdges(current => current.filter(e => e.source !== id && e.target !== id));
    closeWindow(id);
  };
  // each window's own way to close (it asks first when it has unsaved changes), used by its X and Esc
  const closers = useRef(new Map<string, () => void>());

  // a deleted component (Delete, Ctrl+Z...) has no window to show
  const shownWindows = windows.filter(w => nodes.some(n => n.id === w.id));
  // the front window is the last one not minimized
  const frontWindow = shownWindows.filter(w => !w.minimized).at(-1)?.id;
  const dock = shownWindows.filter(w => w.minimized).sort((a, b) => (a.minimized ?? 0) - (b.minimized ?? 0));
  // $PARAMETERS in a TypeScript component's code: the Start's parameters (only the text changes when they do)
  // an expression field's suggestions at a component: what reached it in the runs so far, then the system variables
  const parameters = startParameters(nodes.filter(isComponent).map(n => n.data));
  const globals = (nodeId?: string) => {
    const samples = nodeId ? inputSamples?.[nodeId] : undefined;
    return scriptGlobals(parameters, samples?.length ? dataTypeFromSamples(samples) : undefined);
  };
  const portEdges = edges.map(e => ({ source: e.source, sourcePort: e.sourceHandle ?? 'out-0', target: e.target, targetPort: e.targetHandle ?? 'in-0' }));
  const system = systemVariables(parameters, resources.variables, resources.secrets);
  const expressionVariables = {
    of: (nodeId: string, port?: string) => [...inputVariables(known ?? {}, portEdges, nodeId, port).variables, ...system],
    seen: (nodeId: string, port?: string) => inputVariables(known ?? {}, portEdges, nodeId, port).seen,
  };

  return (
    <RunMarksContext.Provider value={marks}>
    <RunFromContext.Provider value={onRunFrom}>
    <ProjectResourcesContext.Provider value={resources}>
      <ScriptGlobalsContext.Provider value={globals}>
      <ExpressionVariablesContext.Provider value={expressionVariables}>
        <HistoryContext.Provider value={history}>
          <div className="relative h-full w-full">
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
              onMouseMove={event => (pointer.current = { x: event.clientX, y: event.clientY })}
              onMouseLeave={() => (pointer.current = null)}
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
              onMoveEnd={(_, view) => rememberViewport(flowId, view)}
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
              zoomOnDoubleClick={false}
              onNodeDoubleClick={(_, node) => isComponent(node) && (!isFixedType(node.data.type) || node.data.type === START) && openWindow(node.id)}
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
            {/* the windows' layer: over the canvas, letting the pointer through where there is no window */}
            <div data-windows className="pointer-events-none absolute inset-0 overflow-hidden">
              {shownWindows.map((w, i) => {
                const node = nodes.find(n => n.id === w.id);
                const info = node && isComponent(node) ? componentInfo(node.data.type) : undefined;
                if (!node || !isComponent(node) || !info) {
                  return null;
                }

                const color = CATEGORIES[info.category].color;
                return (
                  <FloatingWindow
                    key={w.id}
                    label={`Configuration of ${node.data.label?.trim() || info.label}`}
                    title={node.data.label?.trim() || info.label}
                    subtitle={info.label}
                    icon={
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md" style={{ color, backgroundColor: `color-mix(in oklch, ${color} 15%, transparent)` }}>
                        <info.icon className="size-5" aria-hidden />
                      </span>
                    }
                    position={w.position}
                    initialSize={w.size}
                    z={i + 1}
                    active={w.id === frontWindow}
                    minimized={w.minimized !== undefined}
                    onMove={position => {
                      updateWindow(w.id, { position });
                      rememberWindow(flowId, w.id, { position });
                    }}
                    onResize={size => {
                      updateWindow(w.id, { size });
                      rememberWindow(flowId, w.id, { size });
                    }}
                    onFocus={() => focusWindow(w.id)}
                    onMinimize={() => minimizeWindow(w.id)}
                    onClose={() => (closers.current.get(w.id) ?? (() => closeWindow(w.id)))()}
                  >
                    <ComponentWindow
                      id={w.id}
                      data={node.data}
                      onSave={draft => saveComponent(w.id, draft)}
                      onCancel={() => closeWindow(w.id)}
                      onRemove={() => removeComponent(w.id)}
                      registerClose={close => {
                        closers.current.set(w.id, close);
                      }}
                      onChanged={changed => markChanged(w.id, changed)}
                    />
                  </FloatingWindow>
                );
              })}
              {/* the minimized windows: chips from left to right in the bottom-left corner; a click restores one */}
              {dock.length > 0 && (
                <div aria-label="Minimized windows" className="pointer-events-auto absolute bottom-3 left-3 flex max-w-[calc(100%-24px)] gap-2 overflow-x-auto">
                  {dock.map(w => {
                    const node = nodes.find(n => n.id === w.id);
                    const info = node && isComponent(node) ? componentInfo(node.data.type) : undefined;
                    if (!node || !isComponent(node) || !info) {
                      return null;
                    }

                    const name = node.data.label?.trim() || info.label;
                    return (
                      <div key={w.id} className="flex h-8 max-w-52 shrink-0 items-center rounded-lg border bg-card text-xs font-medium shadow-md">
                        {/* the X first: closing the first chip brings the next one under the pointer, so several close fast */}
                        <button
                          type="button"
                          aria-label={`Close ${name}`}
                          title="Close"
                          onClick={() => closeMinimized(w)}
                          className="flex h-full shrink-0 items-center rounded-l-lg px-1.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          title={w.changed ? `${name} (unsaved changes)` : name}
                          aria-label={`Restore ${name}`}
                          onClick={() => openWindow(w.id)}
                          className="flex h-full min-w-0 items-center gap-2 rounded-r-lg border-l pr-2.5 pl-2 transition-colors hover:bg-accent"
                        >
                          <info.icon className="size-3.5 shrink-0" style={{ color: CATEGORIES[info.category].color }} aria-hidden />
                          <span className="truncate">{name}</span>
                          {w.changed && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-label="unsaved changes" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </HistoryContext.Provider>
      </ExpressionVariablesContext.Provider>
      </ScriptGlobalsContext.Provider>
    </ProjectResourcesContext.Provider>
    </RunFromContext.Provider>
    </RunMarksContext.Provider>
  );
}
