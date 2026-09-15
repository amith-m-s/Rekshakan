import { config } from "../config/index.js";
import { db } from "../db/index.js";
import { haversineKm, id, now, parseJson } from "../utils/core.js";
import { audit } from "./audit.js";
import {
  assertTransition,
  calculatePriority,
  calculateSeverity,
  escalationRecommendation,
  rankResponders,
} from "./engines.js";
import { emitOperational, emitToRoles, emitToUsers } from "./runtime.js";

const closedRequestStatuses = "('SAFE','CLOSED','CANCELLED')";

export function notify(
  userId: string | null,
  incidentId: string | null,
  type: string,
  title: string,
  body: string,
  dedupeKey?: string,
) {
  const notification = {
    id: id("not"),
    user_id: userId,
    incident_id: incidentId,
    type,
    title,
    body,
    channel: "IN_APP",
    dedupe_key: dedupeKey || null,
    created_at: now(),
  };
  try {
    db()
      .prepare(
        "INSERT INTO notifications(id,user_id,incident_id,type,title,body,channel,dedupe_key,created_at) VALUES(@id,@user_id,@incident_id,@type,@title,@body,@channel,@dedupe_key,@created_at)",
      )
      .run(notification);
    userId
      ? emitToUsers("notification.created", notification, [userId])
      : emitToRoles("notification.created", notification);
    return notification;
  } catch (error: any) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return null;
    throw error;
  }
}

export function createHelpRequest(userId: string, body: any) {
  if (body.clientRequestId) {
    const existing = db()
      .prepare(
        "SELECT * FROM help_requests WHERE resident_id=? AND client_request_id=?",
      )
      .get(userId, body.clientRequestId);
    if (existing) return existing;
  }
  let incident = body.incidentId
    ? (db()
        .prepare("SELECT * FROM incidents WHERE id=?")
        .get(body.incidentId) as any)
    : null;
  if (!incident && !body.incidentId) {
    const active = db()
      .prepare(
        "SELECT * FROM incidents WHERE status IN ('DETECTED','ACTIVE') ORDER BY updated_at DESC",
      )
      .all() as any[];
    incident =
      active.find((candidate) => haversineKm(body, candidate) <= 3) ?? null;
  }
  if (!incident && !body.incidentId) {
    const timestamp = now();
    incident = {
      id: id("inc"),
      disaster_type:
        body.category === "MEDICAL"
          ? "MEDICAL_EMERGENCY"
          : "COMMUNITY_EMERGENCY",
      name: "Assistance event",
      description:
        "Created automatically from a verified resident assistance request",
      latitude: body.latitude,
      longitude: body.longitude,
      radius_km: 3,
      boundary_json: null,
      spread_direction: null,
      spread_speed: 0,
      start_time: timestamp,
      status: "ACTIVE",
      severity_score: 0,
      severity_level: "LOW",
      severity_factors: "{}",
      severity_reasons: "[]",
      source_type: "COMMUNITY",
      created_at: timestamp,
      updated_at: timestamp,
    };
    db()
      .prepare(
        `INSERT INTO incidents(id,disaster_type,name,description,latitude,longitude,radius_km,boundary_json,spread_direction,spread_speed,start_time,status,severity_score,severity_level,severity_factors,severity_reasons,source_type,created_at,updated_at)
       VALUES(@id,@disaster_type,@name,@description,@latitude,@longitude,@radius_km,@boundary_json,@spread_direction,@spread_speed,@start_time,@status,@severity_score,@severity_level,@severity_factors,@severity_reasons,@source_type,@created_at,@updated_at)`,
      )
      .run(incident);
    audit("INCIDENT_CREATED_FROM_HELP_REQUEST", {
      incidentId: incident.id,
      actorId: userId,
      newState: "ACTIVE",
      latitude: body.latitude,
      longitude: body.longitude,
    });
    emitOperational("incident.created", incident, [userId]);
  }
  if (!incident)
    throw Object.assign(new Error("Incident not found"), { status: 404 });
  body.incidentId = incident.id;
  const available = (
    db()
      .prepare(
        "SELECT count(*) n FROM responders WHERE availability=1 AND status='AVAILABLE'",
      )
      .get() as any
  ).n;
  const priority = calculatePriority({
    medicalEmergency: body.medicalEmergency,
    vulnerabilities: body.vulnerabilities,
    immediateDanger: body.immediateDanger,
    peopleCount: body.peopleCount,
    distanceToDangerKm: haversineKm(body, incident),
    incidentSeverity: incident.severity_score,
    availableResponders: available,
  });
  const request = {
    id: id("req"),
    client_request_id: body.clientRequestId || null,
    resident_id: userId,
    incident_id: body.incidentId,
    latitude: body.latitude,
    longitude: body.longitude,
    category: body.category,
    description: body.description || null,
    people_count: body.peopleCount || 1,
    medical_emergency: body.medicalEmergency ? 1 : 0,
    vulnerabilities: JSON.stringify(body.vulnerabilities || []),
    immediate_danger: body.immediateDanger ? 1 : 0,
    priority_score: priority.score,
    priority_level: priority.level,
    priority_reasons: JSON.stringify(priority.reasons),
    status: "REQUESTED",
    created_at: now(),
    updated_at: now(),
  };
  try {
    db().transaction(() => {
      db()
        .prepare(
          "INSERT INTO help_requests VALUES(@id,@client_request_id,@resident_id,@incident_id,@latitude,@longitude,@category,@description,@people_count,@medical_emergency,@vulnerabilities,@immediate_danger,@priority_score,@priority_level,@priority_reasons,@status,@created_at,@updated_at)",
        )
        .run(request);
      db()
        .prepare(
          "UPDATE users SET operational_status='NEEDS_HELP',updated_at=? WHERE id=?",
        )
        .run(now(), userId);
    })();
  } catch (error: any) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE")
      return db()
        .prepare(
          "SELECT * FROM help_requests WHERE resident_id=? AND client_request_id=?",
        )
        .get(userId, body.clientRequestId);
    throw error;
  }
  audit("HELP_REQUEST_CREATED", {
    incidentId: request.incident_id,
    requestId: request.id,
    actorId: userId,
    newState: "REQUESTED",
    latitude: request.latitude,
    longitude: request.longitude,
    metadata: { priority },
  });
  emitOperational("help_request.created", request, [userId]);
  recomputeSeverity(request.incident_id, {}, userId);
  return db().prepare("SELECT * FROM help_requests WHERE id=?").get(request.id);
}

