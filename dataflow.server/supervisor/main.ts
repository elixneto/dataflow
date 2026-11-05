import { appKeyring } from '../shared/config/app-keyring';
import { readAppSettings } from '../shared/config/app-settings';
import { describeDatabase } from '../shared/database/database';
import { openDatabaseOrExit } from '../shared/database/open-or-exit';
import { createLogger } from '../shared/logging/logger';
import { Supervisor } from './supervisor';
import { processPool } from './workers/process-pool';

/*
 * The supervisor process (`bun run dev` starts it beside the api): WORKERS worker processes run the queued runs of
 * WORKER_TAGS. One event per run here (its flow, status, times, envelopes...); what a run writes goes to its record only.
 */

const config = readAppSettings();
const logger = createLogger({ service: 'supervisor', level: config.logLevel, format: config.logFormat });
const db = await openDatabaseOrExit(config.databaseUrl);
const supervisor = new Supervisor({ db, keyring: appKeyring(config, line => logger.warn(line)), executor: processPool({ size: config.workers }), tags: config.workerTags, logger });
await supervisor.start();
logger.info(`supervisor ${supervisor.id}: ${config.workers} worker(s), tags ${config.workerTags.join(', ')}`, {
  supervisorId: supervisor.id, workers: config.workers, tags: config.workerTags.join(','), database: describeDatabase(config.databaseUrl), logLevel: config.logLevel,
});

let stopping = false;
async function stop() {
  if (stopping) {
    return;
  }

  stopping = true;
  logger.info('supervisor stopping', { supervisorId: supervisor.id, running: supervisor.running.length });
  await supervisor.stop().catch(error => logger.error('supervisor did not stop cleanly', { error }));
  await db.close();
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGBREAK', stop);
