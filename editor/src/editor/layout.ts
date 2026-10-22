import {Graph, layout} from '@dagrejs/dagre'
import type {Edge} from '@xyflow/react'
import type {FlowNode} from '@/mock/flows'
import {ERROR_PORT} from './component-node'

const DEFAULT_WIDTH = 320
const DEFAULT_HEIGHT = 120

/** Position of the port on the card, top to bottom: the numbered ones in order and the error one (below the card) last. */
function portOrder(handle?: string | null): number {
  if (!handle) return 0
  if (handle === ERROR_PORT) return 1000
  return Number(handle.match(/(\d+)$/)?.[1] ?? 0)
}

type DagreNode = {rank?: number; order?: number; edgeObj?: {v: string; w: string}; borderType?: string; x: number; y: number; width: number; height: number}


type Box = {x: number; y: number; w: number; h: number}

function boxOf(n: FlowNode): Box {
  return {x: n.position.x, y: n.position.y, w: n.measured?.width ?? n.width ?? 0, h: n.measured?.height ?? n.height ?? 0}
}

const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h

/**
 * Arranges the components from left to right with Dagre (Start on the left, End on the right, each
 * branch in a lane). Whatever is entirely inside a group stays together: the group becomes a Dagre "cluster" and is
 * resized around its components. Comments follow the group they are in; loose ones stay where they are.
 */
