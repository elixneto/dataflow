import {useCallback, useEffect, useMemo, useRef, useState, type DragEvent} from 'react'
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
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {CircleAlert, Play, X} from 'lucide-react'
import {CATEGORIES, CATEGORY_COLOR, DRAG_MIME, isFlowNode, END, START, BY_TYPE} from '@/components/catalog'
import {cn} from '@/lib/utils'
import type {Flow, FlowNode} from '@/mock/flows'
import {getProject, EXAMPLES_PROJECT} from '@/mock/projects'
import {compatiblePorts, type RunMode, type WorkflowParameter, type RunRecord} from '@dataflow/core'
import {RunPanel} from '@/run/run-panel'
import {cancelOnRunner, runOnRunner, toExecutable} from '@/run/runner'
import {Toolbar, type ValidationResult} from './toolbar'
import {HistoryContext} from './history'
import {CommentNodeMemo, COMMENT_SIZE, type CommentNode} from './comment-node'
import {GROUP_COLORS, GroupNodeMemo, GROUP_SIZE, GROUP_Z, type GroupNode} from './group-node'
import {ComponentNodeMemo, ERROR_PORT, outputCount, outputLabel, portType, type ComponentNode} from './component-node'
import {Palette} from './palette'
import {arrangeHorizontally} from './layout'
import {FloatingWindow, type WindowPosition, type WindowSize} from './window'
import {WorkflowPanel} from './workflow-panel'
import {ParametersContext} from './parameters-context'
import {WarningsContext, ResultContext} from './result-context'
import {PropertiesPanel} from './properties-panel'
import {ResizeObserverGuard} from './resize-observer-guard'
import {isComponent, receivesRows, validateFlow, type Issue} from './validation'

type Snapshot = {nodes: FlowNode[]; edges: Edge[]}

const nodeTypes = {component: ComponentNodeMemo, comment: CommentNodeMemo, group: GroupNodeMemo}

const HISTORY_LIMIT = 100
const EDIT_WINDOW_MS = 1000
const PASTE_OFFSET = 40
const VALIDATION_DELAY_MS = 900

let counter = 0
function newId(type: string) {
  counter += 1
  return `${type}-${Date.now().toString(36)}${counter}`
}

