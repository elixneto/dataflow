import type { AggregateDocuments, DeleteDocuments, UpsertDocuments, UpsertResult } from '@dataflow/core';
import type { Document, MongoClient } from 'mongodb';

/*
 * MongoDB's drivers, in the worker (the official driver): Pipeline's aggregation read through the cursor (the next batch
 * only when the flow asks), Upsert's batches as one unordered bulk write (one result per upsert, a failed one does not
 * stop the others), Delete's deleteMany (or only a count, in a test run). What the components send may use Extended JSON
 * ({$oid}, {$date}); what comes back is plain JSON: ids as text, dates as ISO text. A client per connection string, kept
 * by this worker.
 */

const KEPT_CLIENTS = 8;
const clients = new Map<string, Promise<MongoClient>>();

async function clientOf(connection: string): Promise<MongoClient> {
  const known = clients.get(connection);
  if (known) {
    clients.delete(connection);
    clients.set(connection, known);
    return known;
  }

  const { MongoClient } = await import('mongodb');
  const connected = new MongoClient(connection, { appName: 'dataflow', serverSelectionTimeoutMS: 15_000 }).connect().catch(e => {
    clients.delete(connection);
    throw e;
  });
  clients.set(connection, connected);
  if (clients.size > KEPT_CLIENTS) {
    const [oldest, gone] = clients.entries().next().value!;
    clients.delete(oldest);
    void gone.then(c => c.close()).catch(() => undefined);
  }

  return connected;
}

/** closes this worker's clients (when it stops) */
export async function closeMongoClients() {
  const all = [...clients.values()];
  clients.clear();
  await Promise.all(all.map(c => c.then(client => client.close()).catch(() => undefined)));
}

/** what a component sent, with its Extended JSON ({$oid}, {$date}...) as BSON values */
async function fromExtendedJson<T>(value: T): Promise<T> {
  const { BSON } = await import('mongodb');
  return BSON.EJSON.deserialize(value as Document, { relaxed: true }) as T;
}

/** a value from the database as plain JSON: ids and decimals as text, dates as ISO text, binary as base64 */
export function plainJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? Number(value) : value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(plainJson);
  }

  const bson = (value as { _bsontype?: string })._bsontype;
  switch (bson) {
    case 'ObjectId':
    case 'ObjectID':
      return (value as { toHexString(): string }).toHexString();
    case 'Decimal128':
    case 'UUID':
      return String(value);
    case 'Long':
    case 'Int32':
    case 'Double':
      return Number(value);
    case 'Binary':
      return (value as { toString(encoding: string): string }).toString('base64');
    case 'Timestamp':
      return (value as { toString(): string }).toString();
    default:
      break;
  }

  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plainJson(v)]));
}

export const aggregateMongoDb: AggregateDocuments = async function* ({ connection, database, collection, pipeline, timeoutMs, signal }) {
  if (signal.aborted) {
    return;
  }

  const client = await clientOf(connection);
  const cursor = client
    .db(database)
    .collection(collection)
    .aggregate(await fromExtendedJson(pipeline), { maxTimeMS: timeoutMs });
  const close = () => void cursor.close().catch(() => undefined);
  signal.addEventListener('abort', close, { once: true });
  try {
    for await (const doc of cursor) {
      if (signal.aborted) {
        return;
      }

      yield plainJson(doc) as Record<string, unknown>;
    }
  } finally {
    signal.removeEventListener('abort', close);
    await cursor.close().catch(() => undefined);
  }
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const upsertMongoDb: UpsertDocuments = async ({ connection, database, collection, upserts, signal }) => {
  if (signal.aborted) {
    throw Object.assign(new Error('Run stopped.'), { name: 'AbortError' });
  }

  const target = (await clientOf(connection)).db(database).collection(collection);
  const operations = await Promise.all(
    upserts.map(async u => ({ updateOne: { filter: await fromExtendedJson(u.filter), update: { $set: await fromExtendedJson(u.document) }, upsert: true } })),
  );
  // one on its own: whether it changed the document is known
  if (operations.length === 1) {
    const { filter, update } = operations[0]!.updateOne;
    try {
      const r = await target.updateOne(filter, update, { upsert: true });
      return {
        results: [{ matched: r.matchedCount, upsertedId: r.upsertedId ? String(plainJson(r.upsertedId)) : null, modified: r.modifiedCount }],
        modified: r.modifiedCount,
      };
    } catch (e) {
      if ((e as { code?: unknown }).code !== undefined) {
        return { results: [{ error: message(e) }], modified: 0 };
      }

      throw e;
    }
  }

  type BulkResult = { upsertedIds: Record<number, unknown>; modifiedCount: number };
  let result: BulkResult;
  const failed = new Map<number, string>();
  try {
    result = (await target.bulkWrite(operations, { ordered: false })) as unknown as BulkResult;
  } catch (e) {
    // some failed: the others went through, each one says how it went
    const bulk = e as { result?: BulkResult; writeErrors?: { index: number; errmsg?: string }[] | { index: number; errmsg?: string } };
    if (!bulk.result) {
      throw e;
    }

    result = bulk.result;
    const errors = Array.isArray(bulk.writeErrors) ? bulk.writeErrors : bulk.writeErrors ? [bulk.writeErrors] : [];
    for (const w of errors) {
      failed.set(w.index, w.errmsg ?? 'Write failed.');
    }
  }

  const results: UpsertResult[] = upserts.map((_, i) => {
    if (failed.has(i)) {
      return { error: failed.get(i)! };
    }

    const upserted = result.upsertedIds?.[i];
    return upserted !== undefined ? { matched: 0, upsertedId: String(plainJson(upserted)) } : { matched: 1, upsertedId: null };
  });
  return { results, modified: result.modifiedCount ?? 0 };
};

export const deleteMongoDb: DeleteDocuments = async ({ connection, database, collection, filter, countOnly, signal }) => {
  if (signal.aborted) {
    throw Object.assign(new Error('Run stopped.'), { name: 'AbortError' });
  }

  const target = (await clientOf(connection)).db(database).collection(collection);
  const query = await fromExtendedJson(filter);
  return countOnly ? target.countDocuments(query) : (await target.deleteMany(query)).deletedCount;
};
