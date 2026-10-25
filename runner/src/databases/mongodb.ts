import {MongoClient} from 'mongodb';
import type {DocumentUpsert, UpsertDocuments, UpsertResult} from '@dataflow/core';

/*
 * MongoDB Upsert: `updateOne(filter, {$set: document}, {upsert: true})` per document with the official driver, so each
 * envelope gets its own answer: matched, modified and the id of an inserted document (bulkWrite only answers totals
 * per batch). The documents of a batch go at the same time (the driver's pool limits how many are in flight), except
 * the ones with the same filter: those go one after the other, in arrival order (see `upsertInOrder`).
 * One client per connection string per run: `mongoDriver()` is created for a run and `close()` at its end.
 */

/** A message without the connection string (the driver may put the host in it, never the password). */
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The id MongoDB generated (ObjectId) or took from the filter, as text. */
const idText = (id: unknown) => (id === null || id === undefined ? null : String(id));

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

  /** closes the run's clients (the ones that connected) */
  async function close() {
    const open = [...clients.values()];
    clients.clear();
    await Promise.all(open.map(c => c.then(x => x.close()).catch(() => undefined)));
  }

  return {upsert, close};
}
