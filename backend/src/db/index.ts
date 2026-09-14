import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { schema } from './schema.js';

let instance: Database.Database | undefined;
export function db() {
  if (!instance) {
    if (config.databasePath !== ':memory:') fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
    instance = new Database(config.databasePath);
    instance.pragma('journal_mode = WAL');
    instance.pragma('foreign_keys = ON');
    instance.exec(schema);
  }
  return instance;
}
export function closeDb() { instance?.close(); instance = undefined; }
