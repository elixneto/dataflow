import {Equal, Plus, SearchCheck, X} from 'lucide-react'
import {lookupConfig, lookup, type LookupKey, type IfNotFound} from '@dataflow/core'
import {fieldInput} from '@/ui/expression-field'
import {cn} from '@/lib/utils'
import type {FieldsProps, ComponentDef} from './types'

// Visual part of the Lookup. The logic (validate and execute) is the core's.

const expressionInput = cn(fieldInput, 'border-primary/50 bg-primary/5 font-mono')

function LookupCard({config}: FieldsProps) {
  const {keys, ifNotFound} = lookupConfig(config)
  if (keys.length === 0) return <p className="text-xs italic text-muted-foreground">No comparison</p>
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
  )
}

function RemoveButton({label, onClick}: {label: string; onClick: () => void}) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
      <X className="size-4" aria-hidden="true"/>
    </button>
  )
}

function AddButton({children, onClick}: {children: string; onClick: () => void}) {
  return (
    <button type="button" onClick={onClick}
            className="flex h-8 items-center justify-center gap-1 rounded-md border border-dashed border-input text-xs text-muted-foreground hover:border-ring hover:text-foreground">
      <Plus className="size-3.5" aria-hidden="true"/> {children}
    </button>
  )
}

const IF_NOT_FOUND: {value: IfNotFound; label: string}[] = [
  {value: 'null', label: 'Write null'},
  {value: 'error', label: 'Error'},
]

function LookupPanel({id, config, setConfig}: FieldsProps) {
  const {keys, ifNotFound} = lookupConfig(config)
  const changeKey = (i: number, m: Partial<LookupKey>) => setConfig('keys', keys.map((k, j) => (j === i ? {...k, ...m} : k)))
  const keyColumns = 'grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)_32px]'

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
              <input value={k.main} onChange={e => changeKey(i, {main: e.target.value})} placeholder="$companyCode" spellCheck={false}
                     aria-label={`Comparison ${i + 1} on the input`} className={expressionInput}/>
              <Equal className="size-4 text-muted-foreground" aria-hidden="true"/>
              <input value={k.lookup} onChange={e => changeKey(i, {lookup: e.target.value})} placeholder="$code" spellCheck={false}
                     aria-label={`Comparison ${i + 1} on the lookup`} className={expressionInput}/>
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
  )
}

function LookupDocs() {
  return (
    <>
      <p>For each envelope of the <code>input</code> input, looks in the <code>lookup</code> input for the envelope with the same key and writes its whole <code>DATA</code> into this node's output key (default <code>$lookup</code>). E.g.: the company code in the source system → the company in the target.</p>
      <h4>Inputs</h4>
      <p><code>input</code> (top): the envelopes that will get the found envelope. <code>lookup</code> (bottom): the table to search in.</p>
      <p>The <code>lookup</code> is read entirely before the first envelope goes out and stays in memory; it is meant for support tables (companies, departments, mappings), not for millions of rows.</p>
      <h4>Output</h4>
      <p>The <code>input</code> envelopes, with the found envelope in the output key. To pick fields or give a default value, put a Mapper after it: <code>{'$company?.id'}</code> → <code>companyId</code>, <code>{'$company?.name ?? "(no company)"'}</code> → <code>companyName</code>.</p>
      <h4>Comparison</h4>
      <p>An expression on each side: the left one is evaluated on the <code>input</code> envelope, the right one on the <code>lookup</code> one. E.g.: <code>$companyCode</code> = <code>$code</code>. With more than one line, all of them must match. Values are compared as text: <code>1</code> matches <code>"1"</code>.</p>
      <p>If the <code>lookup</code> has the same key more than once, the first envelope wins (and a warning shows up in the log).</p>
      <h4>If not found</h4>
      <p><b>Write null</b>: the output key becomes <code>null</code> and the envelope moves on. <b>Error</b>: it is an error of the envelope and follows the card's "On error" policy (with Divert, it goes out through the error port).</p>
      <h4>Override</h4>
      <p>On, the output <code>DATA</code> becomes only the found envelope (empty if not found).</p>
    </>
  )
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
}
