import {describe, expect, test} from 'bun:test'
import vm from 'node:vm'
import {COMPONENTS, runWorkflow, usedParameters, compatiblePorts, readOnlyIssue} from './index'
import type {ExecutableWorkflow} from './index'

const evaluate = (expr: string, vars: Record<string, unknown>) => vm.runInNewContext(`(${expr})`, {...vars}, {timeout: 200})

const wf: ExecutableWorkflow = {
  project: 'Test', workflow: 'Concatenate',
  parameters: [{name: 'prefix', type: 'text', default: 'IMP'}],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {}},
    {id: 'm', type: 'mapper', label: 'Mapper', outputKey: 'code', config: {fields: [
      {target: 'value', value: '`${$PARAMETERS.prefix}-${$WORKFLOW_CURRENT_RUN.startedAt}`', expression: true},
      {target: 'fixed', value: 'plain text', expression: false},
    ]}},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [
    {source: 'start', sourcePort: 'out-0', target: 'm', targetPort: 'in-0'},
    {source: 'm', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
  ],
}

test('mapper concatenates a parameter with startedAt', async () => {
  const r = await runWorkflow(wf, {mode: 'validation', id: 'test', evaluate, parameterValues: {prefix: 'ABC'}})
  expect(r.status).toBe('completed')
  const m = r.components.find(c => c.nodeId === 'm')!
  expect(m.inputs['in-0']).toBe(1)
  expect(m.outputs['out-0']).toBe(1)
  const output = m.outputSample['out-0'][0] as {value: string; fixed: string}
  expect(output.value).toBe(`ABC-${r.run.startedAt}`)
  expect(output.fixed).toBe('plain text')
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(1)
})

test('an expression with an error stops the run (default policy)', async () => {
  const withError = structuredClone(wf)
  withError.nodes[1].config = {fields: [{target: 'x', value: '$doesNotExist.y', expression: true}]}
  const r = await runWorkflow(withError, {mode: 'execution', id: 't2', evaluate})
  expect(r.status).toBe('failed')
  expect(r.components.find(c => c.nodeId === 'm')!.status).toBe('failed')
})

test('the record comes in flow order, not node order', async () => {
  const shuffled = {...wf, nodes: [wf.nodes[2], wf.nodes[1], wf.nodes[0]]}
  const r = await runWorkflow(shuffled, {mode: 'validation', id: 't3', evaluate})
  expect(r.components.map(c => c.nodeId)).toEqual(['start', 'm', 'end'])
})

