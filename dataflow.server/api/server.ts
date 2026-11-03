import {Hono} from 'hono';
import {readAppSettings} from '../shared/config/app-settings';
import {describeDatabase, openDatabase} from '../shared/database/database';

const config = readAppSettings();
const db = await openDatabase(config.databaseUrl);

const app = new Hono();
app.get('/health', c => c.json({ok: true, environment: config.environment}));

console.log(`api on :${config.port} (${config.environment}, ${describeDatabase(config.databaseUrl)})`);
export default {port: config.port, fetch: app.fetch};