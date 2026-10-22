import {Layers} from 'lucide-react'
import {aggregate, aggregateConfig, MAX_BATCH_SIZE} from '@dataflow/core'
import {KeyInput, fieldInput} from '@/ui/expression-field'
import {cn} from '@/lib/utils'
import type {FieldsProps, ComponentDef} from './types'

// Visual part of the Aggregate. The logic is the core's.

function AggregateCard({config}: FieldsProps) {
  const {size, field} = aggregateConfig(config)
  return <p className="font-mono text-xs"><span className="font-semibold">{field}</span>: <span className="text-muted-foreground">batches of</span> {size}</p>
}

function AggregatePanel({id, config, setConfig}: FieldsProps) {
  const {size, field} = aggregateConfig(config)
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
      <label htmlFor={`${id}-size`} className="text-xs font-medium text-muted-foreground">Batch size</label>
      <input id={`${id}-size`} type="number" min={1} max={MAX_BATCH_SIZE} value={size}
             onChange={e => setConfig('size', Math.min(MAX_BATCH_SIZE, Math.max(1, Math.round(Number(e.target.value) || 1))))}
             className={cn(fieldInput, 'w-28 font-mono')}/>
      <label htmlFor={`${id}-field`} className="text-xs font-medium text-muted-foreground">Key in the envelope</label>
      <KeyInput id={`${id}-field`} value={field} onValue={v => setConfig('field', v)} placeholder="items" className="w-44"/>
    </div>
  )
}

function AggregateDocs() {
  return (
    <>
      <p>Groups the envelopes into batches and yields one envelope per batch, with the list of <code>DATA</code> in a field.</p>
      <pre>{`{items: [{id: 1, ...}, {id: 2, ...}, ...]}`}</pre>
      <p>Useful to send many records at once to an API or a database: Aggregate of 500 → TypeScript that makes one call per batch with <code>$input.items</code>.</p>
      <h4>Input</h4>
      <p>1 envelope port.</p>
      <h4>Output</h4>
      <p>1 envelope for every N that come in; the last batch may be smaller. To go back to one envelope per record, the TypeScript can return a list.</p>
      <h4>Disabled</h4>
      <p>The envelopes pass through without being grouped.</p>
    </>
  )
}

export const AGGREGATE: ComponentDef = {
  type: aggregate.type,
  label: 'Aggregate',
  description: 'Groups the envelopes into batches',
  category: 'transformation',
  icon: Layers,
  inputs: aggregate.inputs,
  outputs: aggregate.outputs,
  noError: true,
  defaultConfig: {size: 500, field: 'items'},
  Card: AggregateCard,
  Panel: AggregatePanel,
  Docs: AggregateDocs,
  validate: config => aggregate.validate(config),
}
