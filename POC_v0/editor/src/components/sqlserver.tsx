import {Database, Plus, X} from 'lucide-react';
import {sqlServerConfig, sqlServerUsedParameters, sqlserver, DEFAULT_SQL_SERVER_TIMEOUT_S, type SqlServerParameter} from '@dataflow/core';
import {ExpressionInput, fieldInput} from '#ui/expression-field';
import {CodeEditor} from '#ui/code-editor';
import {cn} from '#lib/utils';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the SQL Server Query. The logic is the core's; the runner talks to the database.

function SqlServerCard({config}: FieldsProps) {
  const {connection, sql} = sqlServerConfig(config);
  const firstLine = sql.trim().split('\n')[0] ?? '';
  return (
    <div className="flex flex-col gap-1 font-mono text-xs">
      <p className="truncate"><span className="text-muted-foreground">$SECRETS.</span><span className="font-semibold">{connection || '?'}</span></p>
      {firstLine
        ? <p className="truncate text-primary" title={sql}>{firstLine}</p>
        : <p className="italic text-muted-foreground">No query</p>}
    </div>
  );
}

function SqlServerPanel({id, nodeId, config, setConfig}: FieldsProps) {
  const {connection, sql, parameters, timeoutS} = sqlServerConfig(config);
  const change = (i: number, update: Partial<SqlServerParameter>) => setConfig('parameters', parameters.map((p, j) => (j === i ? {...p, ...update} : p)));
  const declared = new Set(parameters.map(p => p.name.toLowerCase()));
  const missing = sqlServerUsedParameters(sql).filter(n => !declared.has(n.toLowerCase()));

  return (
    <div className="flex min-h-[520px] flex-1 !shrink flex-col gap-4">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-3">
        <label htmlFor={`${id}-connection`} className="text-xs font-medium text-muted-foreground">Connection</label>
        <div className="flex min-w-0 items-center gap-1">
          <span className="font-mono text-sm text-muted-foreground" aria-hidden="true">$SECRETS.</span>
          <input id={`${id}-connection`} value={connection} onChange={e => setConfig('connection', e.target.value)} placeholder="MY_SQL_DATABASE" spellCheck={false}
                 className={cn(fieldInput, 'font-mono')}/>
        </div>
        <label htmlFor={`${id}-timeout`} className="text-xs font-medium text-muted-foreground">Timeout (s)</label>
        <input id={`${id}-timeout`} type="number" min={1} value={timeoutS}
               onChange={e => setConfig('timeoutS', Math.max(1, Math.round(Number(e.target.value) || DEFAULT_SQL_SERVER_TIMEOUT_S)))}
               className={cn(fieldInput, 'w-24 font-mono')}/>
      </div>

      <section className="flex min-h-[220px] flex-1 flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Query</h3>
        <div className="relative min-h-[200px] flex-1">
          <CodeEditor value={sql} onValue={v => setConfig('sql', v)} path={nodeId} label="SQL query" language="sql"/>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Parameters</h3>
        <div className="flex flex-col overflow-hidden rounded-md border border-border">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_32px] items-center gap-x-1.5 border-b border-border bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground">
            <span>Name</span><span>Value</span><span/>
          </div>
          {parameters.map((p, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_32px] items-center gap-x-1.5 border-b border-border px-2 py-1.5 last:border-b-0">
              <div className="flex min-w-0 items-center gap-1">
                <span className="font-mono text-sm text-muted-foreground" aria-hidden="true">@</span>
                <input value={p.name} onChange={e => change(i, {name: e.target.value})} placeholder="parameter" spellCheck={false}
                       aria-label={`Name of parameter ${i + 1}`} className={cn(fieldInput, 'font-mono')}/>
              </div>
              <ExpressionInput nodeId={nodeId} label={`Value of parameter ${i + 1}`} value={p.value} expression={p.expression}
                               onValue={value => change(i, {value})} onExpression={expression => change(i, {expression})}/>
              <button type="button" onClick={() => setConfig('parameters', parameters.filter((_, j) => j !== i))} aria-label={`Remove parameter ${i + 1}`}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="size-4" aria-hidden="true"/>
              </button>
            </div>
          ))}
          {parameters.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">No parameters</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setConfig('parameters', [...parameters, {name: '', value: '', expression: true}])}
                  className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-dashed border-input text-xs text-muted-foreground hover:border-ring hover:text-foreground">
            <Plus className="size-3.5" aria-hidden="true"/> Add parameter
          </button>
          {missing.length > 0 && (
            <button type="button" onClick={() => setConfig('parameters', [...parameters, ...missing.map(name => ({name, value: '', expression: true}))])}
                    className="flex h-8 items-center justify-center gap-1 rounded-md border border-input px-3 text-xs text-muted-foreground hover:border-ring hover:text-foreground">
              <Plus className="size-3.5" aria-hidden="true"/> Include {missing.map(n => `@${n}`).join(', ')}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function SqlServerDocs() {
  return (
    <>
      <p>Runs a read-only query on SQL Server and yields one envelope per row.</p>
      <ul>
        <li>Parameters: <code>@name</code> in the query, its value from the envelope (<code>$PARAMETERS.since</code>), sent as a parameter: no SQL injection.</li>
        <li>Read only: a single <code>SELECT</code> or <code>WITH</code>, in a transaction that always rolls back.</li>
        <li>Streamed: millions of rows are fine. Dates come as dates.</li>
        <li>Connection: the name of a secret, never stored in the flow or the logs.</li>
      </ul>
    </>
  );
}

export const SQL_SERVER: ComponentDef = {
  type: sqlserver.type,
  label: 'SQL Server Query',
  description: 'Reads rows from SQL Server (read only)',
  category: 'database',
  icon: Database,
  inputs: sqlserver.inputs,
  outputs: sqlserver.outputs,
  usesOverride: true,
  windowSize: {w: 760, h: 680},
  defaultConfig: {connection: '', sql: 'SELECT TOP 100 *\nFROM ', parameters: [], timeoutS: DEFAULT_SQL_SERVER_TIMEOUT_S},
  Card: SqlServerCard,
  Panel: SqlServerPanel,
  Docs: SqlServerDocs,
  validate: config => sqlserver.validate(config),
};
