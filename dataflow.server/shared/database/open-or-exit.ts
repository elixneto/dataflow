import { DatabaseUnavailableError, openDatabase, type Database } from './database';

/** Opens the database for a process that cannot do without it (the api, the supervisor): when there is none, one clear line on what to do and exit. */
export async function openDatabaseOrExit(url: string | undefined): Promise<Database> {
  try {
    return await openDatabase(url);
  } catch (e) {
    if (e instanceof DatabaseUnavailableError) {
      console.error(e.message);
      process.exit(1);
    }

    throw e;
  }
}