export function arrangeHorizontally(nodes: FlowNode[], edges: Edge[]): FlowNode[] {
  const groups = nodes.filter(n => n.type === 'group')
  const components = nodes.filter(n => n.type === 'component')

  // group of each node = the smallest group that contains it entirely (a group inside a group also counts)
  const area = (c: Box) => c.w * c.h
  const groupOf = new Map<string, string>()
  for (const n of [...components, ...groups, ...nodes.filter(n => n.type === 'comment')]) {
    const parent = groups
      .filter(g => g.id !== n.id && inside(boxOf(n), boxOf(g)) && area(boxOf(g)) > area(boxOf(n)))
      .sort((a, b) => area(boxOf(a)) - area(boxOf(b)))[0]
    if (parent) groupOf.set(n.id, parent.id)
  }
  // only a group with a component inside (directly or in an inner group) goes into Dagre
  const withComponent = new Set<string>()
  for (const c of components) {
    for (let g = groupOf.get(c.id); g && !withComponent.has(g); g = groupOf.get(g)) withComponent.add(g)
  }

  const graph = new Graph({compound: withComponent.size > 0})
  // With groups: the cluster border sits (edgesep + nodesep) / 2 away from the components (room for the title) and two
  // neighboring groups sit edgesep apart (safety margin).
  graph.setGraph(withComponent.size
    ? {rankdir: 'LR', nodesep: 80, edgesep: 40, ranksep: 160, marginx: 20, marginy: 20}
    : {rankdir: 'LR', nodesep: 60, ranksep: 120, marginx: 20, marginy: 20})
  graph.setDefaultEdgeLabel(() => ({}))

  for (const n of components) {
    graph.setNode(n.id, {width: n.measured?.width ?? DEFAULT_WIDTH, height: n.measured?.height ?? DEFAULT_HEIGHT})
  }
  for (const id of withComponent) graph.setNode(id, {})
  for (const id of [...components.map(c => c.id), ...withComponent]) {
    const parent = groupOf.get(id)
    if (parent && withComponent.has(parent)) graph.setParent(id, parent)
  }
  // output port of each edge (source→target), for the vertical order
  const edgePort = new Map<string, number>()
  for (const e of edges) {
    if (!components.some(c => c.id === e.source) || !components.some(c => c.id === e.target)) continue
    graph.setEdge(e.source, e.target)
    const key = `${e.source}\u0000${e.target}`
    edgePort.set(key, Math.min(edgePort.get(key) ?? Infinity, portOrder(e.sourceHandle)))
  }

  layout(graph, {
    // Dagre minimizes crossings without seeing the ports, and on a tie it may put above what leaves the bottom port.
    // After its order, each column is reordered (left to right) by the position of whatever feeds it,
    // breaking ties by the output port: what leaves the error port stays below what leaves the main one.
    // Only nodes of the same group swap places (the group borders stay where Dagre put them).
    customOrder: (g, defaultOrder) => {
      defaultOrder(g)
      const node = (v: string) => g.node(v) as unknown as DagreNode
      const columns = new Map<number, string[]>()
      for (const v of g.nodes()) {
        const rank = node(v).rank
        if (typeof rank === 'number') columns.set(rank, [...(columns.get(rank) ?? []), v])
      }
      const port = (u: string, v: string) => {
        // Dagre dummy node (an edge that skips columns): the port is the original edge's
        const obj = node(u).edgeObj ?? node(v).edgeObj ?? {v: u, w: v}
        return edgePort.get(`${obj.v}\u0000${obj.w}`) ?? 0
      }
      const movable = (v: string) => !node(v).borderType && (g.children(v) ?? []).length === 0
      for (const rank of [...columns.keys()].sort((a, b) => a - b).slice(1)) {
        const key = new Map<string, number>()
        const byParent = new Map<string, string[]>()
        for (const v of columns.get(rank)!) {
          if (!movable(v)) continue
          const before = ((g.predecessors(v) ?? []) as string[]).filter(u => typeof node(u).order === 'number')
          key.set(v, before.length === 0 ? node(v).order!
            : before.reduce((s, u) => s + node(u).order! + port(u, v) / 10000, 0) / before.length)
          const parent = (g.isCompound() && g.parent(v)) || ''
          byParent.set(parent, [...(byParent.get(parent) ?? []), v])
        }
        for (const siblings of byParent.values()) {
          const places = siblings.map(v => node(v).order!).sort((a, b) => a - b)
          siblings
            .sort((a, b) => key.get(a)! - key.get(b)! || node(a).order! - node(b).order!)
            .forEach((v, i) => (node(v).order = places[i]))
        }
      }
    },
  })

  // groups: the cluster's box (Dagre returns the center and the size, already with the padding around the components)
  const newBox = new Map<string, Box>()
  for (const id of withComponent) {
    const p = graph.node(id) as unknown as DagreNode
    newBox.set(id, {
      x: p.x - p.width / 2, y: p.y - p.height / 2, w: p.width, h: p.height,
    })
  }
  // a comment (or a group without components) inside a group goes along: same relative position, in proportion to the
  // group's new size and without leaving it
  const finalBox = (id: string): Box | undefined => {
    const n = nodes.find(o => o.id === id)
    if (!n) return undefined
    const fresh = newBox.get(id)
    if (fresh) return fresh
    const parent = groupOf.get(id)
    const old = parent ? nodes.find(o => o.id === parent) : undefined
    const final = parent ? finalBox(parent) : undefined
    const c = boxOf(n)
    if (!old || !final) return c
    const a = boxOf(old)
    const x = Math.min(Math.max((c.x - a.x) * (final.w / (a.w || 1)), 0), Math.max(final.w - c.w, 0))
    const y = Math.min(Math.max((c.y - a.y) * (final.h / (a.h || 1)), 0), Math.max(final.h - c.h, 0))
    return {x: final.x + x, y: final.y + y, w: c.w, h: c.h}
  }

  return nodes.map(n => {
    if (n.type === 'component') {
      const p = graph.node(n.id) as unknown as DagreNode | undefined
      if (!p) return n
      // Dagre returns the center; React Flow positions by the top-left corner
      return {...n, position: {x: p.x - p.width / 2, y: p.y - p.height / 2}}
    }
    const box = newBox.get(n.id)
    if (box) return {...n, position: {x: box.x, y: box.y}, width: box.w, height: box.h}
    if (!groupOf.has(n.id)) return n
    const final = finalBox(n.id)!
    return {...n, position: {x: final.x, y: final.y}}
  })
}
