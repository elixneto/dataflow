import {Copy} from 'lucide-react';
import {copy} from '@dataflow/core';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the Copy. The logic (execute) is the core's.

function CopyDocs() {
  return (
    <>
      <p>Sends each envelope to every output (2 to 10), so the same data follows several paths.</p>
      <ul>
        <li>Each output gets its own copy: what one path changes does not reach the others.</li>
        <li>Every output must be connected; it moves at the pace of the slowest path.</li>
        <li>The Router sends an envelope to one output; the Union joins paths back.</li>
      </ul>
    </>
  );
}

export const COPY: ComponentDef = {
  type: copy.type,
  label: 'Copy',
  description: 'Sends each envelope to every output',
  category: 'transformation',
  icon: Copy,
  inputs: copy.inputs,
  outputs: copy.outputs,
  variableOutputs: copy.variableOutputs,
  noError: true,
  defaultConfig: {outputCount: 2},
  Docs: CopyDocs,
};
