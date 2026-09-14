import { db } from "../db/index.js";
import { id, now } from "../utils/core.js";
export function audit(
  action: string,
  context: {
    incidentId?: string;
    requestId?: string;
    assignmentId?: string;
    actorId?: string;
    previousState?: string;
    newState?: string;
    latitude?: number;
    longitude?: number;
    metadata?: unknown;
  } = {},
) {
  const event = { id: id("aud"), created_at: now() };
  db()
    .prepare(
      `INSERT INTO audit_logs(id,incident_id,request_id,assignment_id,actor_id,action,previous_state,new_state,latitude,longitude,metadata,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      event.id,
      context.incidentId || null,
      context.requestId || null,
      context.assignmentId || null,
      context.actorId || null,
      action,
      context.previousState || null,
      context.newState || null,
      context.latitude ?? null,
      context.longitude ?? null,
      JSON.stringify(context.metadata || {}),
      event.created_at,
    );
  return event;
}
