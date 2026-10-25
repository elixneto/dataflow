import {Trash2} from 'lucide-react';
import {mongoDeleteConfig, mongodbDelete, DEFAULT_DELETE_FILTER} from '@dataflow/core';
import {fieldInput} from '#ui/expression-field';
import {CodeEditor} from '#ui/code-editor';
import {cn} from '#lib/utils';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the MongoDB Delete. The logic is the core's; the runner talks to the database.

function MongoDeleteCard({config}: FieldsProps) {
  const {connection, database, collection, filter, allowAll} = mongoDeleteConfig(config);
  const firstLine = filter.replace(/\s+/g, ' ').trim();
  return (
    <div className="flex flex-col gap-1 font-mono text-xs">
      <p className="truncate"><span className="text-muted-foreground">$SECRETS.</span><span className="font-semibold">{connection || '?'}</span></p>
      <p className="truncate"><span className="text-muted-foreground">{database || '?'}.</span>{collection || '?'}</p>
      <p className="truncate text-primary" title={filter}>{firstLine || '?'}</p>
      {allowAll && <p className="font-semibold text-destructive">Delete all</p>}
    </div>
  );
}

function MongoDeletePanel({id, nodeId, config, setConfig}: FieldsProps) {
  const {connection, database, collection, filter, allowAll} = mongoDeleteConfig(config);
  const text = (key: string, label: string, value: string, placeholder: string) => (
    <>
      <label htmlFor={`${id}-${key}`} className="text-xs font-medium text-muted-foreground">{label}</label>
      <input id={`${id}-${key}`} value={value} onChange={e => setConfig(key, e.target.value)} placeholder={placeholder} spellCheck={false}
             className={cn(fieldInput, 'font-mono')}/>
    </>
  );
  return (
    <div className="flex min-h-[420px] flex-1 !shrink flex-col gap-4">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
        <label htmlFor={`${id}-connection`} className="text-xs font-medium text-muted-foreground">Connection</label>
        <div className="flex min-w-0 items-center gap-1">
          <span className="font-mono text-sm text-muted-foreground" aria-hidden="true">$SECRETS.</span>
          <input id={`${id}-connection`} value={connection} onChange={e => setConfig('connection', e.target.value)} placeholder="MY_MONGODB" spellCheck={false}
                 className={cn(fieldInput, 'font-mono')}/>
        </div>
        {text('database', 'Database', database, 'crm')}
        {text('collection', 'Collection', collection, 'staging')}
      </div>
      <section className="flex min-h-[180px] flex-1 flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Filter</h3>
        <div className="relative min-h-[160px] flex-1">
          <CodeEditor value={filter} onValue={v => setConfig('filter', v)} path={nodeId} label="Delete filter" language="javascript"/>
        </div>
      </section>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={allowAll} onChange={e => setConfig('allowAll', e.target.checked)} className="nodrag size-4 accent-destructive"/>
        <span className={cn(allowAll && 'font-medium text-destructive')}>Delete all (allow an empty filter)</span>
      </label>
    </div>
  );
}

function MongoDeleteDocs() {
  return (
    <>
      <p>Deletes the documents of a MongoDB collection that match a filter. E.g.: cleaning a staging collection before importing again.</p>
      <h4>Input</h4>
      <p>1 envelope port. Each envelope runs one <code>deleteMany(filter)</code>, with the filter evaluated on it. To delete only once, put it after the Start (one envelope) or after an Aggregate that gathers everything.</p>
      <h4>Filter</h4>
      <p>Written as Compass or mongosh show it, and evaluated on the envelope like the MongoDB Pipeline: <code>$PARAMETERS</code>, <code>$WORKFLOW_CURRENT_RUN</code>, each field (<code>$field</code>) and the helpers <code>ObjectId(&quot;…&quot;)</code>, <code>ISODate(&quot;…&quot;)</code>, <code>new Date(…)</code>.</p>
      <pre>{`{ empresaIdInfofisio: $PARAMETERS.empresaId }
{ status: "pendente", criadoEm: { $lt: ISODate("2026-01-01") } }`}</pre>
      <h4>Delete all</h4>
      <p>An empty filter (<code>{'{}'}</code>) deletes the whole collection, so it is refused, when the flow is checked and when it runs, unless <b>Delete all</b> is on.</p>
      <h4>Output</h4>
      <p>The incoming envelope plus <code>$mongodb</code> (the name can be changed): <code>{'{deleted}'}</code>, how many documents were deleted. Override on: only <code>$mongodb</code>.</p>
      <h4>Test run and Run for real</h4>
      <p>It writes to the database, so the editor&apos;s <b>Run</b> deletes nothing: it counts the documents the filter matches and writes it in the log (&quot;12 document(s) match the filter …; none deleted&quot;), and the envelope goes on with <code></code> = <code>{'{notSent: true, matched}'}</code>, so the rest of the flow is tested too. <b>Run for real</b> deletes.</p>
      <h4>Connection</h4>
      <p>The name of a secret (<code>$SECRETS</code>) holding the connection string. It is never stored in the flow or in the logs.</p>
      <h4>Errors</h4>
      <p>A filter that does not evaluate, is not an object, comes out empty without Delete all, or fails on the server is an error of the envelope and follows the card&apos;s &quot;On error&quot; policy.</p>
    </>
  );
}

export const MONGODB_DELETE: ComponentDef = {
  type: mongodbDelete.type,
  label: 'MongoDB Delete',
  description: 'Deletes the documents that match a filter',
  category: 'entity',
  icon: Trash2,
  inputs: mongodbDelete.inputs,
  outputs: mongodbDelete.outputs,
  usesOverride: true,
  defaultOutputKey: mongodbDelete.defaultOutputKey,
  windowSize: {w: 680, h: 560},
  defaultConfig: {connection: '', database: '', collection: '', filter: DEFAULT_DELETE_FILTER, allowAll: false},
  Card: MongoDeleteCard,
  Panel: MongoDeletePanel,
  Docs: MongoDeleteDocs,
  validate: config => mongodbDelete.validate(config),
};