export function recomputePrioritiesForIncident(incidentId: string) {
  const incident = db()
    .prepare(
      "SELECT latitude,longitude,severity_score FROM incidents WHERE id=?",
    )
    .get(incidentId) as any;
  if (!incident) return [];
  const available = (
    db()
      .prepare(
        "SELECT count(*) n FROM responders WHERE availability=1 AND status='AVAILABLE'",
      )
      .get() as any
  ).n;
  const requests = db()
    .prepare(
      `SELECT * FROM help_requests WHERE incident_id=? AND status NOT IN ${closedRequestStatuses}`,
    )
    .all(incidentId) as any[];
  const changes = [];
  for (const request of requests) {
    const priority = calculatePriority({
      medicalEmergency: !!request.medical_emergency,
      vulnerabilities: parseJson(request.vulnerabilities, []),
      immediateDanger: !!request.immediate_danger,
      peopleCount: request.people_count,
      distanceToDangerKm: haversineKm(request, incident),
      incidentSeverity: incident.severity_score,
      requestAgeMinutes:
        (Date.now() - new Date(request.created_at).getTime()) / 60_000,
      availableResponders: available,
    });
    if (
      priority.score === request.priority_score &&
      priority.level === request.priority_level
    )
      continue;
    db()
      .prepare(
        "UPDATE help_requests SET priority_score=?,priority_level=?,priority_reasons=?,updated_at=? WHERE id=?",
      )
      .run(
        priority.score,
        priority.level,
        JSON.stringify(priority.reasons),
        now(),
        request.id,
      );
    audit("PRIORITY_CHANGED", {
      incidentId,
      requestId: request.id,
      previousState: String(request.priority_score),
      newState: String(priority.score),
      metadata: priority,
    });
    const event = {
      requestId: request.id,
      residentId: request.resident_id,
      ...priority,
    };
    emitOperational("help_request.priority_changed", event, [
      request.resident_id,
    ]);
    changes.push(event);
  }
  return changes;
}

