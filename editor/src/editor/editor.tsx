import {useCallback, useEffect, useMemo, useRef, useState, type DragEvent} from 'react';
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type XYPosition,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {stringify as stringifyYaml} from 'yaml';
import {CircleAlert, Play, X} from 'lucide-react';
import {CATEGORIES, CATEGORY_COLOR, DRAG_MIME, isFlowNode, END, START, BY_TYPE} from '#components/catalog';
import {cn} from '#lib/utils';
import {cleanFlow, toDefinition, type Flow, type FlowNode} from '#data/flows';
import {getProject, EXAMPLES_PROJECT} from '#data/projects';
import {type AvailableVariable, type EnvelopeData, type RunMode, type WorkflowParameter, type RunRecord, type ComponentRun} from '@dataflow/core';
import {RunPanel} from '#run/run-panel';
import {cancelOnRunner, runOnRunner, toExecutable} from '#run/runner';
import {mergeLastRuns, runFromWorkflow} from '#run/run-from';
import {loadValidationRuns, saveValidationRuns} from '#data/validation-runs';
import {Toolbar, type ValidationResult} from '#editor/toolbar';
import {HistoryContext} from '#editor/history';
import {CommentNodeMemo, COMMENT_SIZE, type CommentNode} from '#editor/comment-node';
import {GROUP_COLORS, GroupNodeMemo, GROUP_SIZE, GROUP_Z, type GroupNode} from '#editor/group-node';
import {ComponentNodeMemo, ERROR_PORT, inputCount, outputCount, outputLabel, type ComponentNode} from '#editor/component-node';
import {Palette} from '#editor/palette';
import {arrange as arrangeNodes, type ArrangeDirection} from '#editor/layout';
import {FloatingWindow, type WindowPosition, type WindowSize} from '#editor/window';
import {WorkflowPanel} from '#editor/workflow-panel';
import {ParametersContext} from '#editor/parameters-context';
import {WarningsContext, ResultContext, RunFromContext} from '#editor/result-context';
import {PropertiesPanel} from '#editor/properties-panel';
import {ResizeObserverGuard} from '#editor/resize-observer-guard';
import {isComponent, receivesRows, validateFlow, type Issue} from '#editor/validation';
import {loadKnownVariables, saveKnownVariables, updateKnownVariables} from '#editor/known-variables';
import {VariablesContext, type Variables} from '#editor/variables-context';
import {edgeUnder, splice, type Box} from '#editor/edge-splice';
import {DependenciesButton} from '#editor/dependencies';

type Snapshot = {nodes: FlowNode[]; edges: Edge[]};

const nodeTypes = {component: ComponentNodeMemo, comment: CommentNodeMemo, group: GroupNodeMemo};

const HISTORY_LIMIT = 100;
const EDIT_WINDOW_MS = 1000;
const PASTE_OFFSET = 40;
const VALIDATION_DELAY_MS = 900;
/** How close to the pointer tip (flow px) an edge must pass for a dragged component to go into it. */
const SPLICE_REACH = 16;

/** The current run's variables: every node has them, with or without a run. */
const RUN_VARIABLES: AvailableVariable[] = [
  {path: '$WORKFLOW_CURRENT_RUN', type: 'object'},
  ...['id', 'mode', 'project', 'workflow', 'startedAt', 'parentId'].map(field => ({path: `$WORKFLOW_CURRENT_RUN.${field}`, type: 'string'})),
];

let counter = 0;
function newId(type: string) {
  counter += 1;
  return `${type}-${Date.now().toString(36)}${counter}`;
}

