import {ListEnd} from 'lucide-react';
import {limit, limitConfig, MAX_LIMIT, type LimitMode} from '@dataflow/core';
import {fieldInput} from '#ui/expression-field';
import {cn} from '#lib/utils';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the Limit. The logic is the core's.

const MODES: {value: LimitMode; label: string}[] = [
  {value: 'top', label: 'Top'},
  {value: 'bottom', label: 'Bottom'},
];

function LimitCard({config}: FieldsProps) {
  const {mode, count} = limitConfig(config);
  return <p className="font-mono text-xs"><span className="font-semibold">{mode}</span> {count}</p>;
}

function LimitPanel({id, config, setConfig}: FieldsProps) {
  const {mode, count} = limitConfig(config);
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
      <span id={`${id}-mode`} className="text-xs font-medium text-muted-foreground">Mode</span>
      <div role="radiogroup" aria-labelledby={`${id}-mode`} className="grid w-44 grid-cols-2 gap-0.5 rounded-md border border-input bg-background p-0.5">
        {MODES.map(o => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === mode} onClick={() => setConfig('mode', o.value)}
                  className={cn('h-7 rounded px-2 text-xs font-medium transition-colors',
                    o.value === mode ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {o.label}
          </button>
        ))}
      </div>
      <label htmlFor={`${id}-count`} className="text-xs font-medium text-muted-foreground">Envelopes</label>
      <input id={`${id}-count`} type="number" min={1} max={MAX_LIMIT} value={count}
             onChange={e => setConfig('count', Math.min(MAX_LIMIT, Math.max(1, Math.round(Number(e.target.value) || 1))))}
             className={cn(fieldInput, 'w-28 font-mono')}/>
    </div>
  );
}

function LimitDocs() {
  return (
    <>
      <p>Lets only N envelopes through. Does not touch <code>DATA</code>.</p>
      <ul>
        <li><b>Top</b>: the first N, as they arrive (the rest is read and dropped).</li>
        <li><b>Bottom</b>: the last N, when the input ends.</li>
        <li>Handy to test a flow on a sample.</li>
      </ul>
    </>
  );
}

export const LIMIT: ComponentDef = {
  type: limit.type,
  label: 'Limit',
  description: 'Lets only the first or last N envelopes through',
  category: 'transformation',
  icon: ListEnd,
  inputs: limit.inputs,
  outputs: limit.outputs,
  noError: true,
  defaultConfig: {mode: 'top', count: 10},
  Card: LimitCard,
  Panel: LimitPanel,
  Docs: LimitDocs,
};
