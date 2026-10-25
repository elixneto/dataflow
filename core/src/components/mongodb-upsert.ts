import {withKey} from '#envelope/envelope-data';
import {isDate} from '#envelope/dates';
import {toError} from '#errors/normalize-error';
import type {ComponentLogic} from '#types/component-logic.type';
import type {DocumentUpsert} from '#types/document-upsert.type';
import type {Envelope} from '#types/envelope.type';
import type {ExpressionField} from '#types/expression-field.type';

/**
 * MongoDB Upsert (a target): for each envelope, updates the document of the collection that matches the filter with
 * the fields of the document (`$set`), or inserts it when nothing matches. The filter is a list of field = value
 * pairs (values are expressions on the envelope, e.g. `email` = `$email`); the document is the whole DATA or an
 * expression. `_id` never goes in the `$set` (an upsert takes it from the filter; MongoDB does not change it).
 *
 * Writes in batches: one `updateOne` per document (the ones of a batch at the same time, those with the same filter
 * one after the other, in arrival order: runner/src/databases/mongodb.ts) and maps each result back to its envelope:
 * the envelope goes out with `{matched, modified, upsertedId}` in its output key; one that failed goes to the error
 * policy. The log counts, per batch and in all, the documents inserted, modified and unchanged (matched, nothing to
 * change). In a test run it writes nothing (the engine's gate for `sideEffects`).
 */

export type MongoFilterKey = ExpressionField & {field: string};
export type MongoDocumentSource = 'data' | 'expression';

export const DEFAULT_MONGODB_BATCH_SIZE = 500;
export const MAX_MONGODB_BATCH_SIZE = 10_000;

export function mongoUpsertConfig(config: Record<string, unknown>) {
  const size = Math.round(Number(config.batchSize ?? DEFAULT_MONGODB_BATCH_SIZE));
  const document = config.document as ExpressionField | undefined;
  return {
    connection: typeof config.connection === 'string' ? config.connection : '',
    database: typeof config.database === 'string' ? config.database : '',
    collection: typeof config.collection === 'string' ? config.collection : '',
    filter: Array.isArray(config.filter) ? (config.filter as MongoFilterKey[]) : [],
    source: (config.source === 'expression' ? 'expression' : 'data') as MongoDocumentSource,
    document: {value: typeof document?.value === 'string' ? document.value : '', expression: true},
    batchSize: Number.isFinite(size) && size >= 1 ? Math.min(size, MAX_MONGODB_BATCH_SIZE) : DEFAULT_MONGODB_BATCH_SIZE,
  };
}

const describe = (c: {inserted: number; modified: number; unchanged: number}) => `${c.inserted} inserted, ${c.modified} modified, ${c.unchanged} unchanged`;

/**
 * The value with its dates as Date of this realm, at any depth: the driver writes them as BSON dates. A Date made in
 * an expression (node:vm, another realm) would not be recognized as one. Text stays text, whatever it looks like.
 */
function withDates(value: unknown): unknown {
  if (isDate(value)) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(withDates);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withDates(v)]));
  return value;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A MongoDB field path: no `$` at the start, no empty parts (`a..b`), no NUL. */
const validField = (field: string) => /^[^$.\0][^\0]*$/.test(field) && !field.split('.').some(part => part === '');

