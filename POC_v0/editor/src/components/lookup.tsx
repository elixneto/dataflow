import {Equal, Plus, SearchCheck, X} from 'lucide-react';
import {lookupConfig, lookup, type LookupKey, type IfNotFound} from '@dataflow/core';
import {ExpressionBox} from '#ui/expression-field';
import {cn} from '#lib/utils';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the Lookup. The logic (validate and execute) is the core's.


function LookupCard({config}: FieldsProps) {
  const {keys, ifNotFound} = lookupConfig(config);
  if (keys.length === 0) return <p className="text-xs italic text-muted-foreground">No comparison</p>;
  return (
    <div className="flex flex-col gap-1 font-mono text-xs">
      {keys.map((k, i) => (
        <p key={i} className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate text-primary" title={k.main}>{k.main || '?'}</span>
          <Equal className="size-3 shrink-0 text-muted-foreground" aria-label="equals"/>
          <span className="min-w-0 truncate text-primary" title={k.lookup}>{k.lookup || '?'}</span>
        </p>
      ))}
      <p className="text-muted-foreground">if not found: {ifNotFound === 'error' ? 'error' : 'null'}</p>
    </div>
  );
}

function RemoveButton({label, onClick}: {label: string; onClick: () => void}) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
      <X className="size-4" aria-hidden="true"/>
    </button>
  );
}

function AddButton({children, onClick}: {children: string; onClick: () => void}) {
  return (
    <button type="button" onClick={onClick}
            className="flex h-8 items-center justify-center gap-1 rounded-md border border-dashed border-input text-xs text-muted-foreground hover:border-ring hover:text-foreground">
      <Plus className="size-3.5" aria-hidden="true"/> {children}
    </button>
  );
}

const IF_NOT_FOUND: {value: IfNotFound; label: string}[] = [
  {value: 'null', label: 'Write null'},
  {value: 'error', label: 'Error'},
];

function LookupPanel({id, nodeId, config, setConfig}: FieldsProps) {
  const {keys, ifNotFound} = lookupConfig(config);
  const changeKey = (i: number, m: Partial<LookupKey>) => setConfig('keys', keys.map((k, j) => (j === i ? {...k, ...m} : k)));
  const keyColumns = 'grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)_32px]';

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Comparison</h3>
        <div className="flex flex-col overflow-hidden rounded-md border border-border">
          <div className={cn('grid items-center gap-x-1.5 border-b border-border bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground', keyColumns)}>
            <span>input</span><span/><span>lookup</span><span/>
          </div>
          {keys.map((k, i) => (
            <div key={i} className={cn('grid items-center gap-x-1.5 border-b border-border px-2 py-1.5 last:border-b-0', keyColumns)}>
              <ExpressionBox nodeId={nodeId} port="in-0" value={k.main} onValue={main => changeKey(i, {main})} placeholder="$companyCode"
                             label={`Comparison ${i + 1} on the input`}/>
              <Equal className="size-4 text-muted-foreground" aria-hidden="true"/>
              <ExpressionBox nodeId={nodeId} port="in-1" value={k.lookup} onValue={lookup => changeKey(i, {lookup})} placeholder="$code"
                             label={`Comparison ${i + 1} on the lookup`}/>
              <RemoveButton label={`Remove comparison ${i + 1}`} onClick={() => setConfig('keys', keys.filter((_, j) => j !== i))}/>
            </div>
          ))}
          {keys.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">No comparison</p>}
        </div>
        <AddButton onClick={() => setConfig('keys', [...keys, {main: '', lookup: ''}])}>Add comparison</AddButton>
      </section>

      <section className="flex flex-col gap-2">
        <h3 id={`${id}-not-found`} className="text-xs font-medium text-muted-foreground">If not found</h3>
        <div role="radiogroup" aria-labelledby={`${id}-not-found`} className="grid grid-cols-2 gap-0.5 rounded-md border border-input bg-background p-0.5">
          {IF_NOT_FOUND.map(o => (
            <button key={o.value} type="button" role="radio" aria-checked={o.value === ifNotFound} onClick={() => setConfig('ifNotFound', o.value)}
                    className={cn('h-7 rounded px-2 text-xs font-medium transition-colors',
                      o.value === ifNotFound ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {o.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function LookupDocs() {
  return (
    <>
      <p>For each envelope of <code>input</code>, finds the one in <code>lookup</code> with the same key and writes it into <code>$lookup</code> (the name can be changed).</p>
      <ul>
        <li>Key: an expression per side, e.g. <code>$companyCode</code> = <code>$code</code>; compared as text (<code>1</code> matches <code>{'"1"'}</code>).</li>
        <li><code>lookup</code> is read whole and held in memory: for support tables, not millions of rows.</li>
        <li>Not found: <b>Write null</b> or <b>Error</b>. A repeated key: the first wins.</li>
        <li>Pick fields with a Mapper after it: <code>{'$company?.name ?? "(none)"'}</code>.</li>
      </ul>
    </>
  );
}

export const LOOKUP: ComponentDef = {
  type: lookup.type,
  label: 'Lookup',
  description: 'Finds the envelope of another input by key',
  category: 'transformation',
  icon: SearchCheck,
  inputs: lookup.inputs,
  inputLabels: ['input', 'lookup'],
  outputs: lookup.outputs,
  usesOverride: true,
  defaultOutputKey: lookup.defaultOutputKey,
  defaultConfig: {keys: [{main: '', lookup: ''}], ifNotFound: 'null'},
  Card: LookupCard,
  Panel: LookupPanel,
  Docs: LookupDocs,
  validate: config => lookup.validate(config),
};
