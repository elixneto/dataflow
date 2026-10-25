import {BSON, MongoBulkWriteError, MongoClient, type Document} from 'mongodb';
import {mongoPipelineIssue, type AggregateDocuments, type DocumentUpsert, type UpsertAnswer, type UpsertDocuments, type UpsertResult} from '@dataflow/core';

/*
 * MongoDB Upsert: each batch is one unordered `bulkWrite` of `updateOne(filter, {$set: document}, {upsert: true})`
 * operations with the official driver, so the whole batch lands in one write; the ones with the same filter keep
 * their arrival order (later rounds, see `upsertInRounds`), and a batch of one goes as `updateOne`. Each envelope gets
 * its own answer (matched, or the id of an inserted document, or its error); modified comes as the batch's total.
 * MongoDB Pipeline: `aggregate(pipeline)` with the cursor read as the flow asks (backpressure), each document turned into
 * plain JSON values (`toEnvelopeValue`). The pipeline arrives as Extended JSON ({$oid}, {$date}...: the component's
 * mongosh helpers) and becomes BSON here.
 * One client per connection string per run: `mongoDriver()` is created for a run and `close()` at its end.
 */

const {EJSON} = BSON;

/** A message without the connection string (the driver may put the host in it, never the password). */
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The id MongoDB generated (ObjectId) or took from the filter, as text. */
const idText = (id: unknown) => (id === null || id === undefined ? null : String(id));

/**
 * A value for the envelope, like the SQL Server Query does: a date stays Date (a later Upsert writes it back as a
 * date), ObjectId as its hex text, Decimal128 as text (it keeps every digit), Long as a number (as text past 2^53),
 * binary as base64. Other BSON types (Timestamp, MinKey...) as their relaxed Extended JSON.
 */
export function toEnvelopeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(toEnvelopeValue);
  if (typeof value !== 'object') return value;
  const bson = (value as {_bsontype?: string})._bsontype;
  if (bson === 'ObjectId' || bson === 'ObjectID') return (value as {toHexString: () => string}).toHexString();
  if (bson === 'Decimal128') return String(value);
  if (bson === 'Long') {
    const long = value as {toNumber: () => number; toString: () => string};
    const n = long.toNumber();
    return Number.isSafeInteger(n) ? n : long.toString();
  }
  if (bson === 'Int32' || bson === 'Double') return (value as {valueOf: () => number}).valueOf();
  if (bson === 'Binary') return (value as {toString: (encoding: 'base64') => string}).toString('base64');
  if (bson) return EJSON.serialize(value, {relaxed: true});
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toEnvelopeValue(v)]));
}

/** A bulk write's answer, by position in what was sent: the ids of the inserted ones and the errors. */
export type BulkAnswer = {upsertedIds: Record<number, unknown>; errors: Record<number, string>; modified: number};

/** One upsert written on its own (updateOne): it also says whether the document changed. */
export type SingleAnswer = {matched: number; modified: number; upsertedId: unknown};

/**
 * Writes the upserts of a batch together: one unordered bulk write, so one bad document does not stop the others.
 * Upserts with the same filter (same fields and values) keep their arrival order, so the last one wins: the first
 * occurrence of each filter goes in the first round, the second ones in the next round, and so on (usually there is
 * only one round). Sent in the same unordered write, two upserts of the same filter would have no order (when their
 * data differs, either one may be the final document), and with a filter that is not a unique index both may insert.
 * A round of one upsert goes on its own (updateOne), which also answers whether that document changed.
 * The results come back in the order of `upserts`.
 */
export async function upsertInRounds(
  upserts: DocumentUpsert[],
  writeOne: (upsert: DocumentUpsert) => Promise<SingleAnswer>,
  writeMany: (upserts: DocumentUpsert[]) => Promise<BulkAnswer>,
): Promise<UpsertAnswer> {
  const rounds: number[][] = [];
  const seen = new Map<string, number>();
  upserts.forEach((upsert, i) => {
    const key = JSON.stringify(upsert.filter);
    const round = seen.get(key) ?? 0;
    seen.set(key, round + 1);
    (rounds[round] ??= []).push(i);
  });
  const results: UpsertResult[] = new Array(upserts.length);
  let modified = 0;
  for (const round of rounds) {
    if (round.length === 1) {
      const i = round[0];
      try {
        const r = await writeOne(upserts[i]);
        results[i] = {matched: r.matched, modified: r.modified, upsertedId: idText(r.upsertedId)};
        modified += r.modified;
      } catch (e) {
        results[i] = {error: message(e)};
      }
      continue;
    }
    const answer = await writeMany(round.map(i => upserts[i]));
    modified += answer.modified;
    round.forEach((i, k) => {
      if (k in answer.errors) results[i] = {error: answer.errors[k]};
      else if (k in answer.upsertedIds) results[i] = {matched: 0, upsertedId: idText(answer.upsertedIds[k])};
      else results[i] = {matched: 1, upsertedId: null};
    });
  }
  return {results, modified};
}

