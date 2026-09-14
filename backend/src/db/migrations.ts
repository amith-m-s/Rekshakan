import { schema } from "./schema.js";

export const migrations = [
  { id: "001_initial_schema", sql: schema },
  {
    id: "002_idempotent_shelter_checkins",
    sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_one_checkin_per_request ON shelter_checkins(request_id) WHERE request_id IS NOT NULL;",
  },
] as const;
