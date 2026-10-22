import {Copy} from 'lucide-react';
import {copy} from '@dataflow/core';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the Copy. The logic (execute) is the core's.

function CopyDocs() {
  return (
    <>
      <p>The opposite of Union: sends each incoming envelope to every output, so the same data follows different paths (e.g. writing the company to the target and, at the same time, building a report). Does not touch <code>DATA</code>.</p>
      <h4>Input</h4>
      <p>1 envelope port.</p>
      <h4>Outputs</h4>
      <p>From 2 to 10 envelope ports (−/+ on the card). Every output must be connected; decreasing removes the bottom ports.</p>
      <p>Each output gets its own copy of the envelope: what one path changes does not show up in the other.</p>
      <p>The pace is that of the slowest path: the envelope only moves on when every output has accepted it.</p>
      <p>Unlike the Router, which sends each envelope to a single output.</p>
      <h4>Disabled</h4>
      <p>The envelopes go out only through the first output.</p>
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