function isEditableField(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function isFixedNode(node: FlowNode) {
  return isComponent(node) && isFlowNode(node.data.type);
}

type Props = {
  flow: Flow;
  onSave: (flow: Flow) => Flow;
};

function Editor({flow, onSave}: Props) {
  const wrapperRef = useRef<HTMLElement>(null);
  const {screenToFlowPosition, getNodes, getEdges, fitView, updateNodeData} = useReactFlow<FlowNode, Edge>();
  // Start and End can't be deleted (not stored in the flow: set here)
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(flow.nodes.map(n => (isFixedNode(n) ? {...n, deletable: false} : n)));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(flow.edges);
  const [name, setName] = useState(flow.name);
  const [base, setBase] = useState(flow);
  const [changed, setChanged] = useState(false);
  const [validation, setValidation] = useState<ValidationResult>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [showIssues, setShowIssues] = useState(false);
  const [validating, setValidating] = useState(false);
  const [parameters, setParameters] = useState<WorkflowParameter[]>(flow.parameters ?? []);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [running, setRunning] = useState<RunMode | null>(null);
  // the latest result of each node that ran (closing the result panel keeps it), kept in this browser per flow version
  const [lastRuns, setLastRuns] = useState<Record<string, ComponentRun>>({});
  useEffect(() => {
    let active = true;
    // a run that finished before the stored results arrived wins over them
    void loadValidationRuns(flow.id, flow.version).then(stored => active && setLastRuns(current => ({...stored, ...current})));
    return () => {
      active = false;
    };
  }, [flow.id, flow.version]);
  const runId = useRef<string | null>(null);
  // the expression fields suggest what reached each node in the runs so far (kept per flow, per output port)
  const [known, setKnown] = useState(() => loadKnownVariables(flow.id));
  const [secretNames, setSecretNames] = useState<string[]>([]);
  useEffect(() => {
    const project = encodeURIComponent(flow.projectId ?? EXAMPLES_PROJECT);
    fetch(`${import.meta.env.BASE_URL}api/projects/${project}/secrets`)
      .then(response => (response.ok ? response.json() as Promise<{name: string}[]> : []))
      .then(list => setSecretNames(list.map(s => s.name)))
      .catch(() => undefined);
  }, [flow.projectId]);
  const variables = useMemo<Variables>(() => {
    /** what went out of the ports feeding the node, in the runs so far (undefined: nothing seen) */
    const incoming = (nodeId: string, port?: string) => edges
      .filter(e => e.target === nodeId && (!port || (e.targetHandle ?? 'in-0') === port))
      .map(e => known[e.source]?.[e.sourceHandle ?? 'out-0']);
    return {
      seen: (nodeId, port) => incoming(nodeId, port).some(list => list !== undefined),
      of: (nodeId, port) => {
        // what reached the node first, then parameters, secrets and the run
        const list: AvailableVariable[] = [
          ...incoming(nodeId, port).flatMap(list => list ?? []),
          {path: '$PARAMETERS', type: 'object'},
          ...parameters.filter(p => p.name).map(p => ({path: `$PARAMETERS.${p.name}`, type: p.type, example: p.default || undefined})),
          {path: '$SECRETS', type: 'object'},
          ...secretNames.map(name => ({path: `$SECRETS.${name}`, type: 'secret'})),
          ...RUN_VARIABLES,
        ];
        return [...new Map(list.map(v => [v.path, v])).values()];
      },
    };
  }, [known, parameters, secretNames, edges]);
  // the result panel minimized: the canvas goes back to its normal colors, without the run's marks
  const [minimized, setMinimized] = useState(false);
  const shownRun = minimized ? null : run;
  // each component's output bump is painted by the result (it goes away when the result is minimized)
  const lastRunStatus = useMemo(
    () => Object.fromEntries((shownRun?.components ?? []).map(c => [c.nodeId, c])),
    [shownRun],
  );
  // the panel follows the canvas: removed nodes leave it, new ones show up as not run, labels follow renames
  const panelRecord = useMemo(() => {
    if (!run) return null;
    const current = new Map(nodes.filter(n => n.type === 'component').map(n => [n.id, n as ComponentNode]));
    const ran = run.components.filter(c => current.has(c.nodeId)).map(c => ({...c, label: current.get(c.nodeId)!.data.label}));
    const seen = new Set(ran.map(c => c.nodeId));
    const added = [...current.values()].filter(n => !seen.has(n.id)).map((n): ComponentRun => ({
      nodeId: n.id, label: n.data.label, type: n.data.type, status: 'not-run', inputs: {}, outputs: {}, logs: [], inputSample: [], outputSample: {},
    }));
    return {...run, components: [...ran, ...added]};
  }, [run, nodes]);
  // the latest execute (it reads the state of the render), for the cards' "Run from here"
  const executeRef = useRef<(mode: RunMode, from?: string) => void>(() => undefined);
  const pinRef = useRef<(nodeId: string, pinned: Record<string, EnvelopeData[]> | undefined) => void>(() => undefined);
  // "Run from here" shows on every component that can replay what reached it in the previous runs; Pin on every one
  // whose main output has a sample
  const runFrom = useMemo(() => {
    const available = new Set<string>();
    const canPin = new Set<string>();
    if (!running) {
      const whole = toExecutable(name, parameters, nodes, edges, flow.id, flow.projectId);
      for (const node of whole.nodes) {
        if (node.type === 'start' || node.type === 'end') continue;
        if (runFromWorkflow(whole, node.id, lastRuns)) available.add(node.id);
        const ran = lastRuns[node.id];
        if (!node.pinned && ran && ran.status !== 'failed' && ran.outputSample['out-0']) canPin.add(node.id);
      }
    }
    return {
      available,
      run: (nodeId: string) => executeRef.current('validation', nodeId),
      canPin,
      pin: (nodeId: string) => {
        const sample = lastRuns[nodeId]?.outputSample['out-0'];
        if (sample) pinRef.current(nodeId, {'out-0': structuredClone(sample)});
      },
    };
  }, [lastRuns, running, nodes, edges, name, parameters, flow.id, flow.projectId]);
  const pinnedIds = useMemo(() => new Set(nodes.filter(n => n.type === 'component' && n.data.pinned).map(n => n.id)), [nodes]);
  const warnings = useMemo(() => {
    const byNode: Record<string, string[]> = {};
    const add = (id: string, msg: string) => (byNode[id] ??= []).push(msg);
    for (const p of issues) add(p.nodeId, p.message);
    for (const c of shownRun?.components ?? []) {
      if (c.status !== 'failed' && c.status !== 'with-errors') continue;
      const errors = c.logs.filter(l => l.level === 'error').map(l => l.message);
      for (const m of errors.length ? errors.slice(0, 5) : ['The run failed.']) add(c.nodeId, m);
    }
    return byNode;
  }, [issues, shownRun]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // the <ReactFlow> fitView runs before the (tall) cards are measured; frame again once they have a size
  const nodesMeasured = useNodesInitialized();
  const framed = useRef(false);
  useEffect(() => {
    if (!nodesMeasured || framed.current) return;
    framed.current = true;
    requestAnimationFrame(() => fitView({padding: 0.12, maxZoom: 1}));
  }, [nodesMeasured, fitView]);

  // warns before leaving with unsaved changes
  useEffect(() => {
    if (!changed) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed]);

  const invalid = useMemo(() => new Set(issues.map(p => p.nodeId)), [issues]);

  // The red highlight is only visual, but the card's updateNodeData returns the node with the className into the state.
  // That is why the className is always recomputed here (set or unset), instead of only being added to the invalid ones.
  const shownNodes = useMemo(
    () => nodes.map(n => {
      const cls = invalid.has(n.id) ? 'is-invalid' : undefined;
      return n.className === cls ? n : {...n, className: cls};
    }),
    [nodes, invalid],
  );
  // edge a dragged component would be spliced into (highlighted while dragging)
  const [spliceEdge, setSpliceEdge] = useState<string | null>(null);
  // a drag that ends without a drop on the canvas (Esc, dropped outside, the window lost the focus): the highlight goes away
  useEffect(() => {
    const clear = () => setSpliceEdge(null);
    window.addEventListener('dragend', clear);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('blur', clear);
    };
  }, []);
  const shownEdges = useMemo(
    () => edges.map(e => {
      const fromError = e.sourceHandle === ERROR_PORT;
      const target = e.id === spliceEdge;
      if (!fromError && !validating && !target) return e;
      return {...e, ...(validating && {animated: true}), className: cn(fromError && 'is-error-edge', target && 'is-splice-target')};
    }),
    [edges, validating, spliceEdge],
  );

  // ---------- history (Ctrl+Z / Ctrl+Shift+Z) ----------

  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const lastEdit = useRef<{key: string; at: number} | null>(null);
  const [historySize, setHistorySize] = useState({past: 0, future: 0});

  const sync = useCallback(() => setHistorySize({past: past.current.length, future: future.current.length}), []);

  const clearValidation = useCallback(() => {
    setValidation(null);
    setIssues([]);
  }, []);

  const record = useCallback(() => {
    past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), {nodes: getNodes(), edges: getEdges()}];
    future.current = [];
    lastEdit.current = null;
    setChanged(true);
    clearValidation();
    sync();
  }, [getNodes, getEdges, sync, clearValidation]);

  const recordEdit = useCallback((key: string) => {
    const now = Date.now();
    const previous = lastEdit.current;
    setChanged(true);
    if (previous && previous.key === key && now - previous.at < EDIT_WINDOW_MS) {
      lastEdit.current = {key, at: now};
      return;
    }
    record();
    lastEdit.current = {key, at: now};
  }, [record]);

  const undo = useCallback(() => {
    const previous = past.current.at(-1);
    if (!previous) return;
    past.current = past.current.slice(0, -1);
    future.current = [...future.current, {nodes: getNodes(), edges: getEdges()}];
    lastEdit.current = null;
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setChanged(true);
    clearValidation();
    sync();
  }, [getNodes, getEdges, setNodes, setEdges, sync, clearValidation]);

  const redo = useCallback(() => {
    const next = future.current.at(-1);
    if (!next) return;
    future.current = future.current.slice(0, -1);
    past.current = [...past.current, {nodes: getNodes(), edges: getEdges()}];
    lastEdit.current = null;
    setNodes(next.nodes);
    setEdges(next.edges);
    setChanged(true);
    clearValidation();
    sync();
  }, [getNodes, getEdges, setNodes, setEdges, sync, clearValidation]);

  // ---------- copy / paste ----------

  const clipboard = useRef<{nodes: FlowNode[]; edges: Edge[]; pastes: number} | null>(null);

  const copy = useCallback(() => {
    const chosen = getNodes().filter(n => n.selected && !isFixedNode(n));
    if (chosen.length === 0) return false;
    const ids = new Set(chosen.map(n => n.id));
    clipboard.current = {
      nodes: structuredClone(chosen),
      edges: structuredClone(getEdges().filter(e => ids.has(e.source) && ids.has(e.target))),
      pastes: 0,
    };
    return true;
  }, [getNodes, getEdges]);

  const paste = useCallback(() => {
    const copied = clipboard.current;
    if (!copied || copied.nodes.length === 0) return;
    copied.pastes += 1;
    const offset = PASTE_OFFSET * copied.pastes;
    const ids = new Map<string, string>();
    const added = copied.nodes.map(n => {
      const id = newId(isComponent(n) ? n.data.type : n.type ?? 'node');
      ids.set(n.id, id);
      return {...structuredClone(n), id, selected: true, dragging: false, position: {x: n.position.x + offset, y: n.position.y + offset}} as FlowNode;
    });
    const addedEdges = copied.edges.map(e => ({
      ...structuredClone(e), id: newId('edge'), source: ids.get(e.source)!, target: ids.get(e.target)!, selected: false,
    }));
    record();
    setNodes(current => [...current.map(n => ({...n, selected: false})), ...added]);
    setEdges(current => [...current.map(e => ({...e, selected: false})), ...addedEdges]);
  }, [record, setNodes, setEdges]);

  // ---------- save ----------

  /** The flow as it is stored, with what is in the editor now (no selection nor run marks): what Save keeps and Download gives. */
  const currentFlow = useCallback(
    (): Flow => cleanFlow({...base, name, parameters, nodes: getNodes(), edges: getEdges()}),
    [base, name, parameters, getNodes, getEdges],
  );

  const save = useCallback(() => {
    const saved = onSave(currentFlow());
    setBase(saved);
    setChanged(false);
  }, [currentFlow, onSave]);

  /**
   * Downloads the flow's definition as YAML (unsaved changes included): multi-line code (TypeScript, SQL, conditions)
   * goes as a literal block, readable in a diff. Secrets are not in it: they live in the runner.
   */
  function download() {
    // version and updatedAt stay in the app (they would change the file on every save, without changing the flow)
    const {id, name: flowName, description, status, projectId, folder, parameters: flowParameters, nodes: flowNodes, edges: flowEdges} = toDefinition(currentFlow());
    const definition = {id, name: flowName, description, status, projectId, folder, parameters: flowParameters, nodes: flowNodes, edges: flowEdges};
    const slug = flowName.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flow';
    const text = stringifyYaml(definition, {blockQuote: 'literal', lineWidth: 0, indent: 2});
    const url = URL.createObjectURL(new Blob([text], {type: 'application/yaml'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slug}.yaml`;
    link.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      const keyName = event.key.toLowerCase();
      if (keyName === 's') {
        event.preventDefault();
        save();
        return;
      }
      if (isEditableField(event.target)) return;
      if (keyName === 'c') {
        if (copy()) event.preventDefault();
      } else if (keyName === 'x') {
        if (!copy()) return;
        event.preventDefault();
        const ids = new Set(getNodes().filter(n => n.selected && !isFixedNode(n)).map(n => n.id));
        record();
        setNodes(current => current.filter(n => !ids.has(n.id)));
        setEdges(current => current.filter(e => !ids.has(e.source) && !ids.has(e.target)));
        if (clipboard.current) clipboard.current.pastes = -1;
      } else if (keyName === 'v') {
        if (!clipboard.current) return;
        event.preventDefault();
        paste();
      } else if (keyName === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((keyName === 'z' && event.shiftKey) || keyName === 'y') {
        event.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, copy, paste, save, getNodes, record, setNodes, setEdges]);

  const history = useMemo(() => ({record, recordEdit}), [record, recordEdit]);

  // ---------- configuration windows (double click; one per component, several open) ----------

  const [windows, setWindows] = useState<{id: string; position: WindowPosition; size?: WindowSize}[]>([]);

  // each window's position and size are remembered in this browser (per flow and component), outside the flow and Ctrl+Z
  const windowKey = useCallback((nodeId: string) => `dataflow-flows-window:${flow.id}:${nodeId}`, [flow.id]);
  const readWindow = useCallback((nodeId: string): {position?: WindowPosition; size?: WindowSize} => {
    try {
      return JSON.parse(localStorage.getItem(windowKey(nodeId)) ?? '{}');
    } catch {
      return {};
    }
  }, [windowKey]);
  const rememberWindow = useCallback((nodeId: string, update: {position?: WindowPosition; size?: WindowSize}) => {
    try {
      localStorage.setItem(windowKey(nodeId), JSON.stringify({...readWindow(nodeId), ...update}));
    } catch {
      // no storage: opens in the default place next time
    }
  }, [windowKey, readWindow]);

  const openWindow = useCallback((id: string) => {
    const remembered = readWindow(id);
    setWindows(current => {
      const open = current.find(j => j.id === id);
      if (open) return [...current.filter(j => j.id !== id), open]; // already open: only comes to the front
      const n = current.length % 8;
      const node = getNodes().find(x => x.id === id);
      const fallback = node && isComponent(node) ? BY_TYPE[node.data.type]?.windowSize : undefined;
      return [...current, {id, position: remembered.position ?? {x: 24 + n * 28, y: 56 + n * 28}, size: remembered.size ?? fallback}];
    });
  }, [readWindow, getNodes]);
  const closeWindow = useCallback((id: string) => setWindows(current => current.filter(j => j.id !== id)), []);
  const focusWindow = useCallback((id: string) => setWindows(current =>
    current.at(-1)?.id === id ? current : [...current.filter(j => j.id !== id), current.find(j => j.id === id)!]), []);
  const moveWindow = useCallback((id: string, position: WindowPosition) => {
    setWindows(current => current.map(j => (j.id === id ? {...j, position} : j)));
    rememberWindow(id, {position});
  }, [rememberWindow]);

  // a deleted component (Delete, Ctrl+X, undo...) closes its window
  useEffect(() => {
    setWindows(current => {
      const remaining = current.filter(j => nodes.some(n => n.id === j.id));
      return remaining.length === current.length ? current : remaining;
    });
  }, [nodes]);

  // ---------- edges ----------

  const onConnect = useCallback((connection: Connection) => {
    record();
    setEdges(current => addEdge(connection, current));
  }, [setEdges, record]);

  /** Each port accepts a single edge (the End takes several); every port carries envelopes. */
  const isValidConnection: IsValidConnection = useCallback(connection => {
    if (connection.source === connection.target) return false;
    const source = nodes.find(n => n.id === connection.source);
    const targetNode = nodes.find(n => n.id === connection.target);
    if (!source || !targetNode || !isComponent(source) || !isComponent(targetNode)) return false;
    if (!connection.sourceHandle || !connection.targetHandle) return false;
    // the End accepts several edges on the same input (the engine merges them, like the Union)
    const inputTaken = targetNode.data.type !== END && edges.some(e => e.target === connection.target && e.targetHandle === connection.targetHandle);
    const outputTaken = edges.some(e => e.source === connection.source && e.sourceHandle === connection.sourceHandle);
    return !inputTaken && !outputTaken;
  }, [edges, nodes]);

  // ---------- drag from the palette ----------

  /** Around the pointer tip: a component dropped there goes into the edge under it. */
  function cursorBox(event: {clientX: number; clientY: number}): Box {
    const p = screenToFlowPosition({x: event.clientX, y: event.clientY});
    return {x: p.x - SPLICE_REACH, y: p.y - SPLICE_REACH, w: SPLICE_REACH * 2, h: SPLICE_REACH * 2};
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
    const id = edgeUnder(cursorBox(event), getEdges())?.id ?? null;
    if (id !== spliceEdge) setSpliceEdge(id);
  }

  function newNode(type: string, position: {x: number; y: number}): ComponentNode | null {
    const def = BY_TYPE[type];
    if (!def) return null;
    return {
      id: newId(type), type: 'component', position, selected: true,
      data: {type, label: def.label, config: structuredClone(def.defaultConfig ?? {}), outputKey: def.defaultOutputKey ? freeKey(def.defaultOutputKey) : undefined},
    };
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setSpliceEdge(null);
    const node = newNode(event.dataTransfer.getData(DRAG_MIME), screenToFlowPosition({x: event.clientX - 128, y: event.clientY - 30}));
    if (!node) return;
    const edge = canSplice(node) ? edgeUnder(cursorBox(event), getEdges()) : undefined;
    record();
    setNodes(current => [...current.map(n => ({...n, selected: false})), node]);
    if (edge) setEdges(current => splice(current, edge, node.id));
  }

  /** Only a loose component with an input and an output goes into an edge (not Start/End, not one already connected). */
  function canSplice(node: FlowNode): boolean {
    return isComponent(node) && !isFlowNode(node.data.type) && inputCount(node.data) > 0 && outputCount(node.data) > 0
      && !getEdges().some(e => e.source === node.id || e.target === node.id);
  }


  /**
   * Double click on the palette: puts the component on the canvas. With a component selected, the new one goes to its right
   * and the selected one's first free output connects to the new one's input.
   */
  function addFromPalette(type: string) {
    const currentNodes = getNodes();
    const chosen = currentNodes.filter(n => n.selected);
    const previous = chosen.length === 1 && isComponent(chosen[0]) ? chosen[0] : null;
    const box = wrapperRef.current?.getBoundingClientRect();
    const center = box ? screenToFlowPosition({x: box.left + box.width / 2 - 128, y: box.top + box.height / 2 - 60}) : {x: 0, y: 0};
    const position = previous
      ? {x: previous.position.x + (previous.measured?.width ?? 288) + 80, y: previous.position.y}
      : center;
    const node = newNode(type, position);
    if (!node) return;

    // connects only if the selected one has a free output and the new one has an input
    const currentEdges = getEdges();
    const freeOutput = previous && inputCount(node.data) > 0
      ? Array.from({length: outputCount(previous.data)}, (_, i) => `out-${i}`)
          .find(port => !currentEdges.some(e => e.source === previous.id && e.sourceHandle === port))
      : undefined;

    record();
    setNodes(list => [...list.map(n => ({...n, selected: false})), node]);
    if (previous && freeOutput) {
      setEdges(list => addEdge({source: previous.id, sourceHandle: freeOutput, target: node.id, targetHandle: 'in-0'}, list));
    }
  }

  /** First free name for the key in DATA: mapper, mapper2, mapper3... */
  function freeKey(base: string) {
    const used = new Set(getNodes().filter(isComponent).map(n => n.data.outputKey));
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}${i}`;
    return name;
  }

  function addComment() {
    const box = wrapperRef.current?.getBoundingClientRect();
    const center = box ? screenToFlowPosition({x: box.left + box.width / 2, y: box.top + box.height / 2}) : {x: 0, y: 0};
    record();
    const comment: CommentNode = {
      id: newId('comment'), type: 'comment', selected: true, ...COMMENT_SIZE,
      position: {x: center.x - COMMENT_SIZE.width / 2, y: center.y - COMMENT_SIZE.height / 2},
      data: {title: '', text: '', collapsed: false},
    };
    setNodes(current => [comment, ...current.map(n => ({...n, selected: false}))]);
  }

  function addGroup() {
    const box = wrapperRef.current?.getBoundingClientRect();
    const center = box ? screenToFlowPosition({x: box.left + box.width / 2, y: box.top + box.height / 2}) : {x: 0, y: 0};
    record();
    const used = getNodes().filter(n => n.type === 'group').length;
    const group: GroupNode = {
      id: newId('group'), type: 'group', selected: true, zIndex: GROUP_Z, ...GROUP_SIZE,
      position: {x: center.x - GROUP_SIZE.width / 2, y: center.y - GROUP_SIZE.height / 2},
      data: {title: '', color: GROUP_COLORS[used % GROUP_COLORS.length]},
    };
    setNodes(current => [group, ...current.map(n => ({...n, selected: false}))]);
  }

  /** Dragging a group takes along whatever is entirely inside it (positions from the start of the drag). */
  const groupDrag = useRef<{id: string; start: XYPosition; inside: Map<string, XYPosition>} | null>(null);

  function onDragStart(_: unknown, node: FlowNode) {
    record();
    groupDrag.current = null;
    if (node.type !== 'group') return;
    const width = node.measured?.width ?? node.width ?? 0;
    const height = node.measured?.height ?? node.height ?? 0;
    const inside = new Map<string, XYPosition>();
    for (const n of getNodes()) {
      if (n.id === node.id || n.selected) continue;
      const w = n.measured?.width ?? 0;
      const h = n.measured?.height ?? 0;
      if (n.position.x >= node.position.x && n.position.y >= node.position.y
        && n.position.x + w <= node.position.x + width && n.position.y + h <= node.position.y + height) inside.set(n.id, n.position);
    }
    groupDrag.current = {id: node.id, start: node.position, inside};
  }

  function onDrag(event: MouseEvent | TouchEvent, node: FlowNode) {
    const pointer = 'touches' in event ? event.touches[0] : event;
    const edge = pointer && canSplice(node) ? edgeUnder(cursorBox(pointer), getEdges(), node.id) : undefined;
    if ((edge?.id ?? null) !== spliceEdge) setSpliceEdge(edge?.id ?? null);
    const drag = groupDrag.current;
    if (!drag || drag.id !== node.id || drag.inside.size === 0) return;
    const dx = node.position.x - drag.start.x;
    const dy = node.position.y - drag.start.y;
    setNodes(current => current.map(n => {
      const p = drag.inside.get(n.id);
      return p ? {...n, position: {x: p.x + dx, y: p.y + dy}} : n;
    }));
  }

  // ---------- panel ----------

  /** Port name for the metrics: the output's label (CA, false...) or its id (out-1, in-0, error). */
  const portName = useCallback((nodeId: string, port: string) => {
    const [side, n] = port.split('-');
    const node = nodes.find(x => x.id === nodeId);
    if (side === 'out' && node && isComponent(node)) return outputLabel(node.data, Number(n)) ?? port;
    return port;
  }, [nodes]);

  const changeLabel = useCallback((id: string, label: string) => {
    recordEdit(`${id}:label`);
    setNodes(current => current.map(n => (n.id === id && isComponent(n) ? {...n, data: {...n.data, label}} : n)));
  }, [setNodes, recordEdit]);

  const changeData = useCallback((id: string, update: Partial<Pick<ComponentNode['data'], 'outputKey' | 'override' | 'notes'>>) => {
    recordEdit(`${id}:${Object.keys(update).join(',')}`);
    setNodes(current => current.map(n => (n.id === id && isComponent(n) ? {...n, data: {...n.data, ...update}} : n)));
  }, [setNodes, recordEdit]);

  const changeConfig = useCallback((id: string, key: string, value: unknown) => {
    recordEdit(`${id}:${key}`);
    setNodes(current => current.map(n => (n.id === id && isComponent(n) ? {...n, data: {...n.data, config: {...n.data.config, [key]: value}}} : n)));
  }, [setNodes, recordEdit]);

  const remove = useCallback((id: string) => {
    record();
    setNodes(current => current.filter(n => n.id !== id));
    setEdges(current => current.filter(e => e.source !== id && e.target !== id));
  }, [setNodes, setEdges, record]);

  function goTo(nodeId: string) {
    setNodes(current => current.map(n => ({...n, selected: n.id === nodeId})));
    fitView({nodes: [{id: nodeId}], duration: 400, maxZoom: 1.1, padding: 0.6});
  }

  // ---------- validate / clear ----------

  /**
   * Checks the assembly; if it is ok, runs it on the runner (validation = simulates, execution = for real). With `from`,
   * runs only that node and what comes after it, replaying what reached it in the last run (see runFromWorkflow).
   */
  function execute(mode: RunMode, from?: string) {
    if (validating || running) return;
    clearValidation();
    setValidating(true);
    timer.current = setTimeout(async () => {
      const found = validateFlow(getNodes(), getEdges());
      setIssues(found);
      setValidating(false);
      if (found.length > 0) {
        setValidation({ok: false, messages: found.map(p => p.message)});
        setShowIssues(true);
        return;
      }
      setRunning(mode);
      try {
        runId.current = crypto.randomUUID();
        const whole = toExecutable(name, parameters, getNodes(), getEdges(), flow.id, flow.projectId);
        const workflow = from ? runFromWorkflow(whole, from, lastRuns) : whole;
        if (!workflow) throw new Error('Nothing to replay: run the whole flow first.');
        const result = await runOnRunner(workflow, mode, runId.current, undefined, flow.projectId);
        setRun(result);
        setLastRuns(previous => {
          const next = mergeLastRuns(previous, result);
          void saveValidationRuns(flow.id, base.version, next);
          return next;
        });
        // even a failed run updates the variables of the ports that produced something
        setKnown(previous => {
          const next = updateKnownVariables(previous, result);
          saveKnownVariables(flow.id, next);
          return next;
        });
        setIssues(result.components.filter(c => c.status === 'failed').map(c => ({nodeId: c.nodeId, message: `"${c.label}" failed.`})));
        setValidation(result.status === 'failed'
          ? {ok: false, messages: [result.error ?? 'The run failed.']}
          : {ok: true, messages: [result.status === 'completed' ? 'Run completed.' : result.status === 'with-warnings' ? 'Run completed with warnings.' : 'Run completed with errors.']});
      } catch (e) {
        setValidation({ok: false, messages: [e instanceof Error ? e.message : String(e)]});
      } finally {
        setRunning(null);
      }
    }, VALIDATION_DELAY_MS);
  }

  executeRef.current = execute;
  pinRef.current = pin;

  /** Pins the output of the last run on the node (or unpins, with undefined): in editor runs it stops executing and replays it. */
  function pin(nodeId: string, pinned: Record<string, EnvelopeData[]> | undefined) {
    record();
    updateNodeData(nodeId, {pinned});
  }

  /** Arranges the flow left to right or top to bottom (Dagre) and frames it; undone with Ctrl+Z. */
  function arrange(direction: ArrangeDirection) {
    record();
    setNodes(current => arrangeNodes(current, getEdges(), direction));
    requestAnimationFrame(() => fitView({padding: 0.15, maxZoom: 1, duration: 300}));
  }

  function clear() {
    record();
    setNodes(current => current.filter(isFixedNode));
    setEdges([]);
  }

  return (
    <HistoryContext.Provider value={history}>
    <ParametersContext.Provider value={parameters}>
    <ResultContext.Provider value={lastRunStatus}>
    <RunFromContext.Provider value={runFrom}>
    <WarningsContext.Provider value={warnings}>
    <VariablesContext.Provider value={variables}>
      <div className="flex h-dvh flex-col">
        <Toolbar
          project={{id: flow.projectId ?? EXAMPLES_PROJECT, name: getProject(flow.projectId ?? EXAMPLES_PROJECT)?.name ?? 'Project'}}
          folder={flow.folder}
          name={name}
          onName={v => {
            setName(v);
            setChanged(true);
          }}
          validation={validation}
          onRun={() => execute('validation')}
          onStop={() => runId.current && cancelOnRunner(runId.current)}
          validating={validating || running !== null}
          running={running}
          onClear={clear}
          onArrange={arrange}
          onComment={addComment}
          onGroup={addGroup}
          onUndo={undo}
          onRedo={redo}
          canUndo={historySize.past > 0}
          canRedo={historySize.future > 0}
          changed={changed}
          onSave={save}
          onDownload={download}
          dependencies={<DependenciesButton current={currentFlow}/>}
          onShowIssues={() => setShowIssues(v => !v)}
        />
        <div className="flex min-h-0 flex-1">
          <Palette onAdd={addFromPalette}/>
          <main ref={wrapperRef} className="relative flex min-w-0 flex-1 flex-col" onDragOver={onDragOver} onDrop={onDrop}
                onDragLeave={e => !e.currentTarget.contains(e.relatedTarget as Node | null) && setSpliceEdge(null)}>
            <h1 className="sr-only">Flow canvas</h1>
            {/* the canvas ends where the result panel starts, so its controls, minimap and the issues stay above it */}
            <div className="relative min-h-0 flex-1">
            <ReactFlow
              nodes={shownNodes}
              edges={shownEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onNodeDoubleClick={(_, n) => {
                if (n.type === 'component' && (isComponent(n) && (!isFixedNode(n) || n.data.type === START))) openWindow(n.id);
              }}
              zoomOnDoubleClick={false}
              elevateNodesOnSelect={false}
              onNodeDragStart={onDragStart}
              onNodeDrag={onDrag}
              onNodeDragStop={(_, node) => {
                // dropped over an edge: goes into it (the same Ctrl+Z as the drag)
                const edge = spliceEdge ? getEdges().find(e => e.id === spliceEdge) : undefined;
                setSpliceEdge(null);
                if (edge && canSplice(node)) setEdges(current => splice(current, edge, node.id));
              }}
              onSelectionDragStart={record}
              onBeforeDelete={async () => {
                record();
                return true;
              }}
              defaultEdgeOptions={{type: 'default'}}
              selectionOnDrag
              selectionMode={SelectionMode.Partial}
              panOnDrag={[1, 2]}
              panOnScroll
              zoomActivationKeyCode={['Meta', 'Control']}
              multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
              snapToGrid
              snapGrid={[20, 20]}
              fitView
              fitViewOptions={{padding: 0.15, maxZoom: 1}}
              minZoom={0.2}
              deleteKeyCode={['Backspace', 'Delete']}
              proOptions={{hideAttribution: true}}
            >
              <Background id="minor" variant={BackgroundVariant.Lines} gap={20} color="var(--grid)" lineWidth={0.5}/>
              <Background id="major" variant={BackgroundVariant.Lines} gap={100} color="var(--grid)" lineWidth={1}/>
              <Controls position="bottom-left" showInteractive={false}/>
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                nodeColor={n => {
                  const node = n as FlowNode;
                  if (node.type === 'group') return `color-mix(in oklch, ${node.data.color} 20%, transparent)`;
                  if (!isComponent(node)) return 'color-mix(in oklch, var(--comment) 45%, transparent)';
                  const category = BY_TYPE[node.data.type]?.category;
                  return category ? CATEGORY_COLOR[category] : 'var(--muted)';
                }}
                nodeBorderRadius={4}
              />
            </ReactFlow>

            {nodes.every(isFixedNode) && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="rounded-md border border-dashed border-border bg-background/80 px-4 py-3 text-sm text-muted-foreground">
                  Drag components from the sidebar to start your flow.
                </p>
              </div>
            )}

            {showIssues && issues.length > 0 && (
              <section className="absolute bottom-4 left-1/2 z-10 flex max-h-64 w-[min(640px,calc(100%-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-destructive/40 bg-background/95 shadow-xl backdrop-blur-sm"
                       aria-label="Flow issues">
                <header className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium text-destructive">
                  <CircleAlert className="size-4" aria-hidden="true"/>
                  {issues.length} issue{issues.length === 1 ? '' : 's'} · click to go to the component
                  <button type="button" onClick={() => setShowIssues(false)} className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          aria-label="Close issues">
                    <X className="size-4" aria-hidden="true"/>
                  </button>
                </header>
                <ul className="overflow-y-auto py-1 text-sm">
                  {issues.map((p, i) => (
                    <li key={i}>
                      <button type="button" onClick={() => goTo(p.nodeId)} className="w-full px-3 py-1.5 text-left hover:bg-accent">{p.message}</button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            </div>
            <div data-windows className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
              {windows.map((j, i) => {
                const node = nodes.find(n => n.id === j.id);
                if (!node || !isComponent(node)) return null;
                const active = i === windows.length - 1;
                const common = {
                  position: j.position, initialSize: j.size, z: i + 1, active,
                  onMove: (p: WindowPosition) => moveWindow(j.id, p),
                  onResize: (t: WindowSize) => rememberWindow(j.id, {size: t}),
                  onFocus: () => focusWindow(j.id),
                  onClose: () => closeWindow(j.id),
                };
                if (node.data.type === START) {
                  return (
                    <FloatingWindow key={j.id} {...common} label="Workflow parameters" title="Start" subtitle="Workflow parameters"
                            icon={<span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-flow/15 text-flow"><Play className="size-5" aria-hidden="true"/></span>}>
                      <WorkflowPanel parameters={parameters} onChange={p => {
                        setParameters(p);
                        setChanged(true);
                      }}
                        acceptsInput={node.data.config.acceptsInput === true}
                        onAcceptsInput={yes => changeConfig(node.id, 'acceptsInput', yes)}
                        testInput={String(node.data.config.testInput ?? '')}
                        onTestInput={json => changeConfig(node.id, 'testInput', json)}/>
                    </FloatingWindow>
                  );
                }
                const def = BY_TYPE[node.data.type];
                if (!def) return null;
                const cat = CATEGORIES[def.category];
                const Icon = def.icon;
                return (
                  <FloatingWindow key={j.id} {...common} onDelete={() => remove(node.id)} label={`Configuration of ${node.data.label}`} title={node.data.label} subtitle={def.label}
                          icon={<span className={cn('flex size-9 shrink-0 items-center justify-center rounded-md', cat.bgColor, cat.textColor)}><Icon className="size-5" aria-hidden="true"/></span>}>
                    <PropertiesPanel
                      node={node as ComponentNode}
                      receivesRows={receivesRows(node as ComponentNode, nodes, edges)}
                      onLabel={changeLabel}
                      onData={changeData}
                      onConfig={changeConfig}
                    />
                  </FloatingWindow>
                );
              })}
            </div>
            {panelRecord && (
              <RunPanel record={panelRecord} busy={running !== null} minimized={minimized} onMinimize={setMinimized}
                        onGoTo={goTo} portName={portName} pinned={pinnedIds} onPin={pin}/>
            )}
          </main>
        </div>
      </div>
    </VariablesContext.Provider>
    </WarningsContext.Provider>
    </RunFromContext.Provider>
    </ResultContext.Provider>
    </ParametersContext.Provider>
    </HistoryContext.Provider>
  );
}

export function FlowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <ResizeObserverGuard/>
      <Editor {...props}/>
    </ReactFlowProvider>
  );
}
