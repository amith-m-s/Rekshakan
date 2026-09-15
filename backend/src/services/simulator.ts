import bcrypt from "bcryptjs";
import { db } from "../db/index.js";
import { providers } from "../integrations/providers/index.js";
import { audit } from "./audit.js";
import {
  createHelpRequest,
  createGeofenceAlerts,
  recomputeSeverity,
} from "./operations.js";
import { emitToRoles } from "./runtime.js";
import { id, now } from "../utils/core.js";
import { DEMO_GEOGRAPHY } from "../config/geography.js";

export type SimulatorConfig = {
  latitude: number;
  longitude: number;
  initialRadius: number;
  spreadSpeed: number;
  spreadDirection: number;
  severity: number;
  simulatedPopulation: number;
  windSpeed: number;
  windDirection: number;
  temperature: number;
  humidity: number;
  reports: number;
  responders: number;
};
const defaults: SimulatorConfig = {
  latitude: DEMO_GEOGRAPHY.simulator.latitude,
  longitude: DEMO_GEOGRAPHY.simulator.longitude,
  initialRadius: 1.2,
  spreadSpeed: 2.4,
  spreadDirection: 65,
  severity: 55,
  simulatedPopulation: 1200,
  windSpeed: 26,
  windDirection: 70,
  temperature: 36,
  humidity: 20,
  reports: 3,
  responders: 4,
};
export async function simulatorStart(
  input: Partial<SimulatorConfig>,
  actorId: string,
) {
  const c = { ...defaults, ...input },
    t = now(),
    incId = id("inc");
  const provider = await providers.simulator.fetchIncident();
  db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO incidents(id,disaster_type,name,description,latitude,longitude,radius_km,spread_direction,spread_speed,start_time,status,severity_score,severity_level,severity_factors,severity_reasons,source_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        incId,
        "WILDFIRE",
        "Simulated Ridge Wildfire",
        "Hackathon simulator incident",
        c.latitude,
        c.longitude,
        c.initialRadius,
        c.spreadDirection,
        c.spreadSpeed,
        t,
        "ACTIVE",
        0,
        "LOW",
        "{}",
        "[]",
        "SIMULATED",
        t,
        t,
      );
    db()
      .prepare(
        `INSERT INTO simulator_state(id,incident_id,status,config,updated_at) VALUES('primary',?,'RUNNING',?,?) ON CONFLICT(id) DO UPDATE SET incident_id=excluded.incident_id,status='RUNNING',config=excluded.config,updated_at=excluded.updated_at`,
      )
      .run(incId, JSON.stringify(c), t);
    db()
      .prepare("INSERT INTO incident_data VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        id("dat"),
        incId,
        "WILDFIRE",
        JSON.stringify(provider.data),
        "SIMULATED",
        provider.provider,
        provider.observedAt,
        provider.expiresAt,
        t,
      );
  })();
  audit("SIMULATOR_STARTED", {
    incidentId: incId,
    actorId,
    newState: "RUNNING",
    metadata: c,
  });
  const factor = c.severity;
  recomputeSeverity(
    incId,
    {
      threat: factor,
      population: Math.min(100, c.simulatedPopulation / 25),
      spread: Math.min(100, c.spreadSpeed * 20),
      weather: Math.min(100, c.windSpeed * 2 + (30 - c.humidity)),
      requests: 10,
    },
    actorId,
  );
  if (c.responders) await generateResponders(incId, c.responders, c);
  if (c.reports) generateReports(incId, c.reports, c, actorId);
  emitToRoles("simulator.started", { incidentId: incId, config: c });
  return { incidentId: incId, status: "RUNNING", config: c };
}
export function simulatorControl(
  action: string,
  actorId: string,
  payload: any = {},
) {
  const s = db()
    .prepare("SELECT * FROM simulator_state WHERE id='primary'")
    .get() as any;
  if (!s && action !== "START")
    throw Object.assign(new Error("Simulator has not been started"), {
      status: 409,
    });
  const c: SimulatorConfig = s ? JSON.parse(s.config) : defaults,
    t = now();
  if (action === "PAUSE" || action === "RESUME") {
    const status = action === "PAUSE" ? "PAUSED" : "RUNNING";
    db()
      .prepare(
        "UPDATE simulator_state SET status=?,updated_at=? WHERE id='primary'",
      )
      .run(status, t);
    audit(`SIMULATOR_${action}`, {
      incidentId: s.incident_id,
      actorId,
      newState: status,
    });
    emitToRoles("simulator.updated", {
      incidentId: s.incident_id,
      action,
      status,
    });
    return { incidentId: s.incident_id, status, config: c };
  }
  if (action === "RESET") {
    db()
      .prepare("UPDATE incidents SET status='CLOSED',updated_at=? WHERE id=?")
      .run(t, s.incident_id);
    db()
      .prepare(
        "UPDATE simulator_state SET status='RESET',updated_at=? WHERE id='primary'",
      )
      .run(t);
    audit("SIMULATOR_RESET", {
      incidentId: s.incident_id,
      actorId,
      newState: "RESET",
    });
    emitToRoles("simulator.updated", {
      incidentId: s.incident_id,
      action,
      status: "RESET",
    });
    return { incidentId: s.incident_id, status: "RESET" };
  }
  if (s.status !== "RUNNING")
    throw Object.assign(new Error("Simulator must be running"), {
      status: 409,
    });
  if (action === "INCREASE_SPREAD") {
    c.spreadSpeed += Number(payload.amount || 1);
    c.initialRadius += Number(payload.radiusIncrease || 0.5);
    db()
      .prepare(
        "UPDATE incidents SET spread_speed=?,radius_km=?,updated_at=? WHERE id=?",
      )
      .run(c.spreadSpeed, c.initialRadius, t, s.incident_id);
    recomputeSeverity(
      s.incident_id,
      { spread: Math.min(100, c.spreadSpeed * 20) },
      actorId,
    );
  } else if (action === "INCREASE_SEVERITY") {
    c.severity = Math.min(100, c.severity + Number(payload.amount || 10));
    recomputeSeverity(
      s.incident_id,
      {
        threat: c.severity,
        weather: Math.min(100, c.windSpeed * 2 + 30 - c.humidity),
      },
      actorId,
    );
  } else if (action === "TRIGGER_CRITICAL_STATE") {
    c.severity = 100;
    c.spreadSpeed = Math.max(c.spreadSpeed, 5);
    recomputeSeverity(
      s.incident_id,
      {
        threat: 100,
        population: 90,
        requests: 90,
        vulnerable: 75,
        spread: 100,
        weather: 90,
        roads: 75,
        responderGap: 90,
        delays: 75,
        shelter: 80,
      },
      actorId,
    );
    createGeofenceAlerts(s.incident_id, "CRITICAL");
  } else if (action === "GENERATE_REPORTS")
    generateReports(s.incident_id, Number(payload.count || 3), c, actorId);
  else if (action === "GENERATE_HELP_REQUESTS")
    generateRequests(s.incident_id, Number(payload.count || 3), c);
  else if (action === "GENERATE_RESPONDERS")
    void generateResponders(s.incident_id, Number(payload.count || 3), c);
  else
    throw Object.assign(new Error("Unknown simulator action"), { status: 400 });
  db()
    .prepare(
      "UPDATE simulator_state SET config=?,updated_at=? WHERE id='primary'",
    )
    .run(JSON.stringify(c), t);
  emitToRoles("simulator.updated", {
    incidentId: s.incident_id,
    action,
    config: c,
  });
  return { incidentId: s.incident_id, status: "RUNNING", action, config: c };
}
function simulationUser(email: string, name: string, role: string) {
  let u = db().prepare("SELECT * FROM users WHERE email=?").get(email) as any;
  if (!u) {
    const t = now();
    u = {
      id: id("usr"),
      email,
      password_hash: bcrypt.hashSync("Demo123!", 10),
      name,
      role,
      status: "ACTIVE",
      verification_status: "VERIFIED",
      created_at: t,
      updated_at: t,
    };
    db()
      .prepare(
        "INSERT INTO users(id,email,password_hash,name,role,status,verification_status,created_at,updated_at) VALUES(@id,@email,@password_hash,@name,@role,@status,@verification_status,@created_at,@updated_at)",
      )
      .run(u);
  }
  return u;
}
async function generateResponders(
  incidentId: string,
  count: number,
  c: SimulatorConfig,
) {
  for (let n = 0; n < count; n++) {
    const u = simulationUser(
      `sim-responder-${n}@rescuermap.local`,
      `Sim Responder ${n + 1}`,
      "RESPONDER",
    );
    let rp = db()
      .prepare("SELECT * FROM responders WHERE user_id=?")
      .get(u.id) as any;
    if (!rp) {
      rp = { id: id("rsp") };
      db()
        .prepare(
          "INSERT INTO responders(id,user_id,verification_status,skills,capabilities,vehicle_available,passenger_capacity,availability,current_incident_id,status,updated_at) VALUES(?,?, 'VERIFIED','[]',?,1,4,1,?,'AVAILABLE',?)",
        )
        .run(
          rp.id,
          u.id,
          JSON.stringify([
            "TRANSPORT",
            "EVACUATION_ASSISTANCE",
            "GENERAL_ASSISTANCE",
            "MEDICAL_FIRST_AID",
          ]),
          incidentId,
          now(),
        );
    } else
      db()
        .prepare(
          "UPDATE responders SET availability=1,status='AVAILABLE',current_incident_id=?,updated_at=? WHERE id=?",
        )
        .run(incidentId, now(), rp.id);
    db()
      .prepare("INSERT INTO locations VALUES(?,?,?,?,?,?,?,?,?,'AVAILABLE',?)")
      .run(
        id("loc"),
        u.id,
        incidentId,
        null,
        c.latitude + 0.005 * (n + 1),
        c.longitude + 0.004 * (n + 1),
        10,
        "SIMULATED",
        "SHARED",
        now(),
      );
  }
}
function generateReports(
  incidentId: string,
  count: number,
  c: SimulatorConfig,
  actorId: string,
) {
  for (let n = 0; n < count; n++)
    db()
      .prepare("INSERT INTO community_reports VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        id("rpt"),
        incidentId,
        actorId,
        c.latitude + 0.003 * n,
        c.longitude - 0.003 * n,
        n % 2 ? "SMOKE_FIRE" : "BLOCKED_ROAD",
        n % 2 ? "Dense smoke observed" : "Road obstructed by debris",
        "SIMULATED",
        n % 2 ? "UNVERIFIED" : "VERIFIED",
        now(),
        now(),
      );
}
function generateRequests(
  incidentId: string,
  count: number,
  c: SimulatorConfig,
) {
  for (let n = 0; n < count; n++) {
    const u = simulationUser(
      `sim-resident-${n}@rescuermap.local`,
      `Sim Resident ${n + 1}`,
      "RESIDENT",
    );
    createHelpRequest(u.id, {
      clientRequestId: `simulation-${incidentId}-${n}`,
      incidentId,
      latitude: c.latitude + 0.002 * n,
      longitude: c.longitude + 0.002 * n,
      category: n === 0 ? "MEDICAL" : n % 2 ? "EVACUATION" : "TRANSPORTATION",
      description: "Simulated assistance request",
      peopleCount: n + 1,
      medicalEmergency: n === 0,
      vulnerabilities: n === 0 ? ["MOBILITY_LIMITATION"] : [],
      immediateDanger: n < 2,
    });
  }
  recomputeSeverity(incidentId);
}
