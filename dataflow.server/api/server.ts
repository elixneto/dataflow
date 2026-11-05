import { appKeyring } from '../shared/config/app-keyring';
import { readAppSettings } from '../shared/config/app-settings';
import { describeDatabase } from '../shared/database/database';
import { openDatabaseOrExit } from '../shared/database/open-or-exit';
import { seedDev } from '../shared/database/seed-dev';
import { createLogger } from '../shared/logging/logger';
import { followRunEvents } from '../features/runs/run-events';
import { createApp } from './app';

const config = readAppSettings();
const logger = createLogger({ service: 'api', level: config.logLevel, format: config.logFormat });
const db = await openDatabaseOrExit(config.databaseUrl);
if (config.environment === 'DEV') {
  await seedDev(db);
}

const keyring = appKeyring(config, line => logger.warn(line));
// the runs go on in the supervisor (another process): what they do reaches the editor through Postgres NOTIFY
await followRunEvents(db);
const app = createApp(db, config.environment, keyring, logger);

logger.info(`api on :${config.port}`, { port: config.port, environment: config.environment, database: describeDatabase(config.databaseUrl), logLevel: config.logLevel });
// seconds a connection may stay quiet (Bun's default, 10, closes a run's SSE stream while it waits for a worker)
export default { port: config.port, fetch: app.fetch, idleTimeout: 60 };
