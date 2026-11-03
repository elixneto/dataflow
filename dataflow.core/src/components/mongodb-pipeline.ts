import {toError} from '#errors/normalize-error';
import {mergeFields} from '#envelope/envelope-data';
import type {ComponentLogic} from '#types/component-logic.type';
import {serverTimed} from './server-timed';
import {evaluateMongo, mongoExpression} from './mongo-expression';

/**
 * MongoDB Pipeline (a source): runs an aggregation pipeline on a collection and yields one envelope per document, with
 * the fields written into DATA (like the SQL Server Query; Override = only the document). Runs once for each incoming
 * envelope (usually the only one the Start yields), streamed from the cursor with backpressure.
 *
 * The pipeline is written as Compass and mongosh show it (unquoted keys, either quotes, trailing commas): it is a JS
 * expression evaluated on the incoming envelope, so values can come from it (`{$match: {cpf: $CPF}}`). The mongosh
 * helpers are there: ObjectId("…"), ISODate("…"), NumberLong, NumberInt, NumberDecimal; they become Extended JSON
 * ({$oid}, {$date}...), which the runner turns into BSON, so the core needs no MongoDB code. Read only: a pipeline with
 * $out or $merge (which write) is refused, here and in the runner.
 */

export const DEFAULT_MONGODB_TIMEOUT_S = 300;

export const DEFAULT_PIPELINE = `[
  {
    $match: {}
  },
  {
    $limit: 100
  }
]`;

export function mongoPipelineConfig(config: Record<string, unknown>) {
  const timeout = Math.round(Number(config.timeoutS ?? DEFAULT_MONGODB_TIMEOUT_S));
  return {
    connection: typeof config.connection === 'string' ? config.connection : '',
    database: typeof config.database === 'string' ? config.database : '',
    collection: typeof config.collection === 'string' ? config.collection : '',
    pipeline: typeof config.pipeline === 'string' ? config.pipeline : DEFAULT_PIPELINE,
    timeoutS: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_MONGODB_TIMEOUT_S,
  };
}

/** Stages that write: a source never sends them. */
const WRITING_STAGES = ['$out', '$merge'];

/** Why the written pipeline would write (a $out or $merge key in the text), or null. A check on the text, before running. */
export function mongoPipelineTextIssue(text: string): string | null {
  const found = text.match(/["']?\$(out|merge)["']?\s*:/);
  return found ? `cannot use $${found[1]} (it is read-only)` : null;
}

/** Why the evaluated pipeline is not a read-only list of stages, or null. */
export function mongoPipelineIssue(pipeline: unknown): string | null {
  if (!Array.isArray(pipeline)) return 'is not a list of stages ([ {...}, {...} ])';
  for (const [i, stage] of pipeline.entries()) {
    if (typeof stage !== 'object' || stage === null || Array.isArray(stage)) return `stage ${i + 1} is not an object`;
    const writing = Object.keys(stage).find(key => WRITING_STAGES.includes(key));
    if (writing) return `cannot use ${writing} (it is read-only)`;
  }
  return null;
}

/** The pipeline text as an expression with the mongosh helpers in scope (mongo-expression.ts). */
export const pipelineExpression = mongoExpression;

export const mongodbPipeline: ComponentLogic = {
  type: 'mongodb-pipeline',
  inputs: 1,
  outputs: 1,

  validate(config) {
    const {connection, database, collection, pipeline} = mongoPipelineConfig(config);
    const issues: string[] = [];
    if (!connection.trim()) issues.push('has no connection (name of the secret holding the connection string).');
    if (!database.trim()) issues.push('has no database.');
    if (!collection.trim()) issues.push('has no collection.');
    if (!pipeline.trim()) issues.push('has no pipeline.');
    const issue = mongoPipelineTextIssue(pipeline);
    if (issue) issues.push(`${issue}.`);
    return issues;
  },

  async* execute(inputs, config, ctx) {
    const {connection, database, collection, pipeline, timeoutS} = mongoPipelineConfig(config);
    let queries = 0;
    let documents = 0;
    for await (const doc of inputs['in-0'] ?? []) {
      queries += 1;
      const t0 = Date.now();
      let thisQuery = 0;
      let server = 0;
      try {
        const stages = evaluateMongo(pipeline, 'pipeline', value => ctx.fieldValue({value, expression: true}, doc));
        const issue = mongoPipelineIssue(stages);
        if (issue) throw new Error(`The pipeline ${issue}.`);
        const cursor = ctx.aggregateDocuments('mongodb', {
          secret: connection, database, collection, pipeline: stages as Record<string, unknown>[], timeoutMs: timeoutS * 1000,
        });
        // waiting for the server is not active time
        for await (const found of ctx.waitEach(serverTimed(cursor, ms => { server += ms; }))) {
          thisQuery += 1;
          yield {port: 'out-0', doc: mergeFields(doc, found, ctx.node.override)};
        }
        ctx.log('info', `Pipeline ${queries}: ${thisQuery} document(s) in ${Date.now() - t0} ms (server ${Math.round(server)} ms).`);
      } catch (e) {
        // documents already yielded move on; the envelope that triggered the pipeline goes to the error policy
        if (thisQuery) ctx.log('warning', `Pipeline ${queries} stopped after ${thisQuery} document(s).`);
        yield {error: toError(e), doc};
      }
      documents += thisQuery;
    }
    ctx.log('info', `${documents} document(s) read from ${database}.${collection} in ${queries} pipeline(s).`);
  },
};
