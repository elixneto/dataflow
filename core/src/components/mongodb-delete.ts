import {withKey} from '#envelope/envelope-data';
import {toError} from '#errors/normalize-error';
import type {ComponentLogic} from '#types/component-logic.type';
import {evaluateMongo} from './mongo-expression';

/**
 * MongoDB Delete (a target): for each envelope, deletes every document of the collection that matches the filter
 * (deleteMany) and the envelope goes on with `{deleted}` in its output key. The filter is written as Compass and
 * mongosh show it, evaluated on the envelope (`{empresaId: $PARAMETERS.empresaId}`), with the same mongosh helpers as
 * the MongoDB Pipeline. An empty filter (`{}`) deletes the whole collection: it is refused unless "Delete all" is on.
 * In a test run it deletes nothing: it counts what the filter matches and logs it (the engine's gate for `sideEffects`).
 */

export const DEFAULT_DELETE_FILTER = `{
  campo: $campo
}`;

export function mongoDeleteConfig(config: Record<string, unknown>) {
  return {
    connection: typeof config.connection === 'string' ? config.connection : '',
    database: typeof config.database === 'string' ? config.database : '',
    collection: typeof config.collection === 'string' ? config.collection : '',
    filter: typeof config.filter === 'string' ? config.filter : DEFAULT_DELETE_FILTER,
    allowAll: config.allowAll === true,
  };
}

/** Whether the filter text is an empty object (`{}`, with spaces or a comment at most): it would delete everything. */
export const emptyFilterText = (text: string) => /^\(?\s*\{\s*\}\s*\)?$/.test(text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').trim());

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const mongodbDelete: ComponentLogic = {
  type: 'mongodb-delete',
  inputs: 1,
  outputs: 1,
  defaultOutputKey: 'mongodb',
  sideEffects: true,

  validate(config) {
    const {connection, database, collection, filter, allowAll} = mongoDeleteConfig(config);
    const issues: string[] = [];
    if (!connection.trim()) issues.push('has no connection (name of the secret holding the connection string).');
    if (!database.trim()) issues.push('has no database.');
    if (!collection.trim()) issues.push('has no collection.');
    if (!filter.trim()) issues.push('has no filter.');
    else if (emptyFilterText(filter) && !allowAll) issues.push('has an empty filter, which deletes the whole collection: turn on "Delete all" to allow it.');
    return issues;
  },

  async* execute(inputs, config, ctx) {
    const {connection, database, collection, filter, allowAll} = mongoDeleteConfig(config);
    const key = ctx.node.outputKey || 'mongodb';
    const target = `${database}.${collection}`;
    let calls = 0;
    let deleted = 0;
    let tested = 0;
    for await (const doc of inputs['in-0'] ?? []) {
      calls += 1;
      const t0 = performance.now();
      try {
        const match = evaluateMongo(filter, 'filter', value => ctx.fieldValue({value, expression: true}, doc));
        if (!isObject(match)) throw new Error('The filter is not an object ({ field: value }).');
        if (Object.keys(match).length === 0 && !allowAll) {
          throw new Error('The filter is empty, which would delete the whole collection: turn on "Delete all" to allow it.');
        }
        const n = await ctx.deleteDocuments('mongodb', {secret: connection, database, collection, filter: match});
        // a test run: nothing deleted, nothing goes on
        if (n === null) {
          tested += 1;
          continue;
        }
        deleted += n;
        ctx.log('info', `Delete ${calls}: ${n} document(s) from ${target} in ${Math.round(performance.now() - t0)} ms.`);
        yield {port: 'out-0', doc: withKey(doc, key, {deleted: n}, ctx.node.override)};
      } catch (e) {
        yield {error: toError(e), doc};
      }
    }
    if (tested) ctx.log('info', `${tested} delete(s) counted on ${target}, none sent.`);
    else ctx.log('info', `${deleted} document(s) deleted from ${target} in ${calls} delete(s).`);
  },
};