function isEditableField(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function isFixedNode(node: FlowNode) {
  return isComponent(node) && isFlowNode(node.data.type)
}

type Props = {
  flow: Flow
  onSave: (flow: Flow) => Flow
}

function Editor({flow, onSave}: Props) {
  const wrapperRef = useRef<HTMLElement>(null)
  const {screenToFlowPosition, getNodes, getEdges, fitView} = useReactFlow<FlowNode, Edge>()
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(flow.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(flow.edges)
  const [name, setName] = useState(flow.name)
  const [base, setBase] = useState(flow)
  const [changed, setChanged] = useState(false)
  const [validation, setValidation] = useState<ValidationResult>(null)
  const [issues, setIssues] = useState<Issue[]>([])
  const [showIssues, setShowIssues] = useState(false)
  const [validating, setValidating] = useState(false)
  const [parameters, setParameters] = useState<WorkflowParameter[]>(flow.parameters ?? [])
  const [run, setRun] = useState<RunRecord | null>(null)
  const [running, setRunning] = useState<RunMode | null>(null)
  const runId = useRef<string | null>(null)
  // each component's output bump is painted by the result (it goes away when the result is closed)
  const lastRunStatus = useMemo(
    () => Object.fromEntries((run?.components ?? []).map(c => [c.nodeId, c])),
    [run],
  )
  const warnings = useMemo(() => {
    const byNode: Record<string, string[]> = {}
    const add = (id: string, msg: string) => (byNode[id] ??= []).push(msg)
    for (const p of issues) add(p.nodeId, p.message)
    for (const c of run?.components ?? []) {
      if (c.status !== 'failed' && c.status !== 'with-errors') continue
      const errors = c.logs.filter(l => l.level === 'error').map(l => l.message)
      for (const m of errors.length ? errors.slice(0, 5) : ['The run failed.']) add(c.nodeId, m)
    }
    return byNode
  }, [issues, run])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  // the <ReactFlow> fitView runs before the (tall) cards are measured; frame again once they have a size
  const nodesMeasured = useNodesInitialized()
  const framed = useRef(false)
  useEffect(() => {
    if (!nodesMeasured || framed.current) return
    framed.current = true
    requestAnimationFrame(() => fitView({padding: 0.12, maxZoom: 1}))
  }, [nodesMeasured, fitView])

  // warns before leaving with unsaved changes
  useEffect(() => {
    if (!changed) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [changed])

  const invalid = useMemo(() => new Set(issues.map(p => p.nodeId)), [issues])

  // The red highlight is only visual, but the card's updateNodeData returns the node with the className into the state.
  // That is why the className is always recomputed here (set or unset), instead of only being added to the invalid ones.
  const shownNodes = useMemo(
    () => nodes.map(n => {
      const cls = invalid.has(n.id) ? 'is-invalid' : undefined
      return n.className === cls ? n : {...n, className: cls}
    }),
    [nodes, invalid],
  )
  const shownEdges = useMemo(
    () => edges.map(e => {
      const fromError = e.sourceHandle === ERROR_PORT
      if (!fromError && !validating) return e
      return {...e, ...(validating && {animated: true}), ...(fromError && {className: 'is-error-edge'})}
    }),
    [edges, validating],
  )

  // ---------- history (Ctrl+Z / Ctrl+Shift+Z) ----------

  const past = useRef<Snapshot[]>([])
  const future = useRef<Snapshot[]>([])
  const lastEdit = useRef<{key: string; at: number} | null>(null)
  const [historySize, setHistorySize] = useState({past: 0, future: 0})

  const sync = useCallback(() => setHistorySize({past: past.current.length, future: future.current.length}), [])

  const clearValidation = useCallback(() => {
    setValidation(null)
    setIssues([])
  }, [])

  const record = useCallback(() => {
    past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), {nodes: getNodes(), edges: getEdges()}]
    future.current = []
    lastEdit.current = null
    setChanged(true)
    clearValidation()
    sync()
  }, [getNodes, getEdges, sync, clearValidation])

  const recordEdit = useCallback((key: string) => {
    const now = Date.now()
    const previous = lastEdit.current
    setChanged(true)
    if (previous && previous.key === key && now - previous.at < EDIT_WINDOW_MS) {
      lastEdit.current = {key, at: now}
      return
    }
    record()
    lastEdit.current = {key, at: now}
  }, [record])

  const undo = useCallback(() => {
    const previous = past.current.at(-1)
    if (!previous) return
    past.current = past.current.slice(0, -1)
    future.current = [...future.current, {nodes: getNodes(), edges: getEdges()}]
    lastEdit.current = null
    setNodes(previous.nodes)
    setEdges(previous.edges)
    setChanged(true)
    clearValidation()
    sync()
  }, [getNodes, getEdges, setNodes, setEdges, sync, clearValidation])

  const redo = useCallback(() => {
    const next = future.current.at(-1)
    if (!next) return
    future.current = future.current.slice(0, -1)
    past.current = [...past.current, {nodes: getNodes(), edges: getEdges()}]
    lastEdit.current = null
    setNodes(next.nodes)
    setEdges(next.edges)
    setChanged(true)
    clearValidation()
    sync()
  }, [getNodes, getEdges, setNodes, setEdges, sync, clearValidation])

  // ---------- copy / paste ----------

  const clipboard = useRef<{nodes: FlowNode[]; edges: Edge[]; pastes: number} | null>(null)

  const copy = useCallback(() => {
    const chosen = getNodes().filter(n => n.selected && !isFixedNode(n))
    if (chosen.length === 0) return false
    const ids = new Set(chosen.map(n => n.id))
    clipboard.current = {
      nodes: structuredClone(chosen),
      edges: structuredClone(getEdges().filter(e => ids.has(e.source) && ids.has(e.target))),
      pastes: 0,
    }
    return true
  }, [getNodes, getEdges])

  const paste = useCallback(() => {
    const copied = clipboard.current
    if (!copied || copied.nodes.length === 0) return
    copied.pastes += 1
    const offset = PASTE_OFFSET * copied.pastes
    const ids = new Map<string, string>()
    const added = copied.nodes.map(n => {
      const id = newId(isComponent(n) ? n.data.type : n.type ?? 'node')
      ids.set(n.id, id)
      return {...structuredClone(n), id, selected: true, dragging: false, position: {x: n.position.x + offset, y: n.position.y + offset}} as FlowNode
    })
    const addedEdges = copied.edges.map(e => ({
      ...structuredClone(e), id: newId('edge'), source: ids.get(e.source)!, target: ids.get(e.target)!, selected: false,
    }))
    record()
    setNodes(current => [...current.map(n => ({...n, selected: false})), ...added])
    setEdges(current => [...current.map(e => ({...e, selected: false})), ...addedEdges])
  }, [record, setNodes, setEdges])

  // ---------- save ----------

  const save = useCallback(() => {
    const saved = onSave({...base, name, parameters, nodes: getNodes().map(n => ({...n, selected: false, className: undefined})), edges: getEdges()})
    setBase(saved)
    setChanged(false)
  }, [base, name, parameters, getNodes, getEdges, onSave])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return
      const keyName = event.key.toLowerCase()
      if (keyName === 's') {
        event.preventDefault()
        save()
        return
      }
      if (isEditableField(event.target)) return
      if (keyName === 'c') {
        if (copy()) event.preventDefault()
      } else if (keyName === 'x') {
        if (!copy()) return
        event.preventDefault()
        const ids = new Set(getNodes().filter(n => n.selected && !isFixedNode(n)).map(n => n.id))
        record()
        setNodes(current => current.filter(n => !ids.has(n.id)))
        setEdges(current => current.filter(e => !ids.has(e.source) && !ids.has(e.target)))
        if (clipboard.current) clipboard.current.pastes = -1
      } else if (keyName === 'v') {
        if (!clipboard.current) return
        event.preventDefault()
        paste()
      } else if (keyName === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      } else if ((keyName === 'z' && event.shiftKey) || keyName === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, copy, paste, save, getNodes, record, setNodes, setEdges])

  const history = useMemo(() => ({record, recordEdit}), [record, recordEdit])

  // ---------- configuration windows (double click; one per component, several open) ----------

  const [windows, setWindows] = useState<{id: string; position: WindowPosition; size?: WindowSize}[]>([])

  // each window's position and size are remembered in this browser (per flow and component), outside the flow and Ctrl+Z
  const windowKey = useCallback((nodeId: string) => `dataflow-flows-window:${flow.id}:${nodeId}`, [flow.id])
  const readWindow = useCallback((nodeId: string): {position?: WindowPosition; size?: WindowSize} => {
    try {
      return JSON.parse(localStorage.getItem(windowKey(nodeId)) ?? '{}')
    } catch {
      return {}
    }
  }, [windowKey])
  const rememberWindow = useCallback((nodeId: string, update: {position?: WindowPosition; size?: WindowSize}) => {
    try {
      localStorage.setItem(windowKey(nodeId), JSON.stringify({...readWindow(nodeId), ...update}))
    } catch {
      // no storage: opens in the default place next time
    }
  }, [windowKey, readWindow])

  const openWindow = useCallback((id: string) => {
    const remembered = readWindow(id)
    setWindows(current => {
      const open = current.find(j => j.id === id)
      if (open) return [...current.filter(j => j.id !== id), open] // already open: only comes to the front
      const n = current.length % 8
      const node = getNodes().find(x => x.id === id)
      const fallback = node && isComponent(node) ? BY_TYPE[node.data.type]?.windowSize : undefined
      return [...current, {id, position: remembered.position ?? {x: 24 + n * 28, y: 56 + n * 28}, size: remembered.size ?? fallback}]
    })
  }, [readWindow, getNodes])
  const closeWindow = useCallback((id: string) => setWindows(current => current.filter(j => j.id !== id)), [])
  const focusWindow = useCallback((id: string) => setWindows(current =>
    current.at(-1)?.id === id ? current : [...current.filter(j => j.id !== id), current.find(j => j.id === id)!]), [])
  const moveWindow = useCallback((id: string, position: WindowPosition) => {
    setWindows(current => current.map(j => (j.id === id ? {...j, position} : j)))
    rememberWindow(id, {position})
  }, [rememberWindow])

  // a deleted component (Delete, Ctrl+X, undo...) closes its window
  useEffect(() => {
    setWindows(current => {
      const remaining = current.filter(j => nodes.some(n => n.id === j.id))
      return remaining.length === current.length ? current : remaining
    })
  }, [nodes])

  // ---------- edges ----------

  const onConnect = useCallback((connection: Connection) => {
    record()
    setEdges(current => addEdge(connection, current))
  }, [setEdges, record])

  /** Each port accepts a single edge, and only of a compatible type (envelope with envelope, any with everything...). */
  const isValidConnection: IsValidConnection = useCallback(connection => {
    if (connection.source === connection.target) return false
    const source = nodes.find(n => n.id === connection.source)
    const targetNode = nodes.find(n => n.id === connection.target)
    if (!source || !targetNode || !isComponent(source) || !isComponent(targetNode)) return false
    const outputType = portType(source.data, connection.sourceHandle)
    const inputType = portType(targetNode.data, connection.targetHandle)
    if (!outputType || !inputType || !compatiblePorts(outputType, inputType)) return false
    // the End accepts several edges on the same input (the engine merges them, like the Union)
    const inputTaken = targetNode.data.type !== END && edges.some(e => e.target === connection.target && e.targetHandle === connection.targetHandle)
    const outputTaken = edges.some(e => e.source === connection.source && e.sourceHandle === connection.sourceHandle)
    return !inputTaken && !outputTaken
  }, [edges, nodes])

  // ---------- drag from the palette ----------

  function onDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  function newNode(type: string, position: {x: number; y: number}): ComponentNode | null {
    const def = BY_TYPE[type]
    if (!def) return null
    return {
      id: newId(type), type: 'component', position, selected: true,
      data: {type, label: def.label, config: structuredClone(def.defaultConfig ?? {}), outputKey: def.defaultOutputKey ? freeKey(def.defaultOutputKey) : undefined},
    }
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    const node = newNode(event.dataTransfer.getData(DRAG_MIME), screenToFlowPosition({x: event.clientX - 128, y: event.clientY - 30}))
    if (!node) return
    record()
    setNodes(current => [...current.map(n => ({...n, selected: false})), node])
  }

  /**
   * Double click on the palette: puts the component on the canvas. With a component selected, the new one goes to its right
   * and the selected one's first free output connects to the new one's input, if the types are compatible.
   */
  function addFromPalette(type: string) {
    const currentNodes = getNodes()
    const chosen = currentNodes.filter(n => n.selected)
    const previous = chosen.length === 1 && isComponent(chosen[0]) ? chosen[0] : null
    const box = wrapperRef.current?.getBoundingClientRect()
    const center = box ? screenToFlowPosition({x: box.left + box.width / 2 - 128, y: box.top + box.height / 2 - 60}) : {x: 0, y: 0}
    const position = previous
      ? {x: previous.position.x + (previous.measured?.width ?? 288) + 80, y: previous.position.y}
      : center
    const node = newNode(type, position)
    if (!node) return

    // connects only if the selected one's output is still free and the type matches the new one's 1st input
    const newInputType = portType(node.data, 'in-0')
    const currentEdges = getEdges()
    const freeOutput = previous && newInputType
      ? Array.from({length: outputCount(previous.data)}, (_, i) => `out-${i}`).find(port => {
          const outType = portType(previous.data, port)
          return outType && compatiblePorts(outType, newInputType)
            && !currentEdges.some(e => e.source === previous.id && e.sourceHandle === port)
        })
      : undefined

    record()
    setNodes(list => [...list.map(n => ({...n, selected: false})), node])
    if (previous && freeOutput) {
      setEdges(list => addEdge({source: previous.id, sourceHandle: freeOutput, target: node.id, targetHandle: 'in-0'}, list))
    }
  }

  /** First free name for the key in DATA: mapper, mapper2, mapper3... */
  function freeKey(base: string) {
    const used = new Set(getNodes().filter(isComponent).map(n => n.data.outputKey))
    let name = base
    for (let i = 2; used.has(name); i++) name = `${base}${i}`
    return name
  }

  function addComment() {
    const box = wrapperRef.current?.getBoundingClientRect()
    const center = box ? screenToFlowPosition({x: box.left + box.width / 2, y: box.top + box.height / 2}) : {x: 0, y: 0}
    record()
    const comment: CommentNode = {
      id: newId('comment'), type: 'comment', selected: true, ...COMMENT_SIZE,
      position: {x: center.x - COMMENT_SIZE.width / 2, y: center.y - COMMENT_SIZE.height / 2},
      data: {title: '', text: '', collapsed: false},
    }
    setNodes(current => [comment, ...current.map(n => ({...n, selected: false}))])
  }

  function addGroup() {
    const box = wrapperRef.current?.getBoundingClientRect()
    const center = box ? screenToFlowPosition({x: box.left + box.width / 2, y: box.top + box.height / 2}) : {x: 0, y: 0}
    record()
    const used = getNodes().filter(n => n.type === 'group').length
    const group: GroupNode = {
      id: newId('group'), type: 'group', selected: true, zIndex: GROUP_Z, ...GROUP_SIZE,
      position: {x: center.x - GROUP_SIZE.width / 2, y: center.y - GROUP_SIZE.height / 2},
      data: {title: '', color: GROUP_COLORS[used % GROUP_COLORS.length]},
    }
    setNodes(current => [group, ...current.map(n => ({...n, selected: false}))])
  }

  /** Dragging a group takes along whatever is entirely inside it (positions from the start of the drag). */
  const groupDrag = useRef<{id: string; start: XYPosition; inside: Map<string, XYPosition>} | null>(null)

  function onDragStart(_: unknown, node: FlowNode) {
    record()
    groupDrag.current = null
    if (node.type !== 'group') return
    const width = node.measured?.width ?? node.width ?? 0
    const height = node.measured?.height ?? node.height ?? 0
    const inside = new Map<string, XYPosition>()
    for (const n of getNodes()) {
      if (n.id === node.id || n.selected) continue
      const w = n.measured?.width ?? 0
      const h = n.measured?.height ?? 0
      if (n.position.x >= node.position.x && n.position.y >= node.position.y
        && n.position.x + w <= node.position.x + width && n.position.y + h <= node.position.y + height) inside.set(n.id, n.position)
    }
    groupDrag.current = {id: node.id, start: node.position, inside}
  }

  function onDrag(_: unknown, node: FlowNode) {
    const drag = groupDrag.current
    if (!drag || drag.id !== node.id || drag.inside.size === 0) return
    const dx = node.position.x - drag.start.x
    const dy = node.position.y - drag.start.y
    setNodes(current => current.map(n => {
      const p = drag.inside.get(n.id)
      return p ? {...n, position: {x: p.x + dx, y: p.y + dy}} : n
    }))
  }

  // ---------- panel ----------

  /** Port name for the metrics: the output's label (CA, false...) or its id (out-1, in-0, error). */
  const portName = useCallback((nodeId: string, port: string) => {
    const [side, n] = port.split('-')
    const node = nodes.find(x => x.id === nodeId)
    if (side === 'out' && node && isComponent(node)) return outputLabel(node.data, Number(n)) ?? port
    return port
  }, [nodes])

  const changeLabel = useCallback((id: string, label: string) => {
    recordEdit(`${id}:label`)
    setNodes(current => current.map(n => (n.id === id && isComponent(n) ? {...n, data: {...n.data, label}} : n)))
  }, [setNodes, recordEdit])

  const changeData = useCallback((id: string, update: Partial<Pick<ComponentNode['data'], 'outputKey' | 'override' | 'notes'>>) => {
    recordEdit(`${id}:${Object.keys(update).join(',')}`)
    setNodes(current => current.map(n => (n.id === id && isComponent(n) ? {...n, data: {...n.data, ...update}} : n)))
  }, [setNodes, recordEdit])

  const changeConfig = useCallback((id: string, key: string, value: unknown) => {
    recordEdit(`${id}:${key}`)
    setNodes(current => current.map(n => (n.id === id && isComponent(n) ? {...n, data: {...n.data, config: {...n.data.config, [key]: value}}} : n)))
  }, [setNodes, recordEdit])

  const remove = useCallback((id: string) => {
    record()
    setNodes(current => current.filter(n => n.id !== id))
    setEdges(current => current.filter(e => e.source !== id && e.target !== id))
  }, [setNodes, setEdges, record])

  function goTo(nodeId: string) {
    setNodes(current => current.map(n => ({...n, selected: n.id === nodeId})))
    fitView({nodes: [{id: nodeId}], duration: 400, maxZoom: 1.1, padding: 0.6})
  }

  // ---------- validate / clear ----------

  /** Checks the assembly; if it is ok, runs it on the runner (validation = simulates, execution = for real). */
  function execute(mode: RunMode) {
    if (validating || running) return
    clearValidation()
    setValidating(true)
    timer.current = setTimeout(async () => {
      const found = validateFlow(getNodes(), getEdges())
      setIssues(found)
      setValidating(false)
      if (found.length > 0) {
        setValidation({ok: false, messages: found.map(p => p.message)})
        setShowIssues(true)
        return
      }
      setRunning(mode)
      try {
        runId.current = crypto.randomUUID()
        const result = await runOnRunner(toExecutable(name, parameters, getNodes(), getEdges(), flow.id, flow.projectId), mode, runId.current, undefined, flow.projectId)
        setRun(result)
        setIssues(result.components.filter(c => c.status === 'failed').map(c => ({nodeId: c.nodeId, message: `"${c.label}" failed.`})))
        setValidation(result.status === 'failed'
          ? {ok: false, messages: [result.error ?? 'The run failed.']}
          : {ok: true, messages: [result.status === 'completed' ? 'Run completed.' : result.status === 'with-warnings' ? 'Run completed with warnings.' : 'Run completed with errors.']})
      } catch (e) {
        setValidation({ok: false, messages: [e instanceof Error ? e.message : String(e)]})
      } finally {
        setRunning(null)
      }
    }, VALIDATION_DELAY_MS)
  }

  /** Arranges the flow from left to right (Dagre) and frames it; undone with Ctrl+Z. */
  function arrange() {
    record()
    setNodes(current => arrangeHorizontally(current, getEdges()))
    requestAnimationFrame(() => fitView({padding: 0.15, maxZoom: 1, duration: 300}))
  }

  function clear() {
    record()
    setNodes(current => current.filter(isFixedNode))
    setEdges([])
  }

  return (
    <HistoryContext.Provider value={history}>
    <ParametersContext.Provider value={parameters}>
    <ResultContext.Provider value={lastRunStatus}>
    <WarningsContext.Provider value={warnings}>
      <div className="flex h-dvh flex-col">
        <Toolbar
          project={{id: flow.projectId ?? EXAMPLES_PROJECT, name: getProject(flow.projectId ?? EXAMPLES_PROJECT)?.name ?? 'Project'}}
          folder={flow.folder}
          name={name}
          onName={v => {
            setName(v)
            setChanged(true)
          }}
          validation={validation}
          onRun={() => execute('execution')}
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
          onShowIssues={() => setShowIssues(v => !v)}
        />
        <div className="flex min-h-0 flex-1">
          <Palette onAdd={addFromPalette}/>
          <main ref={wrapperRef} className="relative min-w-0 flex-1" onDragOver={onDragOver} onDrop={onDrop}>
            <h1 className="sr-only">Flow canvas</h1>
            <ReactFlow
              nodes={shownNodes}
              edges={shownEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onNodeDoubleClick={(_, n) => {
                if (n.type === 'component' && (isComponent(n) && (!isFixedNode(n) || n.data.type === START))) openWindow(n.id)
              }}
              zoomOnDoubleClick={false}
              elevateNodesOnSelect={false}
              onNodeDragStart={onDragStart}
              onNodeDrag={onDrag}
              onSelectionDragStart={record}
              onBeforeDelete={async () => {
                record()
                return true
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
                  const node = n as FlowNode
                  if (node.type === 'group') return `color-mix(in oklch, ${node.data.color} 20%, transparent)`
                  if (!isComponent(node)) return 'color-mix(in oklch, var(--comment) 45%, transparent)'
                  const category = BY_TYPE[node.data.type]?.category
                  return category ? CATEGORY_COLOR[category] : 'var(--muted)'
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
            <div data-windows className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
              {windows.map((j, i) => {
                const node = nodes.find(n => n.id === j.id)
                if (!node || !isComponent(node)) return null
                const active = i === windows.length - 1
                const common = {
                  position: j.position, initialSize: j.size, z: i + 1, active,
                  onMove: (p: WindowPosition) => moveWindow(j.id, p),
                  onResize: (t: WindowSize) => rememberWindow(j.id, {size: t}),
                  onFocus: () => focusWindow(j.id),
                  onClose: () => closeWindow(j.id),
                }
                if (node.data.type === START) {
                  return (
                    <FloatingWindow key={j.id} {...common} label="Workflow parameters" title="Start" subtitle="Workflow parameters"
                            icon={<span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-flow/15 text-flow"><Play className="size-5" aria-hidden="true"/></span>}>
                      <WorkflowPanel parameters={parameters} onChange={p => {
                        setParameters(p)
                        setChanged(true)
                      }}
                        acceptsInput={node.data.config.acceptsInput === true}
                        onAcceptsInput={yes => changeConfig(node.id, 'acceptsInput', yes)}
                        testInput={String(node.data.config.testInput ?? '')}
                        onTestInput={json => changeConfig(node.id, 'testInput', json)}/>
                    </FloatingWindow>
                  )
                }
                const def = BY_TYPE[node.data.type]
                if (!def) return null
                const cat = CATEGORIES[def.category]
                const Icon = def.icon
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
                )
              })}
            </div>
            {run && (
              <RunPanel key={run.run.id} record={run} onClose={() => setRun(null)} onGoTo={goTo} portName={portName}/>
            )}
          </main>
        </div>
      </div>
    </WarningsContext.Provider>
    </ResultContext.Provider>
    </ParametersContext.Provider>
    </HistoryContext.Provider>
  )
}

export function FlowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <ResizeObserverGuard/>
      <Editor {...props}/>
    </ReactFlowProvider>
  )
}
