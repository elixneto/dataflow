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
      <p>Runs an aggregation pipeline on a collection and yields one envelope per document.</p>
      <ul>
        <li>Paste the pipeline as Compass shows it; values can come from the envelope: <code>{'{ $match: { cpf: $cpf } }'}</code>.</li>
        <li>Read only: <code>$out</code> and <code>$merge</code> are refused, so it runs in test runs too.</li>
        <li>Streamed from the cursor: large collections are fine. Dates stay dates.</li>
        <li>Connection: the name of a secret, never stored in the flow or the logs.</li>
      </ul>
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
