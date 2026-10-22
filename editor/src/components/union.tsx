import {Merge} from 'lucide-react'
import {union} from '@dataflow/core'
import type {ComponentDef} from './types'

// Visual part of the Union. The logic (execute) is the core's.

function UnionDocs() {
  return (
    <>
      <p>Brings together paths that split (e.g. the normal output and the error handling) into a single output, so they continue together through the rest of the flow. Does not touch <code>DATA</code>. To simply end, it is not needed: the End accepts several edges.</p>
      <h4>Inputs</h4>
      <p>From 2 to 100 envelope ports (−/+ on the card). Every input must be connected; decreasing removes the bottom ports.</p>
      <h4>Output</h4>
      <p>1 envelope port: everything that comes in through any port goes out through it, as it came in.</p>
      <p>Each envelope goes out as soon as it arrives, from any input.</p>
      <p>Unlike a Join, which combines two envelopes into one by a key: the Union only stacks.</p>
    </>
  )
}

export const UNION: ComponentDef = {
  type: union.type,
  label: 'Union',
  description: 'Joins several inputs into a single output',
  category: 'transformation',
  icon: Merge,
  inputs: union.inputs,
  outputs: union.outputs,
  variableInputs: union.variableInputs,
  noError: true,
  defaultConfig: {inputCount: 2},
  Docs: UnionDocs,
}