export const mongodbUpsert: ComponentLogic = {
  type: 'mongodb-upsert',
  inputs: 1,
  outputs: 1,
  defaultOutputKey: 'mongodb',
  sideEffects: true,

  validate(config) {
    const {connection, database, collection, filter, source, document} = mongoUpsertConfig(config);
    const issues: string[] = [];
    if (!connection.trim()) issues.push('has no connection (name of the secret holding the connection string).');
    if (!database.trim()) issues.push('has no database.');
    if (!collection.trim()) issues.push('has no collection.');
    if (filter.length === 0) issues.push('has no filter field (what finds the document to update).');
    const fields = new Set<string>();
    filter.forEach((f, i) => {
      const field = (f.field ?? '').trim();
      if (!field) issues.push(`filter field ${i + 1} has no name.`);
      else if (!validField(field)) issues.push(`filter field "${field}" is not a valid MongoDB field.`);
      else if (fields.has(field)) issues.push(`has the filter field "${field}" more than once.`);
      fields.add(field);
    });
    if (source === 'expression' && !document.value.trim()) issues.push('has no document expression.');
    return issues;
  },

  async* execute(inputs, config, ctx) {
    const {connection, database, collection, filter, source, document, batchSize} = mongoUpsertConfig(config);
    const key = ctx.node.outputKey || 'mongodb';
    let batch: {doc: Envelope; upsert: DocumentUpsert}[] = [];
    let written = 0;
    let failed = 0;
    let sent = 0;
    let prepared = 0;
    let batches = 0;
    const totals = {inserted: 0, modified: 0, unchanged: 0};

    /** builds the upsert of an envelope; a bad value is an error of that envelope */
    const upsertOf = (doc: Envelope): DocumentUpsert => {
      const match: Record<string, unknown> = {};
      for (const f of filter) {
        const value = ctx.fieldValue(f, doc);
        if (value === undefined) throw new Error(`The filter field "${f.field}" has no value.`);
        match[f.field.trim()] = withDates(value);
      }
      const fields = source === 'expression' ? ctx.fieldValue(document, doc) : doc.DATA;
      if (!isObject(fields)) throw new Error('The document is not an object.');
      const set = withDates(fields) as Record<string, unknown>;
      delete set._id;
      return {filter: match, document: set};
    };

    async function* flush() {
      const current = batch;
      batch = [];
      ctx.holding(0);
      if (!current.length) return;
      let results;
      const t0 = performance.now();
      try {
        results = await ctx.upsertDocuments('mongodb', {secret: connection, database, collection, upserts: current.map(b => b.upsert)});
      } catch (e) {
        // the whole batch failed (connection, authentication): each of its envelopes goes to the error policy
        failed += current.length;
        for (const {doc} of current) yield {error: toError(e), doc};
        return;
      }
      // a test run: nothing written, nothing goes on
      if (results === null) {
        prepared += current.length;
        return;
      }
      sent += current.length;
      batches += 1;
      const counts = {inserted: 0, modified: 0, unchanged: 0, failed: 0};
      for (const r of results) {
        if ('error' in r) counts.failed += 1;
        else if (r.upsertedId !== null) counts.inserted += 1;
        else if (r.modified > 0) counts.modified += 1;
        // matched a document that already had these values (e.g. the same envelope twice)
        else if (r.matched > 0) counts.unchanged += 1;
      }
      totals.inserted += counts.inserted;
      totals.modified += counts.modified;
      totals.unchanged += counts.unchanged;
      ctx.log('info', `Batch ${batches}: ${current.length} upsert(s) in ${Math.round(performance.now() - t0)} ms (${describe(counts)}${counts.failed ? `, ${counts.failed} failed` : ''}).`);
      for (const [i, {doc}] of current.entries()) {
        const result = results[i];
        if (!result || 'error' in result) {
          failed += 1;
          yield {error: new Error(result?.error ?? 'MongoDB did not answer for this document.'), doc};
          continue;
        }
        written += 1;
        yield {port: 'out-0', doc: withKey(doc, key, result, ctx.node.override)};
      }
    }

    for await (const doc of inputs['in-0'] ?? []) {
      try {
        batch.push({doc, upsert: upsertOf(doc)});
        ctx.holding(batch.length, doc);
      } catch (e) {
        failed += 1;
        yield {error: toError(e), doc};
        continue;
      }
      if (batch.length >= batchSize) yield* flush();
    }
    yield* flush();
    if (prepared) ctx.log('info', `${prepared} upsert(s) prepared for ${database}.${collection}, none sent${failed ? `, ${failed} failed` : ''}.`);
    else ctx.log('info', `${written} document(s) upserted into ${database}.${collection}: ${describe(totals)}${failed ? `, ${failed} failed` : ''} (${sent} sent).`);
  },
};
