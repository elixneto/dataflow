import { appKeyring } from '../shared/config/app-keyring';
import { readAppSettings } from '../shared/config/app-settings';
import { describeDatabase } from '../shared/database/database';
import { openDatabaseOrExit } from '../shared/database/open-or-exit';
import { Supervisor } from './supervisor';
import { processPool } from './workers/process-pool';

/*
 * The supervisor process (`bun run dev` starts it beside the api): WORKERS worker processes run the queued runs of
 * WORKER_TAGS. One line per run here; what a run writes goes to its record only.
 */

const config = readAppSettings();
const db = await openDatabaseOrExit(config.databaseUrl);
const supervisor = new Supervisor({ db, keyring: appKeyring(config), executor: processPool({ size: config.workers }), tags: config.workerTags });
await supervisor.start();
console.log(`supervisor ${supervisor.id}: ${config.workers} worker(s), tags ${config.workerTags.join(', ')} (${describeDatabase(config.databaseUrl)})`);

let stopping = false;
async function stop() {
  if (stopping) {
    return;
  }

  stopping = true;
  await supervisor.stop().catch(error => console.error(error));
  await db.close();
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGBREAK', stop);
