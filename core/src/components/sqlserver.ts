import {toError} from '#errors/normalize-error';
import {mergeFields} from '#envelope/envelope-data';
import type {ExpressionField} from '#types/expression-field.type';
import type {ComponentLogic} from '#types/component-logic.type';

/**
 * SQL Server Query (in Kettle, Table input): runs a read-only query and yields one envelope per row, with the
 * columns written into DATA (like the Data Grid; Override = only the columns). Runs once for each incoming envelope
 * (usually the only one the Start yields). E.g.: reading the orders of an ERP.
 *
 * The connection is the name of a secret holding the connection string (it never shows in the flow or in the logs). The `@name`s of
 * the query are parameters with an expression evaluated on the incoming envelope, sent to the database as parameters (never
 * pasted into the text). Read-only in three layers: here only SELECT/WITH gets through (see `sqlServerReadOnlyIssue`),
 * and the runner runs it inside a transaction that always rolls back, with ApplicationIntent=ReadOnly.
 */

export type SqlServerParameter = ExpressionField & {name: string};

export const DEFAULT_SQL_SERVER_TIMEOUT_S = 300;

export function sqlServerConfig(config: Record<string, unknown>) {
  const timeout = Math.round(Number(config.timeoutS ?? DEFAULT_SQL_SERVER_TIMEOUT_S));
  return {
    connection: typeof config.connection === 'string' ? config.connection : '',
    sql: typeof config.sql === 'string' ? config.sql : '',
    parameters: Array.isArray(config.parameters) ? (config.parameters as SqlServerParameter[]) : [],
    timeoutS: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_SQL_SERVER_TIMEOUT_S,
  };
}

/**
 * Removes comments, quoted strings and bracketed names, so the checks do not look inside them.
 * Reads left to right, like SQL Server: whatever opens first wins (`'--'` is a string, not a comment), and
 * block comments can be nested (a block inside another). An unclosed string or comment runs to the end.
 */
function stripStrings(sql: string) {
  let output = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
      output += ' ';
    } else if (two === '/*') {
      let level = 0;
      while (i < sql.length) {
        if (sql.startsWith('/*', i)) { level++; i += 2; }
        else if (sql.startsWith('*/', i)) { level--; i += 2; if (level === 0) break; }
        else i++;
      }
      output += ' ';
    } else if (c === "'" || c === '"' || c === '[') {
      const close = c === '[' ? ']' : c;
      i++;
      // doubled quotes ('' or ]]) are the character itself inside the string
      while (i < sql.length && !(sql[i] === close && sql[i + 1] !== close)) i += sql[i] === close ? 2 : 1;
      i++;
      output += c === '[' ? '[]' : `${c}${c}`;
    } else {
      output += c;
      i++;
    }
  }
  return output;
}

/** Words that write, change the schema, execute code or leave the database. */
const FORBIDDEN = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'TRUNCATE', 'DROP', 'ALTER', 'CREATE', 'GRANT', 'REVOKE', 'DENY',
  'EXEC', 'EXECUTE', 'INTO', 'BACKUP', 'RESTORE', 'DBCC', 'SHUTDOWN', 'KILL', 'BULK', 'OPENROWSET', 'OPENQUERY',
  'OPENDATASOURCE', 'OPENXML', 'USE', 'WAITFOR', 'RECONFIGURE', 'CHECKPOINT', 'SET', 'DECLARE', 'BEGIN', 'COMMIT',
  'ROLLBACK', 'SAVE', 'TRANSACTION', 'UPDATETEXT', 'WRITETEXT',
];

/**
 * Why the query is not read-only, or null. Accepts a single statement, starting with SELECT or WITH, without words
 * that write (INSERT, UPDATE, SELECT INTO...), execute (EXEC, sp_/xp_ procedures) or change the session (SET, USE).
 */
export function sqlServerReadOnlyIssue(sql: string): string | null {
  const clean = stripStrings(sql).trim().replace(/;\s*$/, '');
  if (!clean) return 'has no query';
  if (clean.includes(';')) return 'has more than one statement (only one SELECT per component)';
  if (!/^(SELECT|WITH)\b/i.test(clean)) return 'does not start with SELECT or WITH (it is read-only)';
  const word = clean.match(new RegExp(`\\b(${FORBIDDEN.join('|')})\\b`, 'i'));
  if (word) return `cannot use ${word[1].toUpperCase()} (it is read-only)`;
  const procedure = clean.match(/\b(sp_|xp_)\w*/i);
  if (procedure) return `cannot call ${procedure[0]} (it is read-only)`;
  return null;
}

/** The @names used in the query (without the system variables, @@ROWCOUNT etc.). */
export function sqlServerUsedParameters(sql: string): string[] {
  return [...new Set([...stripStrings(sql).matchAll(/(?<!@)@([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]))];
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const sqlserver: ComponentLogic = {
  type: 'sqlserver',
  inputs: 1,
  outputs: 1,

  validate(config) {
    const {connection, sql, parameters} = sqlServerConfig(config);
    const issues: string[] = [];
    if (!connection.trim()) issues.push('has no connection (name of the secret holding the connection string).');
    const issue = sqlServerReadOnlyIssue(sql);
    if (issue) issues.push(`${issue}.`);
    const names = new Set<string>();
    parameters.forEach((p, i) => {
      if (!IDENTIFIER.test(p.name ?? '')) issues.push(`parameter ${i + 1} ${p.name ? `"@${p.name}" is not a valid name` : 'has no name'}.`);
      else if (names.has(p.name.toLowerCase())) issues.push(`has the parameter "@${p.name}" more than once.`);
      names.add((p.name ?? '').toLowerCase());
    });
    for (const used of sqlServerUsedParameters(sql)) {
      if (!names.has(used.toLowerCase())) issues.push(`uses @${used}, which is not in the parameters.`);
    }
    return issues;
  },

  async* execute(inputs, config, ctx) {
    const {connection, sql, parameters, timeoutS} = sqlServerConfig(config);
    const issue = sqlServerReadOnlyIssue(sql);
    if (issue) throw new Error(`The query ${issue}.`);
    let queries = 0;
    let rows = 0;
    for await (const doc of inputs['in-0'] ?? []) {
      queries += 1;
      const t0 = Date.now();
      let thisQuery = 0;
      try {
        const values = Object.fromEntries(parameters.map(p => [p.name, ctx.fieldValue(p, doc)]));
        // waiting for the database is not active time
        const query = ctx.querySqlServer({secret: connection, sql, parameters: values, timeoutMs: timeoutS * 1000});
        for await (const row of ctx.waitEach(query)) {
          thisQuery += 1;
          yield {port: 'out-0', doc: mergeFields(doc, row, ctx.node.override)};
        }
        ctx.log('info', `Query ${queries}: ${thisQuery} row(s) in ${Date.now() - t0} ms.`);
      } catch (e) {
        // rows already yielded move on; the envelope that triggered the query goes to the error policy
        if (thisQuery) ctx.log('warning', `Query ${queries} stopped after ${thisQuery} row(s).`);
        yield {error: toError(e), doc};
      }
      rows += thisQuery;
    }
    ctx.log('info', `${rows} row(s) read in ${queries} query(ies).`);
  },
};