export function recomputeSeverity(
  incidentId: string,
  overrides: Record<string, number> = {},
  actorId?: string,
) {
  const incident = db()
    .prepare("SELECT * FROM incidents WHERE id=?")
    .get(incidentId) as any;
  if (!incident)
    throw Object.assign(new Error("Incident not found"), { status: 404 });
  const counts = db()
    .prepare(
      `SELECT count(*) total,sum(medical_emergency) medical FROM help_requests WHERE incident_id=? AND status NOT IN ${closedRequestStatuses}`,
    )
    .get(incidentId) as any;
  const available = (
    db()
      .prepare(
        "SELECT count(*) n FROM responders WHERE availability=1 AND status='AVAILABLE'",
      )
      .get() as any
  ).n;
  const current = parseJson(
    incident.severity_factors,
    {} as Record<string, number>,
  );
  const result = calculateSeverity(
    {
      ...current,
      requests: Math.min(100, counts.total * 12),
      vulnerable: Math.min(100, (counts.medical || 0) * 25),
      responderGap: Math.min(100, Math.max(0, counts.total - available) * 20),
      ...overrides,
    },
    incident.severity_score,
  );
  db()
    .prepare(
      "UPDATE incidents SET severity_score=?,severity_level=?,severity_factors=?,severity_reasons=?,updated_at=? WHERE id=?",
    )
    .run(
      result.score,
      result.level,
      JSON.stringify(result.factors),
      JSON.stringify(result.reasons),
      now(),
      incidentId,
    );
  if (result.score !== incident.severity_score) {
    audit("INCIDENT_SEVERITY_CHANGED", {
      incidentId,
      actorId,
      previousState: String(incident.severity_score),
      newState: String(result.score),
      metadata: result,
    });
    emitToRoles("incident.severity_changed", { incidentId, ...result });
    createGeofenceAlerts(incidentId, result.level);
  }
  recomputePrioritiesForIncident(incidentId);
  return result;
}

export function createGeofenceAlerts(incidentId: string, level: string) {
  const incident = db()
    .prepare("SELECT * FROM incidents WHERE id=?")
    .get(incidentId) as any;
  const radius = config.alertRadiiKm[level] || incident.radius_km;
  const users = db()
    .prepare(
      "SELECT u.id,u.name,l.latitude,l.longitude FROM users u JOIN locations l ON l.id=(SELECT id FROM locations WHERE user_id=u.id ORDER BY recorded_at DESC LIMIT 1) WHERE u.alerts_opt_in=1 AND l.sharing_state='SHARED'",
    )
    .all() as any[];
  return users
    .filter((user) => haversineKm(incident, user) <= radius)
    .map((user) =>
      notify(
        user.id,
        incidentId,
        "INCIDENT_ALERT",
        `${level} ${incident.disaster_type} alert`,
        `${incident.name} is within ${radius} km. Follow authorized safety guidance.`,
        `alert:${incidentId}:${user.id}:${level}`,
      ),
    )
    .filter(Boolean);
}

export function getMatches(requestId: string) {
  const request = db()
    .prepare("SELECT * FROM help_requests WHERE id=?")
    .get(requestId) as any;
  if (!request)
    throw Object.assign(new Error("Help request not found"), { status: 404 });
  const responders = db()
    .prepare(
      "SELECT r.*,l.latitude,l.longitude FROM responders r JOIN locations l ON l.id=(SELECT id FROM locations WHERE user_id=r.user_id ORDER BY recorded_at DESC LIMIT 1)",
    )
    .all() as any[];
  const matches = rankResponders(request, responders);
  audit("RESPONDER_MATCHED", {
    incidentId: request.incident_id,
    requestId,
    metadata: { matches: matches.map((match) => match.responderId) },
  });
  return matches;
}

