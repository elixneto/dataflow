import {FileCode2} from 'lucide-react';
import {typescriptConfig, typescript} from '@dataflow/core';
import {CodeEditor} from '#ui/code-editor';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the TypeScript component. The logic is the core's; the runner compiles and runs the code.

/** Return type declared on the process function (e.g. `Promise<Data[]>`), read from the code; without a type, undefined. */
function processReturnType(code: string): string | undefined {
  const start = code.search(/\bfunction\s+process\s*\(/);
  if (start < 0) return undefined;
  let i = code.indexOf('(', start);
  // close the parameters' parentheses (they may have types with parentheses inside)
  for (let depth = 0; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) break;
  }
  const rest = code.slice(i + 1);
  const colon = rest.match(/^\s*:/);
  if (!colon) return undefined;
  // the type goes up to the body's {: the first { outside <>, () and []
  let depth = 0;
  for (let j = colon[0].length; j < rest.length; j++) {
    const c = rest[j];
    if ('<(['.includes(c)) depth++;
    else if ('>)]'.includes(c)) depth--;
    else if (c === '{' && depth === 0) return rest.slice(colon[0].length, j).trim() || undefined;
  }
  return undefined;
}

function TypescriptCard({config}: FieldsProps) {
  const returnType = processReturnType(typescriptConfig(config).code);
  return returnType
    ? <p className="truncate font-mono text-xs text-primary" title={returnType}>{returnType}</p>
    : <p className="text-xs italic text-muted-foreground">No return type</p>;
}

function TypescriptPanel({nodeId, config, setConfig}: FieldsProps) {
  const {code} = typescriptConfig(config);
  return (
    <div className="flex min-h-[420px] flex-1 !shrink flex-col gap-3">
      <div className="relative min-h-[300px] flex-1">
        <CodeEditor value={code} onValue={v => setConfig('code', v)} path={nodeId} label="TypeScript code"/>
      </div>
    </div>
  );
}

function TypescriptDocs() {
  return (
    <>
      <p>Your code processes each envelope: <code>async function process($input)</code>, with the envelope&apos;s <code>DATA</code> as <code>$input</code>.</p>
      <ul>
        <li>The return goes to <code>$result</code> (the name can be changed). Override: it becomes the <code>DATA</code> (an object = 1 envelope, a list = 1 per item, <code>null</code> = none).</li>
        <li>Many at once: an Aggregate before it gives <code>$input.items</code>.</li>
        <li>Globals: <code>$PARAMETERS</code>, <code>$SECRETS</code>, <code>$WORKFLOW_CURRENT_RUN</code>, <code>log()</code>, <code>fetch</code>. No <code>require</code>, disk or environment.</li>
        <li>Up to 30 s per call; an exception is an error of the envelope.</li>
      </ul>
    </>
  );
}

export const TYPESCRIPT: ComponentDef = {
  type: typescript.type,
  label: 'TypeScript',
  description: 'Processes the envelopes with code',
  category: 'code',
  icon: FileCode2,
  inputs: typescript.inputs,
  outputs: typescript.outputs,
  usesOverride: true,
  defaultOutputKey: typescript.defaultOutputKey,
  defaultConfig: {code: typescriptConfig({}).code},
  windowSize: {w: 760, h: 620},
  Card: TypescriptCard,
  Panel: TypescriptPanel,
  Docs: TypescriptDocs,
  validate: config => typescript.validate(config),
};