export function mongoDriver() {
  const clients = new Map<string, Promise<MongoClient>>();

  function client(connection: string) {
    let c = clients.get(connection);
    if (!c) {
      c = new MongoClient(connection, {serverSelectionTimeoutMS: 15_000}).connect();
      // a connection that failed is not kept (the next batch tries again)
      c.catch(() => clients.delete(connection));
      clients.set(connection, c);
    }
    return c;
  }

  const upsert: UpsertDocuments = async ({connection, database, collection, upserts, signal}) => {
    if (signal.aborted) throw new Error('Run interrupted.');
    let connected: MongoClient;
    try {
      connected = await client(connection);
    } catch (e) {
      throw Object.assign(new Error(`Could not connect to MongoDB: ${message(e)}`), {name: 'ConnectionError'});
    }
    const target = connected.db(database).collection(collection);
    const ops = (list: DocumentUpsert[]) => list.map(({filter, document}) => ({updateOne: {filter, update: {$set: document}, upsert: true}}));
    return upsertInRounds(upserts,
      async ({filter, document}) => {
        if (signal.aborted) throw new Error('Run interrupted.');
        const r = await target.updateOne(filter, {$set: document}, {upsert: true});
        return {matched: r.matchedCount, modified: r.modifiedCount, upsertedId: r.upsertedId};
      },
      async list => {
        if (signal.aborted) throw new Error('Run interrupted.');
        try {
          const r = await target.bulkWrite(ops(list), {ordered: false});
          return {upsertedIds: r.upsertedIds, errors: {}, modified: r.modifiedCount};
        } catch (e) {
          // some documents failed: the others were written, and the answer says which is which
          if (!(e instanceof MongoBulkWriteError)) throw e;
          const failed = Array.isArray(e.writeErrors) ? e.writeErrors : [e.writeErrors];
          return {
            upsertedIds: e.result.upsertedIds,
            errors: Object.fromEntries(failed.map(w => [w.index, w.errmsg ?? 'MongoDB did not write this document.'])),
            modified: e.result.modifiedCount,
          };
        }
      });
  };

  const aggregate: AggregateDocuments = async function* ({connection, database, collection, pipeline, timeoutMs, signal}) {
    // the component already refused $out/$merge; a source never writes, whoever calls it
    const issue = mongoPipelineIssue(pipeline);
    if (issue) throw new Error(`The pipeline ${issue}.`);
    if (signal.aborted) return;
    let connected: MongoClient;
    try {
      connected = await client(connection);
    } catch (e) {
      throw Object.assign(new Error(`Could not connect to MongoDB: ${message(e)}`), {name: 'ConnectionError'});
    }
    const stages = EJSON.deserialize(pipeline, {relaxed: true}) as Document[];
    const cursor = connected.db(database).collection(collection).aggregate(stages, {maxTimeMS: timeoutMs});
    const stop = () => void cursor.close().catch(() => undefined);
    signal.addEventListener('abort', stop, {once: true});
    try {
      for await (const doc of cursor) {
        if (signal.aborted) return;
        yield toEnvelopeValue(doc) as Record<string, unknown>;
      }
    } catch (e) {
      if (signal.aborted) return;
      throw new Error(message(e));
    } finally {
      signal.removeEventListener('abort', stop);
      await cursor.close().catch(() => undefined);
    }
  };

  /** closes the run's clients (the ones that connected) */
  async function close() {
    const open = [...clients.values()];
    clients.clear();
    await Promise.all(open.map(c => c.then(x => x.close()).catch(() => undefined)));
  }

  return {upsert, aggregate, close};
}