test('mapper writes directly into the envelope and the next one sees it', async () => {
  const twoMappers: ExecutableWorkflow = {
    project: 'Test', workflow: 'Two mappers', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'm1', type: 'mapper', label: 'Mapper 1', config: {fields: [{target: 'field', value: 'PINEAPPLE', expression: false}]}},
      {id: 'm2', type: 'mapper', label: 'Mapper 2', config: {fields: [{target: 'otherField', value: '$field + " 123"', expression: true}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'm1', targetPort: 'in-0'},
      {source: 'm1', sourcePort: 'out-0', target: 'm2', targetPort: 'in-0'},
      {source: 'm2', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  }
  const r = await runWorkflow(twoMappers, {mode: 'validation', id: 't4', evaluate})
  expect(r.status).toBe('completed')
  expect(r.components.find(c => c.nodeId === 'm2')!.outputSample['out-0'][0]).toEqual({field: 'PINEAPPLE', otherField: 'PINEAPPLE 123'})

  // Override on the second one: only what it mapped
  twoMappers.nodes[2].override = true
  const r2 = await runWorkflow(twoMappers, {mode: 'validation', id: 't5', evaluate})
  expect(r2.components.find(c => c.nodeId === 'm2')!.outputSample['out-0'][0]).toEqual({otherField: 'PINEAPPLE 123'})
})

test('a Start that accepts input puts the body in the envelope; without the option, it fails', async () => {
  const withInput = structuredClone(wf)
  withInput.nodes[0].config = {acceptsInput: true}
  withInput.nodes[1].config = {fields: [{target: 'greeting', value: '"Hello " + $name', expression: true}]}
  const r = await runWorkflow(withInput, {mode: 'validation', id: 't6', evaluate, input: {name: 'Élix'}})
  expect(r.status).toBe('completed')
  expect(r.components.find(c => c.nodeId === 'm')!.outputSample['out-0'][0]).toEqual({name: 'Élix', greeting: 'Hello Élix'})

  const withoutOption = await runWorkflow(wf, {mode: 'validation', id: 't7', evaluate, input: {name: 'x'}})
  expect(withoutOption.status).toBe('failed')
  expect(withoutOption.error).toContain('does not accept input')
})

test('an array input fires one envelope per item', async () => {
  const withInput = structuredClone(wf)
  withInput.nodes[0].config = {acceptsInput: true}
  withInput.nodes[1].config = {fields: [{target: 'greeting', value: '"Hello " + $name', expression: true}]}
  const r = await runWorkflow(withInput, {mode: 'validation', id: 't8', evaluate, input: [{name: 'Élix 1'}, {name: 'Élix 2'}]})
  expect(r.status).toBe('completed')
  const start = r.components.find(c => c.nodeId === 'start')!
  expect(start.inputs['in-0']).toBe(2)
  expect(start.outputs['out-0']).toBe(2)
  const m = r.components.find(c => c.nodeId === 'm')!
  expect(m.outputSample['out-0']).toEqual([{name: 'Élix 1', greeting: 'Hello Élix 1'}, {name: 'Élix 2', greeting: 'Hello Élix 2'}])
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(2)
})

test('port compatibility', () => {
  expect(compatiblePorts('envelope', 'envelope')).toBe(true)
  expect(compatiblePorts('envelope', 'text')).toBe(false)
  expect(compatiblePorts('text', 'any')).toBe(true)
  expect(compatiblePorts('any', 'number')).toBe(true)
})

test('Continue: on error, the incoming envelope moves on unchanged', async () => {
  const withError = structuredClone(wf)
  withError.nodes[0].config = {acceptsInput: true}
  withError.nodes[1].config = {onError: 'continue', fields: [{target: 'x', value: '$doesNotExist.y', expression: true}]}
  const r = await runWorkflow(withError, {mode: 'validation', id: 't9', evaluate, input: [{name: 'A'}, {name: 'B'}]})
  expect(r.status).toBe('with-errors')
  const m = r.components.find(c => c.nodeId === 'm')!
  expect(m.status).toBe('with-errors')
  expect(m.outputs['out-0']).toBe(2)
  expect(m.outputSample['out-0']).toEqual([{name: 'A'}, {name: 'B'}])
  expect(m.logs.filter(l => l.level === 'error')).toHaveLength(2)
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(2)
})

test('disabled with a loose output: bypass, dropped envelope and nothing at the End become warnings', async () => {
  const loose: ExecutableWorkflow = {
    project: 'Test', workflow: 'Loose', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'm1', type: 'mapper', label: 'Mapper 1', disabled: true, config: {onError: 'divert', fields: [{target: 'x', value: 'a', expression: true}]}},
      {id: 'm2', type: 'mapper', label: 'Mapper 2', config: {fields: [{target: 'status', value: 'ERR', expression: false}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'm1', targetPort: 'in-0'},
      {source: 'm1', sourcePort: 'error', target: 'm2', targetPort: 'in-0'},
      {source: 'm2', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  }
  const r = await runWorkflow(loose, {mode: 'execution', id: 't10', evaluate})
  const m1 = r.components.find(c => c.nodeId === 'm1')!
  expect(m1.status).toBe('disabled')
  expect(m1.logs.some(l => l.message.includes('dropped'))).toBe(true)
  expect(r.components.find(c => c.nodeId === 'end')!.status).toBe('with-warnings')
  expect(r.status).toBe('with-warnings')
})

function flowWithUnion(): ExecutableWorkflow {
  return {
    project: 'Test', workflow: 'Union', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'ok', type: 'mapper', label: 'Mapper', config: {onError: 'divert', fields: [{target: 'double', value: '$n * 2 + $failure.x', expression: true}]}},
      {id: 'handle', type: 'mapper', label: 'Handle error', config: {fields: [{target: 'status', value: 'ERROR', expression: false}]}},
      {id: 'union', type: 'union', label: 'Union', config: {inputCount: 2}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'ok', targetPort: 'in-0'},
      {source: 'ok', sourcePort: 'out-0', target: 'union', targetPort: 'in-0'},
      {source: 'ok', sourcePort: 'error', target: 'handle', targetPort: 'in-0'},
      {source: 'handle', sourcePort: 'out-0', target: 'union', targetPort: 'in-1'},
      {source: 'union', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  }
}

test('Union joins the normal output and the error handling one', async () => {
  const wfUnion = flowWithUnion()
  // $failure only exists in the 2nd envelope: the 1st one fails (goes to "handle"), the 2nd passes
  const r = await runWorkflow(wfUnion, {mode: 'execution', id: 't11', evaluate, input: [{n: 1}, {n: 2, failure: {x: 0}}]})
  const joined = r.components.find(c => c.nodeId === 'union')!
  expect(joined.inputs).toEqual({'in-0': 1, 'in-1': 1})
  expect(joined.outputs['out-0']).toBe(2)
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(2)
  // what goes out through the error port carries DATA.errors
  expect(r.components.find(c => c.nodeId === 'handle')!.inputSample[0].errors).toEqual([
    {error: 'ReferenceError', message: expect.stringContaining('$failure is not defined'), component: 'Mapper'},
  ])
  // the error was diverted and handled: the run is a success
  expect(r.components.find(c => c.nodeId === 'ok')!.status).toBe('completed')
  expect(r.status).toBe('completed')
})

test('a cycle in the edges does not run (infinite loop)', async () => {
  const withCycle: ExecutableWorkflow = {
    project: 'Test', workflow: 'Cycle', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'union', type: 'union', label: 'Union', config: {inputCount: 2}},
      {id: 'm1', type: 'mapper', label: 'Mapper 1', config: {onError: 'divert', fields: [{target: 'x', value: '$y.z', expression: true}]}},
      {id: 'm2', type: 'mapper', label: 'Mapper 2', config: {fields: [{target: 's', value: 'ERROR', expression: false}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'union', targetPort: 'in-0'},
      {source: 'union', sourcePort: 'out-0', target: 'm1', targetPort: 'in-0'},
      {source: 'm1', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
      {source: 'm1', sourcePort: 'error', target: 'm2', targetPort: 'in-0'},
      {source: 'm2', sourcePort: 'out-0', target: 'union', targetPort: 'in-1'},
    ],
  }
  const r = await runWorkflow(withCycle, {mode: 'execution', id: 't13', evaluate})
  expect(r.status).toBe('failed')
  expect(r.error).toContain('Union → Mapper 1 → Mapper 2 → Union')
})

test('run cancelled by the signal', async () => {
  const control = new AbortController()
  control.abort()
  const r = await runWorkflow(wf, {mode: 'execution', id: 't14', evaluate, signal: control.signal})
  expect(r.status).toBe('failed')
  expect(r.error).toBe('Run cancelled.')
})

test('Filter sends each envelope to true or false by the condition', async () => {
  const withFilter: ExecutableWorkflow = {
    project: 'Test', workflow: 'Filter', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'f', type: 'filter', label: 'Filter', config: {condition: '$price > 10'}},
      {id: 'u', type: 'union', label: 'Union', config: {inputCount: 2}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'f', targetPort: 'in-0'},
      {source: 'f', sourcePort: 'out-0', target: 'u', targetPort: 'in-0'},
      {source: 'f', sourcePort: 'out-1', target: 'u', targetPort: 'in-1'},
      {source: 'u', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  }
  const input = [{price: 5}, {price: 20}, {price: 30}, {price: 0}, {price: 11}]
  const r = await runWorkflow(withFilter, {mode: 'execution', id: 'tf', evaluate, input})
  expect(r.status).toBe('completed')
  const f = r.components.find(c => c.nodeId === 'f')!
  expect(f.outputs).toEqual({'out-0': 3, 'out-1': 2})
  expect(f.outputSample['out-1']).toEqual([{price: 5}, {price: 0}])

  // a failing condition is an error of the envelope (default policy: stop)
  withFilter.nodes[1].config = {condition: '$doesNotExist > 1'}
  const withError = await runWorkflow(withFilter, {mode: 'execution', id: 'tf2', evaluate, input})
  expect(withError.status).toBe('failed')
})

test('Filter with an unconnected false drops without a warning', async () => {
  const onlyTrue: ExecutableWorkflow = {
    project: 'Test', workflow: 'Filter only true', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'f', type: 'filter', label: 'Filter', config: {condition: '$price > 10'}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'f', targetPort: 'in-0'},
      {source: 'f', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  }
  const r = await runWorkflow(onlyTrue, {mode: 'execution', id: 'tf3', evaluate, input: [{price: 5}, {price: 20}]})
  expect(r.status).toBe('completed')
  expect(r.components.find(c => c.nodeId === 'f')!.status).toBe('completed')
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(1)
})

test('Router sends each envelope to the first true case or to the else', async () => {
  const withRouter: ExecutableWorkflow = {
    project: 'Test', workflow: 'Router', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'r', type: 'router', label: 'Router', config: {cases: [
        {label: 'SP', condition: '$state === "SP"'},
        {label: 'South', condition: '["PR", "SC", "RS"].includes($state)'},
      ]}},
      {id: 'u', type: 'union', label: 'Union', config: {inputCount: 2}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'r', targetPort: 'in-0'},
      {source: 'r', sourcePort: 'out-0', target: 'u', targetPort: 'in-0'},
      {source: 'r', sourcePort: 'out-1', target: 'u', targetPort: 'in-1'},
      // else (out-2) unconnected: drops without a warning
      {source: 'u', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  }
  const input = [{state: 'SP'}, {state: 'RS'}, {state: 'BA'}, {state: 'SC'}, {state: 'SP'}]
  const r = await runWorkflow(withRouter, {mode: 'execution', id: 'tr', evaluate, input})
  expect(r.status).toBe('completed')
  const router = r.components.find(c => c.nodeId === 'r')!
  expect(router.status).toBe('completed')
  expect(router.outputs).toEqual({'out-0': 2, 'out-1': 2, 'out-2': 1})
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(4)
})

test('End accepts several edges into the same input', async () => {
  const twoPaths: ExecutableWorkflow = {
    project: 'Test', workflow: 'End with several edges', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'f', type: 'filter', label: 'Filter', config: {condition: '$n > 2'}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'f', targetPort: 'in-0'},
      {source: 'f', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
      {source: 'f', sourcePort: 'out-1', target: 'end', targetPort: 'in-0'},
    ],
  }
  const input = Array.from({length: 100}, (_, i) => ({n: i}))
  const r = await runWorkflow(twoPaths, {mode: 'execution', id: 'te', evaluate, input})
  expect(r.status).toBe('completed')
  expect(r.components.find(c => c.nodeId === 'end')!.inputs['in-0']).toBe(100)
})

test('Lookup writes the found envelope into the output key (null when not found) and the Mapper picks the fields', async () => {
  // both inputs come from the same Router: the main one must not deadlock waiting for the lookup to finish
  const withLookup: ExecutableWorkflow = {
    project: 'Test', workflow: 'Lookup', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'r', type: 'router', label: 'Router', config: {cases: [{label: 'company', condition: '$kind === "company"'}]}},
      {id: 'l', type: 'lookup', label: 'Lookup', outputKey: 'company', config: {keys: [{main: '$companyCode', lookup: '$code'}]}},
      {id: 'm', type: 'mapper', label: 'Mapper', config: {fields: [
        {target: 'companyId', value: '$company?.id ?? null', expression: true},
        {target: 'companyName', value: '$company?.name ?? "(no company)"', expression: true},
      ]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'r', targetPort: 'in-0'},
      {source: 'r', sourcePort: 'out-1', target: 'l', targetPort: 'in-0'},
      {source: 'r', sourcePort: 'out-0', target: 'l', targetPort: 'in-1'},
      {source: 'l', sourcePort: 'out-0', target: 'm', targetPort: 'in-0'},
      {source: 'm', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  }
  const tickets = Array.from({length: 200}, (_, i) => ({kind: 'ticket', id: i, companyCode: i % 3 === 2 ? 99 : String(i % 3)}))
  const companies = [{kind: 'company', code: 0, id: 'A', name: 'Alpha'}, {kind: 'company', code: 1, id: 'B', name: 'Beta'}]
  const r = await runWorkflow(withLookup, {mode: 'execution', id: 'tl', evaluate, input: [...tickets, ...companies]})
  expect(r.status).toBe('completed')
  const l = r.components.find(c => c.nodeId === 'l')!
  expect(l.outputs['out-0']).toBe(200)
  const sample = l.outputSample['out-0'] as {company: {id: string} | null}[]
  expect(sample.slice(0, 3).map(a => a.company?.id ?? null)).toEqual(['A', 'B', null])
  const mapped = r.components.find(c => c.nodeId === 'm')!.outputSample['out-0'] as {companyId: unknown; companyName: string}[]
  expect(mapped.slice(0, 3).map(a => [a.companyId, a.companyName])).toEqual([['A', 'Alpha'], ['B', 'Beta'], [null, '(no company)']])

  // with Override, DATA becomes only the found envelope
  withLookup.nodes[2].override = true
  withLookup.nodes[3].config = {fields: [{target: 'x', value: '1', expression: false}]}
  const onlyFound = await runWorkflow(withLookup, {mode: 'execution', id: 'tlo', evaluate, input: [...tickets, ...companies]})
  expect(onlyFound.components.find(c => c.nodeId === 'l')!.outputSample['out-0'].slice(0, 3))
    .toEqual([{kind: 'company', code: 0, id: 'A', name: 'Alpha'}, {kind: 'company', code: 1, id: 'B', name: 'Beta'}, {}])
  withLookup.nodes[2].override = false

  // no match becomes an error of the envelope with "error"
  withLookup.nodes[2].config = {...withLookup.nodes[2].config, ifNotFound: 'error'}
  const withError = await runWorkflow(withLookup, {mode: 'execution', id: 'tl2', evaluate, input: [...tickets, ...companies]})
  expect(withError.status).toBe('failed')
})

test('active time does not count the wait, and Aggregate reports the batch peak', async () => {
  const slow: ExecutableWorkflow = {
    project: 'Test', workflow: 'Metrics', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'ts', type: 'typescript', label: 'Slow', override: true, config: {code: 'async function process($input) {}'}},
      {id: 'm', type: 'mapper', label: 'Mapper', config: {fields: [{target: 'b', value: '$a * 2', expression: true}]}},
      {id: 'ag', type: 'aggregate', label: 'Aggregate', config: {size: 4}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'ts', targetPort: 'in-0'},
      {source: 'ts', sourcePort: 'out-0', target: 'm', targetPort: 'in-0'},
      {source: 'm', sourcePort: 'out-0', target: 'ag', targetPort: 'in-0'},
      {source: 'ag', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  }
  // the "script" waits 30 ms per envelope (like an HTTP call) and returns its own DATA
  const prepareScript = async () => async (input: unknown) => {
    await new Promise(r => setTimeout(r, 30))
    return input
  }
  const r = await runWorkflow(slow, {
    mode: 'execution', id: 'metrics', evaluate, prepareScript, input: Array.from({length: 6}, (_, i) => ({a: i})),
  })
  expect(r.status).toBe('completed')
  const byId = (id: string) => r.components.find(c => c.nodeId === id)!
  // the script awaits inside: counts as active
  expect(byId('ts').activeTimeMs!).toBeGreaterThan(150)
  // the Mapper spent the run waiting for the script: it is active much less than it lasted
  expect(byId('m').durationMs!).toBeGreaterThan(100)
  expect(byId('m').activeTimeMs!).toBeLessThan(byId('m').durationMs! / 2)
  expect(byId('ag').memory?.peakEnvelopes).toBe(4)
  // peak × average size of the DATA JSON ({"a":0,"b":0} has 13; with b = 10, 14)
  expect(byId('ag').memory!.peakBytes).toBeGreaterThanOrEqual(4 * 13)
  expect(byId('ag').memory!.peakBytes).toBeLessThanOrEqual(4 * 14)
  // whoever holds nothing has no memory
  expect(byId('m').memory).toBeUndefined()
})

test('data grid yields one envelope per row, with the columns converted by type', async () => {
  const grid: ExecutableWorkflow = {
    project: 'Test', workflow: 'Data Grid', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'g', type: 'datagrid', label: 'Data Grid', config: {
        columns: [{name: 'code', type: 'text'}, {name: 'weight', type: 'number'}, {name: 'active', type: 'boolean'}],
        rows: [['A1', '1,5', 'yes'], ['B2', '', 'false']],
      }},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'g', targetPort: 'in-0'},
      {source: 'g', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  }
  const r = await runWorkflow(grid, {mode: 'execution', id: 'grid', evaluate})
  expect(r.status).toBe('completed')
  expect(r.components.find(c => c.nodeId === 'g')!.outputSample['out-0']).toEqual([
    {code: 'A1', weight: 1.5, active: true},
    {code: 'B2', weight: null, active: false},
  ])
})

test('data grid flags a cell that does not convert and a column without a name', () => {
  const config = {columns: [{name: 'n', type: 'number'}, {name: '', type: 'text'}], rows: [['abc', 'x']]}
  const issues = COMPONENTS.datagrid.validate(config)
  expect(issues.some(p => p.includes('"abc" is not a number'))).toBe(true)
  expect(issues.some(p => p.startsWith('column 2'))).toBe(true)
})

test('copy sends each envelope to every output, and one path does not touch the other', async () => {
  const withCopy: ExecutableWorkflow = {
    project: 'Test', workflow: 'Copy', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'c', type: 'copy', label: 'Copy', config: {outputCount: 3}},
      {id: 'ts', type: 'typescript', label: 'Changes', override: true, config: {code: 'async function process($input) {}'}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'c', targetPort: 'in-0'},
      {source: 'c', sourcePort: 'out-0', target: 'ts', targetPort: 'in-0'},
      {source: 'ts', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
      {source: 'c', sourcePort: 'out-1', target: 'end', targetPort: 'in-0'},
      {source: 'c', sourcePort: 'out-2', target: 'end', targetPort: 'in-0'},
    ],
  }
  // the script changes its own $input (which one path must not see in the other)
  const prepareScript = async () => async (input: unknown) => {
    (input as {person: {name: string}}).person.name = 'CHANGED'
    return input
  }
  const r = await runWorkflow(withCopy, {
    mode: 'execution', id: 'copy', evaluate, prepareScript, input: [{person: {name: 'ana'}}, {person: {name: 'bia'}}],
  })
  expect(r.status).toBe('completed')
  const c = r.components.find(x => x.nodeId === 'c')!
  expect(c.outputs).toEqual({'out-0': 2, 'out-1': 2, 'out-2': 2})
  expect(r.components.find(x => x.nodeId === 'end')!.inputs['in-0']).toBe(6)
  expect(c.outputSample['out-1']).toEqual([{person: {name: 'ana'}}, {person: {name: 'bia'}}])
  const namesAtEnd = r.components.find(x => x.nodeId === 'end')!.inputSample.map(d => (d as {person: {name: string}}).person.name)
  expect(namesAtEnd.filter(n => n === 'CHANGED')).toHaveLength(2)
})

test('SQL Server Query only accepts read-only queries', () => {
  const ok = ['SELECT * FROM Ticket WHERE id > @last', 'with x as (select 1 as a) select a from x;', "SELECT 'INSERT INTO x' AS text -- DELETE\nFROM [Update]"]
  for (const sql of ok) expect(readOnlyIssue(sql)).toBeNull()
  const bad: [string, string][] = [
    ['DELETE FROM Ticket', 'SELECT or WITH'],
    ['SELECT * INTO copy FROM Ticket', 'INTO'],
    ['SELECT 1; DROP TABLE Ticket', 'more than one statement'],
    ['WITH x AS (SELECT 1 a) UPDATE t SET a = 1', 'UPDATE'],
    ['SELECT * FROM t WHERE 1 = 1 EXEC xp_cmdshell', 'EXEC'],
    ['SELECT sp_who', 'sp_who'],
    // comments and strings: whatever opens first wins, and blocks can be nested (like in SQL Server)
    ['-- header\nUPDATE t SET a = 1', 'SELECT or WITH'],
    ["SELECT '--', 1; DELETE FROM t", 'more than one statement'],
    ["SELECT '/*' AS a; DELETE FROM t --*/", 'more than one statement'],
    ['/* /* nested */ SELECT 1 */ DELETE FROM t', 'SELECT or WITH'],
  ]
  for (const sql of ['/* /* nested */ DELETE */ SELECT 1', "SELECT 'it''s; DELETE' AS a FROM [t]]; DELETE]", '-- author\n/* note */\nSELECT 1']) {
    expect(readOnlyIssue(sql)).toBeNull()
  }
  for (const [sql, excerpt] of bad) expect(readOnlyIssue(sql)).toContain(excerpt)
  expect(usedParameters('SELECT @@ROWCOUNT, @a, @b, @a, \'@c\'')).toEqual(['a', 'b'])
  expect(COMPONENTS.sqlserver.validate({connection: 'X', sql: 'SELECT * FROM t WHERE id = @id', parameters: []}))
    .toEqual(['uses @id, which is not in the parameters.'])
})

test('SQL Server Query yields one envelope per row and sends the evaluated parameters', async () => {
  const queries: unknown[] = []
  const querySql = async function* (q: {connection: string; sql: string; parameters: Record<string, unknown>}) {
    queries.push({connection: q.connection, parameters: q.parameters})
    yield {id: 1, name: 'ana'}
    yield {id: 2, name: 'bia'}
  }
  const wfSql: ExecutableWorkflow = {
    project: 'Test', workflow: 'SQL', parameters: [{name: 'since', type: 'number', default: '10'}],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 's', type: 'sqlserver', label: 'Customers', override: true, config: {
        connection: 'MY_DB', sql: 'SELECT id, name FROM Customer WHERE id > @since',
        parameters: [{name: 'since', value: '$PARAMETERS.since', expression: true}],
      }},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 's', targetPort: 'in-0'},
      {source: 's', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  }
  const r = await runWorkflow(wfSql, {mode: 'execution', id: 'sql', evaluate, querySql, secrets: {MY_DB: 'Server=x'}})
  expect(r.status).toBe('completed')
  expect(queries).toEqual([{connection: 'Server=x', parameters: {since: 10}}])
  expect(r.components.find(c => c.nodeId === 's')!.outputSample['out-0']).toEqual([{id: 1, name: 'ana'}, {id: 2, name: 'bia'}])

  // a secret that does not exist: fails the envelope (default policy = stop)
  const noSecret = await runWorkflow(wfSql, {mode: 'execution', id: 'sql2', evaluate, querySql, secrets: {}})
  expect(noSecret.status).toBe('failed')
  expect(noSecret.error).toContain('MY_DB')
})

describe('Workflow Invoker', () => {
  const edge = (source: string, target: string, sourcePort = 'out-0') => ({source, sourcePort, target, targetPort: 'in-0'})
  // B: receives the envelope and multiplies by the parameter
  const multiply: ExecutableWorkflow = {
    id: 'B', project: 'Test', workflow: 'Multiply', parameters: [{name: 'times', type: 'number', default: '1'}],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {acceptsInput: true}},
      {id: 'm', type: 'mapper', label: 'Mapper', config: {fields: [{target: 'total', value: '$n * $PARAMETERS.times', expression: true}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [edge('start', 'm'), edge('m', 'end')],
  }
  // C: always fails
  const breaks: ExecutableWorkflow = {
    id: 'C', project: 'Test', workflow: 'Breaks', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'm', type: 'mapper', label: 'Mapper', config: {fields: [{target: 'x', value: '$doesNotExist.y', expression: true}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [edge('start', 'm'), edge('m', 'end')],
  }
  const parent = (workflowId: string, onError = 'stop'): ExecutableWorkflow => ({
    id: 'A', project: 'Test', workflow: 'Parent', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'g', type: 'datagrid', label: 'Numbers', config: {columns: [{name: 'n', type: 'number'}], rows: [['1'], ['2']]}},
      {id: 'w', type: 'workflow', label: 'Calls', config: {
        workflowId, sendEnvelope: true, onError,
        parameters: [{name: 'times', value: '$n + 1', expression: true}],
      }},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [edge('start', 'g'), edge('g', 'w'), edge('w', 'end'), edge('w', 'end', 'error')],
  })
  const workflows = {B: multiply, C: breaks}

  test('calls the other workflow per envelope, with the parameters and the input, and returns what reaches its End', async () => {
    const r = await runWorkflow(parent('B'), {mode: 'execution', id: 'parent', evaluate, workflows})
    expect(r.status).toBe('completed')
    const w = r.components.find(c => c.nodeId === 'w')!
    // n = 1 → times 2 → total 2; n = 2 → times 3 → total 6
    expect(w.outputSample['out-0']).toEqual([{n: 1, total: 2}, {n: 2, total: 6}])
    expect(w.subRuns?.map(s => [s.workflow, s.status])).toEqual([['Multiply', 'completed'], ['Multiply', 'completed']])
  })

  test('a failing workflow is an error of the envelope (Divert sends it to the error port)', async () => {
    const stopped = await runWorkflow(parent('C'), {mode: 'execution', id: 'p1', evaluate, workflows})
    expect(stopped.status).toBe('failed')
    expect(stopped.error).toContain('The workflow "Breaks" failed')
    const diverted = await runWorkflow(parent('C', 'divert'), {mode: 'execution', id: 'p2', evaluate, workflows})
    expect(diverted.status).toBe('completed')
    expect(diverted.components.find(c => c.nodeId === 'w')!.outputs['error']).toBe(2)
  })

  test('a circular call is blocked', async () => {
    const circular = await runWorkflow(parent('A'), {mode: 'execution', id: 'p3', evaluate, workflows: {...workflows, A: parent('A')}})
    expect(circular.status).toBe('failed')
    expect(circular.error).toContain('Circular workflow call: Parent → Parent')
  })
})
