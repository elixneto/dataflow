import type {Envelope, PortType} from './types'

/** Names that cannot be DATA keys (they are the system variables in expressions). */
export const RESERVED_NAMES = ['WORKFLOW_CURRENT_RUN', 'PARAMETERS', 'SECRETS', 'DATA']

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Issue with the name of an output key (or a field), or null if it is fine. */
export function nameIssue(name: string): string | null {
  if (!name) return 'has no name'
  if (!IDENTIFIER.test(name)) return `"${name}" is not a valid name (letters, digits and _, not starting with a digit)`
  if (RESERVED_NAMES.includes(name)) return `"${name}" is a reserved name`
  return null
}

/**
 * Variables an expression sees in an envelope: the system ones and, directly, each DATA key.
 * E.g.: $PARAMETERS.prefix, $WORKFLOW_CURRENT_RUN.startedAt, $csvLine.NAME.
 */
export function envelopeVariables(doc: Envelope, secrets: Record<string, string> = {}): Record<string, unknown> {
  const variables: Record<string, unknown> = {
    $WORKFLOW_CURRENT_RUN: doc.WORKFLOW_CURRENT_RUN,
    $PARAMETERS: doc.PARAMETERS,
    $SECRETS: secrets,
  }
  for (const [key, value] of Object.entries(doc.DATA)) variables[`$${key}`] = value
  return variables
}

/** New envelope with the component's key in DATA (Override: only that key). */
export function withKey(doc: Envelope, key: string, value: unknown, override = false): Envelope {
  return {
    WORKFLOW_CURRENT_RUN: doc.WORKFLOW_CURRENT_RUN,
    PARAMETERS: doc.PARAMETERS,
    DATA: override ? {[key]: value} : {...doc.DATA, [key]: value},
  }
}

/** New envelope with the fields written directly into DATA (adds or replaces). Override: only these fields. */
export function mergeFields(doc: Envelope, fields: Record<string, unknown>, override = false): Envelope {
  return {
    WORKFLOW_CURRENT_RUN: doc.WORKFLOW_CURRENT_RUN,
    PARAMETERS: doc.PARAMETERS,
    DATA: override ? {...fields} : {...doc.DATA, ...fields},
  }
}

export const PORT_TYPES: Record<PortType, string> = {
  envelope: 'Envelopes',
  text: 'Text',
  number: 'Number',
  json: 'JSON',
  any: 'Any',
}

/** An output can connect to an input when the type is the same or one of the sides is `any`. */
export function compatiblePorts(output: PortType, input: PortType) {
  return output === input || output === 'any' || input === 'any'
}

/**
 * Normalizes anything thrown into an Error, keeping its type (name). Errors from node:vm come from another
 * "realm" and fail `instanceof Error`, so the check is by shape.
 */
export function toError(e: unknown): Error {
  if (e instanceof Error) return e
  if (e && typeof e === 'object' && 'message' in e) {
    const error = new Error(String((e as {message: unknown}).message))
    error.name = 'name' in e ? String((e as {name: unknown}).name) : 'Error'
    return error
  }
  return new Error(String(e))
}

/**
 * Looks for a cycle in the edges (the workflow must be acyclic: a cycle is an infinite loop of envelopes).
 * Returns the ids of the cycle in order (the first one repeats at the end), or null.
 */
export function findCycle(ids: string[], edges: {source: string; target: string}[]): string[] | null {
  const outputs = new Map(ids.map(id => [id, edges.filter(e => e.source === id).map(e => e.target)]))
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []
  function visit(id: string): string[] | null {
    state.set(id, 'visiting')
    stack.push(id)
    for (const next of outputs.get(id) ?? []) {
      if (state.get(next) === 'visiting') return [...stack.slice(stack.indexOf(next)), next]
      if (!state.has(next)) {
        const cycle = visit(next)
        if (cycle) return cycle
      }
    }
    stack.pop()
    state.set(id, 'done')
    return null
  }
  for (const id of ids) {
    if (!state.has(id)) {
      const cycle = visit(id)
      if (cycle) return cycle
    }
  }
  return null
}