export function transitionAssignment(
  assignmentId: string,
  to: string,
  actorId: string,
  reason?: string,
) {
  const assignment = db()
    .prepare(
      "SELECT a.*,h.incident_id,h.resident_id,r.user_id responder_user_id FROM assignments a JOIN help_requests h ON h.id=a.request_id JOIN responders r ON r.id=a.responder_id WHERE a.id=?",
    )
    .get(assignmentId) as any;
  if (!assignment)
    throw Object.assign(new Error("Assignment not found"), { status: 404 });
  assertTransition(assignment.status, to);
  const timestamp = now();
  const responderStates: Record<string, [number, string]> = {
    ACCEPTED: [0, "ON_ASSIGNMENT"],
    EN_ROUTE: [0, "EN_ROUTE"],
    ARRIVED: [0, "ON_ASSIGNMENT"],
    ASSISTING: [0, "ON_ASSIGNMENT"],
    EVACUATED: [0, "ON_ASSIGNMENT"],
    SHELTER_CHECKIN: [0, "ON_ASSIGNMENT"],
    SAFE: [0, "ON_ASSIGNMENT"],
    CLOSED: [1, "AVAILABLE"],
    CANCELLED: [1, "AVAILABLE"],
    REJECTED: [1, "AVAILABLE"],
    REASSIGNED: [1, "AVAILABLE"],
    FAILED: [0, "UNAVAILABLE"],
  };
  const [available, responderStatus] = responderStates[to] || [0, "BUSY"];
  db().transaction(() => {
    db()
      .prepare(
        "UPDATE assignments SET status=?,rejection_reason=CASE WHEN ?='REJECTED' THEN ? ELSE rejection_reason END,failure_reason=CASE WHEN ?='FAILED' THEN ? ELSE failure_reason END,accepted_at=CASE WHEN ?='ACCEPTED' THEN ? ELSE accepted_at END,completed_at=CASE WHEN ? IN ('COMPLETED','CLOSED') THEN ? ELSE completed_at END,updated_at=? WHERE id=?",
      )
      .run(
        to,
        to,
        reason || null,
        to,
        reason || null,
        to,
        timestamp,
        to,
        timestamp,
        timestamp,
        assignmentId,
      );
    const requestStatus = ["REJECTED", "FAILED", "REASSIGNED"].includes(to)
      ? "REASSIGNED"
      : to;
    db()
      .prepare("UPDATE help_requests SET status=?,updated_at=? WHERE id=?")
      .run(requestStatus, timestamp, assignment.request_id);
    db()
      .prepare(
        "UPDATE responders SET availability=?,status=?,current_assignment_id=CASE WHEN ? IN ('CLOSED','CANCELLED','REJECTED','REASSIGNED','FAILED') THEN NULL ELSE current_assignment_id END,updated_at=? WHERE id=?",
      )
      .run(available, responderStatus, to, timestamp, assignment.responder_id);
    if (to === "SAFE")
      db()
        .prepare(
          "UPDATE users SET operational_status='SAFE',updated_at=? WHERE id=?",
        )
        .run(timestamp, assignment.resident_id);
  })();
  const actions: Record<string, string> = {
    ACCEPTED: "ASSIGNMENT_ACCEPTED",
    EN_ROUTE: "RESPONDER_EN_ROUTE",
    ARRIVED: "RESPONDER_ARRIVED",
    ASSISTING: "ASSISTANCE_STARTED",
    EVACUATED: "PERSON_EVACUATED",
    SHELTER_CHECKIN: "SHELTER_CHECKIN",
    SAFE: "PERSON_SAFE",
    CLOSED: "CASE_CLOSED",
  };
  audit(actions[to] || `ASSIGNMENT_${to}`, {
    incidentId: assignment.incident_id,
    requestId: assignment.request_id,
    assignmentId,
    actorId,
    previousState: assignment.status,
    newState: to,
    metadata: { reason },
  });
  emitOperational(
    "assignment.status_changed",
    { assignmentId, status: to, requestId: assignment.request_id },
    [assignment.resident_id, assignment.responder_user_id],
  );
  notify(
    assignment.resident_id,
    assignment.incident_id,
    "ASSIGNMENT_UPDATE",
    "Assistance update",
    `Your assistance request is now ${to}.`,
  );
  recomputeSeverity(assignment.incident_id, {}, actorId);
  return db().prepare("SELECT * FROM assignments WHERE id=?").get(assignmentId);
}

export function recommendEscalation(incidentId: string) {
  const incident = db()
    .prepare("SELECT * FROM incidents WHERE id=?")
    .get(incidentId) as any;
  if (!incident)
    throw Object.assign(new Error("Incident not found"), { status: 404 });
  const stats = db()
    .prepare(
      `SELECT count(*) unresolved,sum(medical_emergency) medical FROM help_requests WHERE incident_id=? AND status NOT IN ${closedRequestStatuses}`,
    )
    .get(incidentId) as any;
  const responders = (
    db()
      .prepare("SELECT count(*) n FROM responders WHERE availability=1")
      .get() as any
  ).n;
  const blocked = (
    db()
      .prepare(
        "SELECT count(*) n FROM community_reports WHERE incident_id=? AND category='BLOCKED_ROAD' AND verification_status='VERIFIED'",
      )
      .get(incidentId) as any
  ).n;
  const shelter = db()
    .prepare(
      "SELECT coalesce(sum(occupancy)*1.0/nullif(sum(capacity),0),0) util FROM shelters WHERE incident_id=?",
    )
    .get(incidentId) as any;
  const oldest = db()
    .prepare(
      `SELECT min(created_at) created_at FROM help_requests WHERE incident_id=? AND status NOT IN ${closedRequestStatuses}`,
    )
    .get(incidentId) as any;
  const delayMinutes = oldest?.created_at
    ? Math.max(0, (Date.now() - new Date(oldest.created_at).getTime()) / 60_000)
    : 0;
  return escalationRecommendation({
    severity: incident.severity_score,
    unresolved: stats.unresolved,
    responders,
    medical: stats.medical || 0,
    delayMinutes,
    blockedRoutes: blocked,
    shelterUtilization: shelter.util,
  });
}
