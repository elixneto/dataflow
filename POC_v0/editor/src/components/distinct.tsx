import {Fingerprint, Plus, X} from 'lucide-react';
import {distinct, distinctKeys} from '@dataflow/core';
import {ExpressionBox} from '#ui/expression-field';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the Distinct. The logic (validate and execute) is the core's.

function DistinctCard({config}: FieldsProps) {
  const keys = distinctKeys(config);
  if (keys.length === 0) return <p className="text-xs italic text-muted-foreground">Whole DATA</p>;
  return (
    <ul className="flex flex-col gap-1">
      {keys.slice(0, 4).map((k, i) => (
        <li key={i} className="truncate font-mono text-xs text-primary" title={k}>{k || '?'}</li>
      ))}
      {keys.length > 4 && <li className="text-xs text-muted-foreground">+{keys.length - 4} keys</li>}
    </ul>
  );
}

function DistinctPanel({nodeId, config, setConfig}: FieldsProps) {
  const keys = distinctKeys(config);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col overflow-hidden rounded-md border border-border">
        <div className="border-b border-border bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground">Key</div>
        {keys.map((k, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_32px] items-center gap-x-1.5 border-b border-border px-2 py-1.5 last:border-b-0">
            <ExpressionBox nodeId={nodeId} value={k} onValue={v => setConfig('keys', keys.map((x, j) => (j === i ? v : x)))}
                           placeholder="$email" label={`Key ${i + 1}`}/>
            <button type="button" onClick={() => setConfig('keys', keys.filter((_, j) => j !== i))} aria-label={`Remove key ${i + 1}`}
                    className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="size-4" aria-hidden="true"/>
            </button>
          </div>
        ))}
        {keys.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">Whole DATA</p>}
      </div>
      <button type="button" onClick={() => setConfig('keys', [...keys, ''])}
              className="flex h-8 items-center justify-center gap-1 rounded-md border border-dashed border-input text-xs text-muted-foreground hover:border-ring hover:text-foreground">
        <Plus className="size-3.5" aria-hidden="true"/> Add key
      </button>
    </div>
  );
}

function DistinctDocs() {
  return (
    <>
      <p>Lets through the first envelope of each key; the repeated ones go to <code>duplicates</code>.</p>
      <ul>
        <li>Key: one or more expressions (<code>$email</code>, <code>$customer.id</code>); none = the whole <code>DATA</code>.</li>
        <li>Compared as JSON: <code>1</code> does not match <code>{'"1"'}</code>.</li>
        <li>Streams and keeps only the keys in memory. <code>duplicates</code> may stay unconnected.</li>
      </ul>
    </>
  );
}

export const DISTINCT: ComponentDef = {
  type: distinct.type,
  label: 'Distinct',
  description: 'Lets through only the first envelope of each key',
  category: 'transformation',
  icon: Fingerprint,
  inputs: distinct.inputs,
  outputs: distinct.outputs,
  outputLabels: ['unique', 'duplicates'],
  optionalOutputs: distinct.optionalOutputs,
  defaultConfig: {keys: ['']},
  Card: DistinctCard,
  Panel: DistinctPanel,
  Docs: DistinctDocs,
  validate: config => distinct.validate(config),
};
