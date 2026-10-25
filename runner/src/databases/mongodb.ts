import {BSON, MongoClient, type Document} from 'mongodb';
import {mongoPipelineIssue, type AggregateDocuments, type DocumentUpsert, type UpsertDocuments, type UpsertResult} from '@dataflow/core';

/*
 * MongoDB Upsert: `updateOne(filter, {$set: document}, {upsert: true})` per document with the official driver, so each
 * envelope gets its own answer: matched, modified and the id of an inserted document (bulkWrite only answers totals
 * per batch). The documents of a batch go at the same time (the driver's pool limits how many are in flight), except
 * the ones with the same filter: those go one after the other, in arrival order (see `upsertInOrder`).
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
 * A value that fits in the envelope (JSON), like the SQL Server Query does: ObjectId as its hex text, a date as ISO,
 * Decimal128 as text (it keeps every digit), Long as a number (as text past 2^53), binary as base64. Other BSON types
 * (Timestamp, MinKey...) as their relaxed Extended JSON.
 */
export function toEnvelopeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
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

/**
 * Runs the upserts of a batch: the ones with the same filter (same fields and values) one after the other, in arrival
 * order, so the last one wins; the others at the same time. Sent together, two upserts of the same filter have no
 * order (when their data differs, either one may be the final document), and with a filter that is not a unique
 * index both may insert. The results come back in the order of `upserts`; one that fails does not stop the next one
 * of its filter.
 */
export function upsertInOrder(upserts: DocumentUpsert[], write: (upsert: DocumentUpsert) => Promise<UpsertResult>): Promise<UpsertResult[]> {
  const last = new Map<string, Promise<unknown>>();
  return Promise.all(upserts.map(upsert => {
    const key = JSON.stringify(upsert.filter);
    const result = (last.get(key) ?? Promise.resolve())
      .then(() => write(upsert))
      .catch((e: unknown): UpsertResult => ({error: message(e)}));
    last.set(key, result);
    return result;
  }));
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
    return upsertInOrder(upserts, async ({filter, document}) => {
      if (signal.aborted) return {error: 'Run interrupted.'};
      const r = await target.updateOne(filter, {$set: document}, {upsert: true});
      return {matched: r.matchedCount, modified: r.modifiedCount, upsertedId: idText(r.upsertedId)};
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
