import { readAppSettings } from '../shared/config/app-settings';
import { describeDatabase, openDatabase } from '../shared/database/database';
import { createApp } from './app';

const config = readAppSettings();
const db = await openDatabase(config.databaseUrl);
const app = createApp(db, config.environment);

console.log(`api on :${config.port} (${config.environment}, ${describeDatabase(config.databaseUrl)})`);
export default { port: config.port, fetch: app.fetch };
