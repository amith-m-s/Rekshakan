import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config/index.js";
import { migrations } from "./migrations.js";

let instance: Database.Database | undefined;
export function db() {
  if (!instance) {
    if (config.databasePath !== ":memory:")
      fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
    instance = new Database(config.databasePath);
    instance.pragma("journal_mode = WAL");
    instance.pragma("foreign_keys = ON");
    instance.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    const applied = new Set(
      (
        instance.prepare("SELECT id FROM schema_migrations").all() as Array<{
          id: string;
        }>
      ).map((row) => row.id),
    );
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      instance.transaction(() => {
        instance!.exec(migration.sql);
        instance!
          .prepare("INSERT INTO schema_migrations(id,applied_at) VALUES(?,?)")
          .run(migration.id, new Date().toISOString());
      })();
    }
  }
  return instance;
}
export function closeDb() {
  instance?.close();
  instance = undefined;
}
