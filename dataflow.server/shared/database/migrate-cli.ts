import {readAppSettings} from '../config/app-settings';
import {describeDatabase, openDatabase} from './database';

// `bun run migrate`: brings the database up to date and exits (the api and the worker also migrate on start).
const {databaseUrl} = readAppSettings();
const db = await openDatabase(databaseUrl);
await db.close();
console.log(`Schema up to date (${describeDatabase(databaseUrl)}).`);
