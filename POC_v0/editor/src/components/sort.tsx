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
      <p>Reads every envelope, then sends them on in the order of the keys.</p>
      <ul>
        <li>Keys: expressions, each ascending or descending; the next ones break ties (stable).</li>
        <li>Numbers, dates and booleans by value, the rest as text; <code>null</code> last.</li>
        <li>Holds the whole input: for a big query, prefer its <code>ORDER BY</code>.</li>
      </ul>
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
