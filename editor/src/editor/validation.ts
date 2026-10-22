import type {Edge} from '@xyflow/react'
import {findCycle, compatiblePorts, nameIssue, PORT_TYPES} from '@dataflow/core'
import {isFlowNode, END, START, BY_TYPE} from '@/components/catalog'
import type {FlowNode} from '@/mock/flows'
import {ERROR_PORT, errorPolicy, inputCount, outputCount, outputLabel, isOptionalOutput, portType, type ComponentNode} from './component-node'

export type Issue = {nodeId: string; message: string}

export function isComponent(node: FlowNode): node is ComponentNode {
  return node.type === 'component'
}

/** The component receives rows from another component (not only from the Start). */
export function receivesRows(node: ComponentNode, nodes: FlowNode[], edges: Edge[]) {
  return edges.some(e => e.target === node.id && nodes.find(n => n.id === e.source && isComponent(n) && n.data.type !== START))
}

/**
 * Canvas rules (each component's own come from its `validate`). Only looks at how the flow is assembled:
 * validating the data is the job of the run, which comes later.
 */
export function validateFlow(nodes: FlowNode[], edges: Edge[]): Issue[] {
  const components = nodes.filter(isComponent)
  const byId = new Map(components.map(n => [n.id, n]))
  const start = components.find(n => n.data.type === START)
  const end = components.find(n => n.data.type === END)
  const issues: Issue[] = []
  const fail = (node: ComponentNode, message: string) => issues.push({nodeId: node.id, message: `"${node.data.label}" ${message}`})

  // a cycle in the edges = infinite loop of envelopes: the flow does not even run
  const cycle = findCycle(components.map(n => n.id), edges.map(e => ({source: e.source, target: e.target})))
  if (cycle) {
    const first = byId.get(cycle[0])!
    fail(first, `is part of a cycle (infinite loop): ${cycle.map(id => byId.get(id)?.data.label ?? id).join(' → ')}.`)
  }

  // who reaches the End (walking backwards). Disabled is a bypass: it passes what comes in through in-0 to
  // out-0, so only those edges of it count
  const passes = (e: Edge) => !(byId.get(e.source)?.data.disabled && e.sourceHandle !== 'out-0')
    && !(byId.get(e.target)?.data.disabled && e.targetHandle !== 'in-0')
  const reachesEnd = new Set<string>()
  if (end) {
    reachesEnd.add(end.id)
    const queue = [end.id]
    while (queue.length) {
      const current = queue.shift()!
      for (const e of edges) {
        if (e.target !== current || reachesEnd.has(e.source) || !passes(e)) continue
        reachesEnd.add(e.source)
        queue.push(e.source)
      }
    }
  }

  if (start) {
    for (let i = 0; i < outputCount(start.data); i++) {
      if (!edges.some(e => e.source === start.id && e.sourceHandle === `out-${i}`)) fail(start, `has output ${i + 1} unconnected.`)
    }
  }
  if (end) {
    for (let i = 0; i < inputCount(end.data); i++) {
      if (!edges.some(e => e.target === end.id && e.targetHandle === `in-${i}`)) fail(end, `has input ${i + 1} unconnected.`)
    }
  }

  // edges between ports whose types do not match (e.g. an old flow or a type that changed)
  for (const e of edges) {
    const source = byId.get(e.source)
    const target = byId.get(e.target)
    if (!source || !target) continue
    const output = portType(source.data, e.sourceHandle)
    const input = portType(target.data, e.targetHandle)
    if (output && input && !compatiblePorts(output, input)) {
      fail(target, `receives ${PORT_TYPES[output].toLowerCase()} from "${source.data.label}", but the input takes ${PORT_TYPES[input].toLowerCase()}.`)
    }
  }

  // every main output must be connected (otherwise the envelopes vanish silently); this also applies to disabled ones,
  // which pass the envelopes on. To drop on purpose, connect it to the End.
  for (const node of components) {
    if (isFlowNode(node.data.type)) continue
    for (let i = 0; i < outputCount(node.data); i++) {
      if (isOptionalOutput(node.data, `out-${i}`)) continue
      if (!edges.some(e => e.source === node.id && e.sourceHandle === `out-${i}`)) {
        const name = outputLabel(node.data, i)
        fail(node, outputCount(node.data) > 1 ? `has output ${name ? `"${name}"` : i + 1} unconnected.` : 'has its output unconnected.')
      }
    }
  }

  for (const node of components) {
    const def = BY_TYPE[node.data.type]
    if (!def || isFlowNode(node.data.type) || node.data.disabled) continue
    const incoming = edges.filter(e => e.target === node.id)
    if (incoming.length === 0) {
      fail(node, 'is not connected to anything.')
      continue
    }
    if (!reachesEnd.has(node.id)) fail(node, 'does not reach the End of the flow.')
    if (errorPolicy(node.data) === 'divert' && !edges.some(e => e.source === node.id && e.sourceHandle === ERROR_PORT)) {
      fail(node, 'diverts errors, but the error output is not connected.')
    }
    if (!def.optionalInputs && incoming.length < inputCount(node.data)) fail(node, 'has an unconnected input.')
    for (const m of def.validate?.(node.data.config, {receivesRows: receivesRows(node, nodes, edges)}) ?? []) fail(node, m)
    if (!def.defaultOutputKey || node.data.override) continue // writes directly into the envelope fields (e.g. Mapper) or replaces DATA
    const keyIssue = nameIssue(node.data.outputKey ?? '')
    if (keyIssue) fail(node, `has an output key issue: ${keyIssue}.`)
    else if (components.some(o => o !== node && !o.data.disabled && o.data.outputKey === node.data.outputKey)) {
      fail(node, `uses the output key "${node.data.outputKey}", which another component also uses.`)
    }
  }

  return issues
}
