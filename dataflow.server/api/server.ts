import { readAppSettings } from '../shared/config/app-settings';
import { DEV_KEY, Keyring } from '../shared/crypto/keyring';
import { describeDatabase, openDatabase } from '../shared/database/database';
import { seedDev } from '../shared/database/seed-dev';
import { createApp } from './app';

const config = readAppSettings();
const db = await openDatabase(config.databaseUrl);
if (config.environment === 'DEV') {
  await seedDev(db);
}

// secrets: SECRETS_KEYS, or in DEV only a fixed key (keyring.ts) so nobody needs setup to develop
if (config.secretsKeys.length === 0 && config.environment !== 'DEV') {
  throw new Error('SECRETS_KEYS is required outside DEV (see .env.example).');
}

if (config.secretsKeys.length === 0) {
  console.warn('SECRETS_KEYS is not set: using the DEV key. Never store real secrets this way.');
}

const keyring = new Keyring(config.secretsKeys.length > 0 ? config.secretsKeys : [DEV_KEY]);
const app = createApp(db, config.environment, keyring);

console.log(`api on :${config.port} (${config.environment}, ${describeDatabase(config.databaseUrl)})`);
export default { port: config.port, fetch: app.fetch };
