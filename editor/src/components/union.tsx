import {Merge} from 'lucide-react';
import {union} from '@dataflow/core';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the Union. The logic (execute) is the core's.

function UnionDocs() {
  return (
    <>
      <p>Joins several paths (2 to 100) into one output, as the envelopes arrive. Does not touch <code>DATA</code>.</p>
      <ul>
        <li>Every input must be connected.</li>
        <li>Not needed just to end: the End takes many edges.</li>
      </ul>
    </>
  );
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
};
