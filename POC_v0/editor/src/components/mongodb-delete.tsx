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
      <p>Deletes the documents of a collection that match a filter (<code>deleteMany</code>), once per envelope.</p>
      <ul>
        <li>Filter as Compass shows it, with expressions: <code>{'{ sku: $sku }'}</code>, <code>ISODate(…)</code>, <code>ObjectId(…)</code>.</li>
        <li>An empty filter (<code>{'{}'}</code>) is refused unless <b>Delete all</b> is on.</li>
        <li>Output: <code>{'$mongodb: {deleted}'}</code>.</li>
        <li>Test run: deletes nothing, only counts the matches. Run for real deletes.</li>
        <li>Connection: the name of a secret, never stored in the flow or the logs.</li>
      </ul>
    </>
  );
}

export const MONGODB_DELETE: ComponentDef = {
  type: mongodbDelete.type,
  label: 'MongoDB Delete',
  description: 'Deletes the documents that match a filter',
  category: 'database',
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
