import { schema } from "./schema.js";

export const migrations = [
  { id: "001_initial_schema", sql: schema },
  {
    id: "002_idempotent_shelter_checkins",
    sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_one_checkin_per_request ON shelter_checkins(request_id) WHERE request_id IS NOT NULL;",
  },
  {
    // Move the deployed demo to an event-driven starting state exactly once.
    // Accounts and responder profiles remain available for role-based login.
    id: "003_empty_operational_start",
    sql: `
      DELETE FROM shelter_checkins;
      DELETE FROM audit_logs;
      DELETE FROM fraud_cases;
      DELETE FROM assignments;
      DELETE FROM safe_checkins;
      DELETE FROM escalations;
      DELETE FROM notifications;
      DELETE FROM community_reports;
      DELETE FROM locations;
      DELETE FROM incident_data;
      DELETE FROM simulator_state;
      DELETE FROM shelters;
      DELETE FROM help_requests;
      UPDATE responders SET availability=0,current_incident_id=NULL,current_assignment_id=NULL,status='OFFLINE';
      DELETE FROM incidents;
      UPDATE users SET operational_status='UNCONFIRMED';
    `,
  },
  {
    id: "004_community_incident_radius",
    sql: "UPDATE incidents SET radius_km=3,updated_at=datetime('now') WHERE source_type='COMMUNITY' AND status IN ('DETECTED','ACTIVE');",
  },
  {
    id: "005_neutral_community_event_name",
    sql: "UPDATE incidents SET name='Assistance event',updated_at=datetime('now') WHERE source_type='COMMUNITY' AND status IN ('DETECTED','ACTIVE');",
  },
] as const;
