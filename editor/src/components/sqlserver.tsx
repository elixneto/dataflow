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
      <p>Runs a query on SQL Server and emits one envelope per row, with the columns written into the envelope. E.g.: reading the orders of an ERP.</p>
      <h4>Input</h4>
      <p>1 envelope port, usually connected to the Start. The query runs once for each incoming envelope (the Start emits one).</p>
      <h4>Output</h4>
      <p>One envelope per row, with the <code>DATA</code> of the incoming envelope plus the columns (<code>$column</code>). Dates (<code>date</code>, <code>datetime</code>, <code>datetime2</code>, <code>smalldatetime</code>, <code>datetimeoffset</code>) come as dates (a <code>Date</code>; a <code>date</code> column at midnight UTC): an expression can use them (<code>{'$created.getUTCFullYear()'}</code>), Sort orders them by time and the MongoDB Upsert writes them as dates. The Data tab shows them as ISO text (<code>2026-10-21T18:00:00.000Z</code>). Binaries come as base64. Reading is streamed: the database pauses while the flow is not consuming, so millions of rows can be read.</p>
      <h4>Connection</h4>
      <p>The name of a secret (<code>$SECRETS</code>) holding the connection string. It is never stored in the flow or in the logs. E.g.: <code>Server=srv;Database=erp;User Id=reader;Password=...;Encrypt=true;TrustServerCertificate=true</code>.</p>
      <h4>Parameters</h4>
      <p>Use <code>@name</code> in the query and give the value below (text or an expression on the incoming envelope, e.g. <code>$PARAMETERS.since</code>). The value goes to the database as a parameter, never pasted into the text: it cannot turn into SQL injection.</p>
      <pre>{`SELECT id, name, companyCode
FROM Ticket
WHERE date >= @since`}</pre>
      <h4>Read only</h4>
      <p>Only a single statement is accepted, starting with <code>SELECT</code> or <code>WITH</code>, with no <code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code>, <code>SELECT INTO</code>, <code>EXEC</code>, procedures etc. Even so, the query runs inside a transaction that is always rolled back, and the connection uses <code>ApplicationIntent=ReadOnly</code>. Ideally the secret's login has only <code>db_datareader</code>.</p>
      <h4>Timeout</h4>
      <p>Past the timeout, the query is cancelled on the database and becomes an error. The Stop button also cancels it.</p>
      <h4>Errors</h4>
      <p>A connection, login or query failure is an error of the envelope that triggered the query and follows the card's "On error" policy. If the failure happens mid-read, the rows that already went out move on.</p>
      <h4>Override</h4>
      <p>On, the output envelope carries only the query's columns.</p>
    </>
  );
}

export const SQL_SERVER: ComponentDef = {
  type: sqlserver.type,
  label: 'SQL Server Query',
  description: 'Reads rows from SQL Server (read only)',
  category: 'source',
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
