import {Leaf} from 'lucide-react';
import {mongoPipelineConfig, mongodbPipeline, DEFAULT_MONGODB_TIMEOUT_S, DEFAULT_PIPELINE} from '@dataflow/core';
import {fieldInput} from '#ui/expression-field';
import {CodeEditor} from '#ui/code-editor';
import {cn} from '#lib/utils';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the MongoDB Pipeline. The logic is the core's; the runner talks to the database.

/** The stage names of the pipeline text, in order ($match → $sort → $skip), for the card: the keys one level inside. */
function stageNames(text: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === '\'' || c === '`') quote = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === '$' && depth === 2) {
      const name = /^\$[A-Za-z]+(?=["']?\s*:)/.exec(text.slice(i));
      if (name) names.push(name[0]);
    }
  }
  return names;
}

function MongoPipelineCard({config}: FieldsProps) {
  const {connection, database, collection, pipeline} = mongoPipelineConfig(config);
  const stages = stageNames(pipeline);
  return (
    <div className="flex flex-col gap-1 font-mono text-xs">
      <p className="truncate"><span className="text-muted-foreground">$SECRETS.</span><span className="font-semibold">{connection || '?'}</span></p>
      <p className="truncate"><span className="text-muted-foreground">{database || '?'}.</span>{collection || '?'}</p>
      {stages.length
        ? <p className="truncate text-primary" title={pipeline}>{stages.join(' → ')}</p>
        : <p className="italic text-muted-foreground">No stages</p>}
    </div>
  );
}

function MongoPipelinePanel({id, nodeId, config, setConfig}: FieldsProps) {
  const {connection, database, collection, pipeline, timeoutS} = mongoPipelineConfig(config);
  const text = (key: string, label: string, value: string, placeholder: string) => (
    <>
      <label htmlFor={`${id}-${key}`} className="text-xs font-medium text-muted-foreground">{label}</label>
      <input id={`${id}-${key}`} value={value} onChange={e => setConfig(key, e.target.value)} placeholder={placeholder} spellCheck={false}
             className={cn(fieldInput, 'font-mono')}/>
    </>
  );
  return (
    <div className="flex min-h-[520px] flex-1 !shrink flex-col gap-4">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-3">
        <label htmlFor={`${id}-connection`} className="text-xs font-medium text-muted-foreground">Connection</label>
        <div className="flex min-w-0 items-center gap-1">
          <span className="font-mono text-sm text-muted-foreground" aria-hidden="true">$SECRETS.</span>
          <input id={`${id}-connection`} value={connection} onChange={e => setConfig('connection', e.target.value)} placeholder="MY_MONGODB" spellCheck={false}
                 className={cn(fieldInput, 'font-mono')}/>
        </div>
        <label htmlFor={`${id}-timeout`} className="text-xs font-medium text-muted-foreground">Timeout (s)</label>
        <input id={`${id}-timeout`} type="number" min={1} value={timeoutS}
               onChange={e => setConfig('timeoutS', Math.max(1, Math.round(Number(e.target.value) || DEFAULT_MONGODB_TIMEOUT_S)))}
               className={cn(fieldInput, 'w-24 font-mono')}/>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
        {text('database', 'Database', database, 'crm')}
        {text('collection', 'Collection', collection, 'orders')}
      </div>
      <section className="flex min-h-[260px] flex-1 flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Pipeline</h3>
        <div className="relative min-h-[240px] flex-1">
          <CodeEditor value={pipeline} onValue={v => setConfig('pipeline', v)} path={nodeId} label="Aggregation pipeline" language="javascript"/>
        </div>
      </section>
    </div>
  );
}

