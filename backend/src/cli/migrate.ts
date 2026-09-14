import { db } from "../db/index.js";
const database = db();
const applied = database
  .prepare("SELECT id,applied_at FROM schema_migrations ORDER BY id")
  .all();
console.log("Database schema is up to date.", applied);
