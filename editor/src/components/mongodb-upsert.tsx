import {Leaf, Plus, X} from 'lucide-react';
import {mongoUpsertConfig, mongodbUpsert, DEFAULT_MONGODB_BATCH_SIZE, MAX_MONGODB_BATCH_SIZE, type MongoFilterKey} from '@dataflow/core';
import {ExpressionBox, ExpressionInput, fieldInput} from '#ui/expression-field';
import {cn} from '#lib/utils';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the MongoDB Upsert. The logic is the core's; the runner talks to the database.

function MongoUpsertCard({config}: FieldsProps) {
  const {connection, database, collection, filter} = mongoUpsertConfig(config);
  const fields = filter.map(f => f.field).filter(Boolean);
  return (
    <div className="flex flex-col gap-1 font-mono text-xs">
      <p className="truncate"><span className="text-muted-foreground">$SECRETS.</span><span className="font-semibold">{connection || '?'}</span></p>
      <p className="truncate text-primary">{database || '?'}.{collection || '?'}</p>
      <p className="truncate"><span className="text-muted-foreground">by </span>{fields.length ? fields.join(', ') : '?'}</p>
    </div>
  );
}

function MongoUpsertPanel({id, nodeId, config, setConfig}: FieldsProps) {
  const {connection, database, collection, filter, source, document, batchSize} = mongoUpsertConfig(config);
  const change = (i: number, update: Partial<MongoFilterKey>) => setConfig('filter', filter.map((f, j) => (j === i ? {...f, ...update} : f)));
  const text = (key: string, label: string, value: string, placeholder: string) => (
    <>
      <label htmlFor={`${id}-${key}`} className="text-xs font-medium text-muted-foreground">{label}</label>
      <input id={`${id}-${key}`} value={value} onChange={e => setConfig(key, e.target.value)} placeholder={placeholder} spellCheck={false}
             className={cn(fieldInput, 'font-mono')}/>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
        <label htmlFor={`${id}-connection`} className="text-xs font-medium text-muted-foreground">Connection</label>
        <div className="flex min-w-0 items-center gap-1">
          <span className="font-mono text-sm text-muted-foreground" aria-hidden="true">$SECRETS.</span>
          <input id={`${id}-connection`} value={connection} onChange={e => setConfig('connection', e.target.value)} placeholder="MY_MONGODB" spellCheck={false}
                 className={cn(fieldInput, 'font-mono')}/>
        </div>
        {text('database', 'Database', database, 'crm')}
        {text('collection', 'Collection', collection, 'customers')}
        <label htmlFor={`${id}-batch`} className="text-xs font-medium text-muted-foreground">Batch size</label>
        <input id={`${id}-batch`} type="number" min={1} max={MAX_MONGODB_BATCH_SIZE} value={batchSize}
               onChange={e => setConfig('batchSize', Math.min(MAX_MONGODB_BATCH_SIZE, Math.max(1, Math.round(Number(e.target.value) || DEFAULT_MONGODB_BATCH_SIZE))))}
               className={cn(fieldInput, 'w-28 font-mono')}/>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Filter</h3>
        <div className="flex flex-col overflow-hidden rounded-md border border-border">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_32px] items-center gap-x-1.5 border-b border-border bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground">
            <span>Field</span><span>Value</span><span/>
          </div>
          {filter.map((f, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_32px] items-center gap-x-1.5 border-b border-border px-2 py-1.5 last:border-b-0">
              <input value={f.field} onChange={e => change(i, {field: e.target.value})} placeholder="email" spellCheck={false}
                     aria-label={`Field of filter ${i + 1}`} className={cn(fieldInput, 'font-mono')}/>
              <ExpressionInput nodeId={nodeId} label={`Value of filter ${i + 1}`} value={f.value} expression={f.expression}
                               onValue={value => change(i, {value})} onExpression={expression => change(i, {expression})}/>
              <button type="button" onClick={() => setConfig('filter', filter.filter((_, j) => j !== i))} aria-label={`Remove filter ${i + 1}`}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="size-4" aria-hidden="true"/>
              </button>
            </div>
          ))}
          {filter.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">No filter</p>}
        </div>
        <button type="button" onClick={() => setConfig('filter', [...filter, {field: '', value: '', expression: true}])}
                className="flex h-8 items-center justify-center gap-1 rounded-md border border-dashed border-input text-sm text-muted-foreground hover:border-ring hover:text-foreground">
          <Plus className="size-3.5" aria-hidden="true"/> Add filter field
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Document ($set)</h3>
        <div role="radiogroup" aria-label="Document" className="flex gap-1">
          {([['data', 'Whole DATA'], ['expression', 'Expression']] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={source === value} onClick={() => setConfig('source', value)}
                    className={cn('h-8 rounded-md border px-3 text-sm transition-colors',
                      source === value ? 'border-ring bg-accent font-medium text-foreground' : 'border-input text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>
        {source === 'expression' && (
          <ExpressionBox nodeId={nodeId} label="Document expression" value={document.value} multiline rows={4}
                         placeholder="({name: $name, email: $email, updatedAt: $WORKFLOW_CURRENT_RUN.startedAt})"
                         onValue={value => setConfig('document', {value, expression: true})}/>
        )}
      </section>
    </div>
  );
}

function MongoUpsertDocs() {
  return (
    <>
      <p>Writes each envelope into a MongoDB collection: updates the document that matches the filter or, when none matches, inserts it (an upsert). E.g.: keeping a customers collection in sync with an ERP.</p>
      <h4>Input</h4>
      <p>1 envelope port. Each envelope becomes one <code>updateOne(filter, {'{$set: document}'}, {'{upsert: true}'})</code>.</p>
      <h4>Filter</h4>
      <p>The fields that find the document, each with a value (text or an expression on the envelope), e.g. <code>email</code> = <code>$email</code>, or <code>_id</code> = <code>$id</code>. When nothing matches, the inserted document gets these fields too. A value that comes out <code>undefined</code> is an error of that envelope (it would match the wrong document).</p>
      <h4>Document</h4>
      <p><b>Whole DATA</b> (default): every field of the envelope goes in the <code>$set</code>. <b>Expression</b>: an object built from the envelope, e.g. <code>{'({name: $name, email: $email})'}</code>. <code>_id</code> never goes in the <code>$set</code>: MongoDB does not change it, and an insert takes it from the filter (or generates one).</p>
      <h4>Output</h4>
      <p>The incoming envelope plus <code>$mongodb</code> (the name can be changed): <code>{'{matched, modified, upsertedId}'}</code>. <code>upsertedId</code> is the id of an inserted document, as text, or <code>null</code> when it updated one. Override on: only <code>$mongodb</code>.</p>
      <h4>Test run and Run for real</h4>
      <p>This component writes outside the flow, so the editor&apos;s <b>Run</b> (a test run) does not write: it logs the first upserts it would send, and nothing goes on from it, so the components after it get nothing. <b>Run for real</b> (next to Run, with a confirmation listing what will write) writes. A pinned output is replayed in test runs as usual, so what comes after it can be tested with a real answer.</p>
      <h4>Connection</h4>
      <p>The name of a secret (<code>$SECRETS</code>) holding the connection string, e.g. <code>mongodb+srv://user:password@cluster.example.net</code>. It is never stored in the flow or in the logs. Ideally the user can only write to this collection.</p>
      <h4>Batch size</h4>
      <p>How many envelopes are sent together (default {DEFAULT_MONGODB_BATCH_SIZE}). Each envelope still gets its own answer. Envelopes with the same filter (e.g. the same <code>_id</code> twice) are written one after the other, in the order they arrived, so the last one wins. The log counts, per batch and in all, the documents <b>inserted</b>, <b>modified</b> and <b>unchanged</b> (it found the document and it already had those values).</p>
      <h4>Errors</h4>
      <p>A document that fails (e.g. a duplicate key in a unique index) is an error of its envelope and follows the card&apos;s &quot;On error&quot; policy; the others of the batch are written. A connection or login failure fails every envelope of the batch.</p>
    </>
  );
}

export const MONGODB_UPSERT: ComponentDef = {
  type: mongodbUpsert.type,
  label: 'MongoDB Upsert',
  description: 'Writes each envelope into a collection',
  category: 'entity',
  icon: Leaf,
  inputs: mongodbUpsert.inputs,
  outputs: mongodbUpsert.outputs,
  usesOverride: true,
  defaultOutputKey: mongodbUpsert.defaultOutputKey,
  windowSize: {w: 680, h: 640},
  defaultConfig: {connection: '', database: '', collection: '', filter: [{field: '_id', value: '$_id', expression: true}], source: 'data', batchSize: DEFAULT_MONGODB_BATCH_SIZE},
  Card: MongoUpsertCard,
  Panel: MongoUpsertPanel,
  Docs: MongoUpsertDocs,
  validate: config => mongodbUpsert.validate(config),
};
