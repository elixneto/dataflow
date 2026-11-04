import { appKeyring } from '../shared/config/app-keyring';
import { readAppSettings } from '../shared/config/app-settings';
import { describeDatabase } from '../shared/database/database';
import { openDatabaseOrExit } from '../shared/database/open-or-exit';
import { seedDev } from '../shared/database/seed-dev';
import { followRunEvents } from '../features/runs/run-events';
import { createApp } from './app';

const config = readAppSettings();
const db = await openDatabaseOrExit(config.databaseUrl);
if (config.environment === 'DEV') {
  await seedDev(db);
}

const keyring = appKeyring(config);
// the runs go on in the supervisor (another process): what they do reaches the editor through Postgres NOTIFY
await followRunEvents(db);
const app = createApp(db, config.environment, keyring);

console.log(`api on :${config.port} (${config.environment}, ${describeDatabase(config.databaseUrl)})`);
export default { port: config.port, fetch: app.fetch };
