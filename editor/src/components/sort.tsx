import {ArrowDownUp, ArrowDownWideNarrow, ArrowUpNarrowWide, Plus, X} from 'lucide-react';
import {sort, sortKeys, type SortKey} from '@dataflow/core';
import {ExpressionBox} from '#ui/expression-field';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the Sort. The logic (validate and execute) is the core's.

function SortCard({config}: FieldsProps) {
  const keys = sortKeys(config);
  if (keys.length === 0) return <p className="text-xs italic text-muted-foreground">No keys</p>;
  return (
    <ul className="flex flex-col gap-1">
      {keys.slice(0, 4).map((k, i) => (
        <li key={i} className="flex min-w-0 items-baseline gap-1.5 font-mono text-xs">
          <span className="min-w-0 truncate text-primary" title={k.value}>{k.value || '?'}</span>
          <span className="shrink-0 text-muted-foreground">{k.direction}</span>
        </li>
      ))}
      {keys.length > 4 && <li className="text-xs text-muted-foreground">+{keys.length - 4} keys</li>}
    </ul>
  );
}

function SortPanel({nodeId, config, setConfig}: FieldsProps) {
  const keys = sortKeys(config);
  const change = (i: number, update: Partial<SortKey>) => setConfig('keys', keys.map((k, j) => (j === i ? {...k, ...update} : k)));
  const columns = 'grid grid-cols-[minmax(0,1fr)_32px_32px] items-center gap-x-1.5';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col overflow-hidden rounded-md border border-border">
        <div className={`${columns} border-b border-border bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground`}>
          <span>Key</span><span/><span/>
        </div>
        {keys.map((k, i) => {
          const Direction = k.direction === 'desc' ? ArrowDownWideNarrow : ArrowUpNarrowWide;
          const label = k.direction === 'desc' ? 'Descending' : 'Ascending';
          return (
            <div key={i} className={`${columns} border-b border-border px-2 py-1.5 last:border-b-0`}>
              <ExpressionBox nodeId={nodeId} value={k.value} onValue={value => change(i, {value})} placeholder="$createdAt" label={`Key ${i + 1}`}/>
              <button type="button" onClick={() => change(i, {direction: k.direction === 'desc' ? 'asc' : 'desc'})}
                      aria-label={`Key ${i + 1}: ${label}`} title={label}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                <Direction className="size-4" aria-hidden="true"/>
              </button>
              <button type="button" onClick={() => setConfig('keys', keys.filter((_, j) => j !== i))} aria-label={`Remove key ${i + 1}`}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="size-4" aria-hidden="true"/>
              </button>
            </div>
          );
        })}
        {keys.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">No keys</p>}
      </div>
      <button type="button" onClick={() => setConfig('keys', [...keys, {value: '', direction: 'asc'}])}
              className="flex h-8 items-center justify-center gap-1 rounded-md border border-dashed border-input text-xs text-muted-foreground hover:border-ring hover:text-foreground">
        <Plus className="size-3.5" aria-hidden="true"/> Add key
      </button>
    </div>
  );
}

function SortDocs() {
  return (
    <>
      <p>Reads every envelope, sorts them by the keys and only then sends them on, in order. Does not touch <code>DATA</code>.</p>
      <h4>Input</h4>
      <p>1 envelope port.</p>
      <h4>Output</h4>
      <p>The same envelopes, in order. Nothing goes out before the input ends.</p>
      <h4>Keys</h4>
      <p>A JS expression each, ascending or descending (the arrow next to it). The first key decides; the next ones break ties, and envelopes still tied keep their arrival order. E.g.: <code>$city</code> ascending, then <code>$total</code> descending.</p>
      <p>Numbers compare as numbers, booleans <code>false</code> before <code>true</code>, dates (a SQL Server or MongoDB date column) by time, everything else as text (dates kept as ISO text also sort correctly). <code>null</code> and <code>undefined</code> always go last.</p>
      <h4>Memory</h4>
      <p>Holds the whole input until it ends: meant for thousands of envelopes, not millions. To sort a database query, prefer its <code>ORDER BY</code>.</p>
      <h4>Disabled</h4>
      <p>The envelopes pass through in arrival order.</p>
      <h4>Errors</h4>
      <p>A key that fails is an error of the envelope and follows the card's "On error" policy.</p>
    </>
  );
}

export const SORT: ComponentDef = {
  type: sort.type,
  label: 'Sort',
  description: 'Sorts the envelopes by keys',
  category: 'transformation',
  icon: ArrowDownUp,
  inputs: sort.inputs,
  outputs: sort.outputs,
  defaultConfig: {keys: [{value: '', direction: 'asc'}]},
  Card: SortCard,
  Panel: SortPanel,
  Docs: SortDocs,
  validate: config => sort.validate(config),
};
