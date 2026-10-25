import {MongoClient} from 'mongodb';
import type {UpsertDocuments, UpsertResult} from '@dataflow/core';

/*
 * MongoDB Upsert: `updateOne(filter, {$set: document}, {upsert: true})` per document with the official driver.
 * The documents of a batch go at the same time (the driver's pool limits how many are in flight), so each envelope gets
 * its own answer: matched, modified and the id of an inserted document (bulkWrite only answers totals per batch).
 * One client per connection string per run: `mongoDriver()` is created for a run and `close()` at its end.
 */

/** A message without the connection string (the driver may put the host in it, never the password). */
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The id MongoDB generated (ObjectId) or took from the filter, as text. */
const idText = (id: unknown) => (id === null || id === undefined ? null : String(id));

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
    return Promise.all(upserts.map(async ({filter, document}): Promise<UpsertResult> => {
      if (signal.aborted) return {error: 'Run interrupted.'};
      try {
        const r = await target.updateOne(filter, {$set: document}, {upsert: true});
        return {matched: r.matchedCount, modified: r.modifiedCount, upsertedId: idText(r.upsertedId)};
      } catch (e) {
        return {error: message(e)};
      }
    }));
  };

  /** closes the run's clients (the ones that connected) */
  async function close() {
    const open = [...clients.values()];
    clients.clear();
    await Promise.all(open.map(c => c.then(x => x.close()).catch(() => undefined)));
  }

  return {upsert, close};
}
