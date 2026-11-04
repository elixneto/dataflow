import type { Db, MongoClient } from 'mongodb';
import { TEST_TIMEOUT_MS, type ConnectionTest, type ConnectionTestInput } from './connection-test';

/**
 * The database is in the list of the ones this user can see; when the user may not list databases, it has at least
 * one collection (in MongoDB a database without collections does not exist).
 */
async function databaseExists(client: MongoClient, db: Db, name: string): Promise<boolean> {
  try {
    const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true, authorizedDatabases: true });
    return databases.some(d => d.name === name);
  } catch {
    return (await db.listCollections({}, { nameOnly: true, batchSize: 1 }).next()) !== null;
  }
}

export class MongoDbConnectionTest implements ConnectionTest {
  constructor(private readonly timeoutMs = TEST_TIMEOUT_MS) {}

  async test({ config, secrets }: ConnectionTestInput): Promise<string> {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(secrets.connectionString ?? '', {
      serverSelectionTimeoutMS: this.timeoutMs,
      connectTimeoutMS: this.timeoutMs,
      appName: 'dataflow',
    });
    try {
      await client.connect();
      const db = client.db(config.database);
      await db.command({ ping: 1 });
      // MongoDB answers for any name (a database is only created on the first write): check it is really there
      if (!(await databaseExists(client, db, config.database ?? ''))) {
        throw new Error(`Database "${config.database}" not found.`);
      }

      const info = await db.command({ buildInfo: 1 }).catch(() => null);
      return info?.version ? `MongoDB ${info.version}` : 'MongoDB';
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}