function MongoPipelineDocs() {
  return (
    <>
      <p>Runs an aggregation pipeline on a MongoDB collection and emits one envelope per resulting document, with its fields written into the envelope. E.g.: reading the appointments of a period.</p>
      <h4>Input</h4>
      <p>1 envelope port, usually connected to the Start. The pipeline runs once for each incoming envelope (the Start emits one).</p>
      <h4>Output</h4>
      <p>One envelope per document, with the <code>DATA</code> of the incoming envelope plus the document&apos;s fields (<code>$_id</code>, <code>$field</code>). Reading is streamed: the cursor fetches the next documents only when the flow asks, so large collections can be read.</p>
      <h4>Pipeline</h4>
      <p>Paste it as Compass or mongosh show it: keys without quotes, single or double quotes, trailing commas.</p>
      <pre>{`[
  { $match: { status: "ACTIVE" } },
  { $sort: { createdAt: -1 } },
  { $skip: 15 },
  { $limit: 100 }
]`}</pre>
      <p>It is a JS expression evaluated on the incoming envelope, so values can come from it: <code>$PARAMETERS</code>, <code>$WORKFLOW_CURRENT_RUN</code>, <code>$SECRETS</code> and each field (<code>$field</code>). Stage names like <code>$match</code> are keys, so they do not get mixed up with the variables; a field path in MongoDB goes in quotes, as usual (<code>{'"$total"'}</code>).</p>
      <pre>{`[{ $match: { cpf: $CPF, date: { $gte: ISODate($PARAMETERS.since) } } }]`}</pre>
      <p>The mongosh helpers work: <code>ObjectId(&quot;…&quot;)</code>, <code>ISODate(&quot;…&quot;)</code>, <code>new Date(…)</code>, <code>NumberLong</code>, <code>NumberInt</code>, <code>NumberDecimal</code>. Extended JSON also works (<code>{'{$oid: "…"}'}</code>, <code>{'{$date: "…"}'}</code>).</p>
      <h4>Read only</h4>
      <p>A pipeline with <code>$out</code> or <code>$merge</code> (they write to a collection) is refused. To write, use the MongoDB Upsert. Since it only reads, it runs in the editor&apos;s Run as well as in Run for real.</p>
      <h4>How the values come out</h4>
      <p>Dates stay dates (a <code>Date</code>, like the SQL Server Query's): an expression can use them (<code>{'$at.getUTCFullYear()'}</code>), Sort orders them by time and the MongoDB Upsert writes them back as dates. The Data tab shows them as ISO text (<code>2026-10-21T18:00:00.000Z</code>). The rest as plain JSON: <code>ObjectId</code> as its hex text, <code>Decimal128</code> as text (it keeps every digit), <code>Long</code> as a number (as text past 2^53), binaries as base64.</p>
      <h4>Connection</h4>
      <p>The name of a secret (<code>$SECRETS</code>) holding the connection string, e.g. <code>mongodb+srv://reader:password@cluster.example.net</code>. It is never stored in the flow or in the logs. Ideally the user can only read.</p>
      <h4>Timeout</h4>
      <p>Past the timeout (MongoDB&apos;s <code>maxTimeMS</code>), the pipeline stops on the server and becomes an error. The Stop button also stops it.</p>
      <h4>Errors</h4>
      <p>A pipeline that does not evaluate, is not a list of stages, or fails on the server (connection, login, a wrong stage) is an error of the envelope that triggered it and follows the card&apos;s &quot;On error&quot; policy. If it fails mid-read, the documents that already went out move on.</p>
      <h4>Override</h4>
      <p>On, the output envelope carries only the document&apos;s fields.</p>
    </>
  );
}

export const MONGODB_PIPELINE: ComponentDef = {
  type: mongodbPipeline.type,
  label: 'MongoDB Pipeline',
  description: 'Reads documents with an aggregation pipeline',
  category: 'database',
  icon: Leaf,
  inputs: mongodbPipeline.inputs,
  outputs: mongodbPipeline.outputs,
  usesOverride: true,
  windowSize: {w: 760, h: 680},
  defaultConfig: {connection: '', database: '', collection: '', pipeline: DEFAULT_PIPELINE, timeoutS: DEFAULT_MONGODB_TIMEOUT_S},
  Card: MongoPipelineCard,
  Panel: MongoPipelinePanel,
  Docs: MongoPipelineDocs,
  validate: config => mongodbPipeline.validate(config),
};
