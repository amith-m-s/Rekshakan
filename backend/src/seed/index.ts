import bcrypt from "bcryptjs";
import { nearestTown, offsetKm } from "../data/california.js";
import { db } from "../db/index.js";
import { audit } from "../services/audit.js";
import {
  ensureSystemUsers,
  incidentName,
  loadCaliforniaScenario,
  SYSTEM_USERS,
  type Hotspot,
  type IncidentPlan,
} from "../services/intelligence.js";
import {
  createHelpRequest,
  recomputeSeverity,
} from "../services/operations.js";
import { haversineKm, id, now } from "../utils/core.js";

// Demo data for the rescue console, placed at the real active California evacuation zones and NASA FIRMS
// hotspots published by the statewide intelligence dashboard. When the dashboard can't be reached (or in
// tests, where live=false) it uses fixed, clearly labelled California samples instead.
export async function seed(options: { live?: boolean } = {}) {
  const live = options.live ?? !process.env.VITEST;
  // Fetch before deleting anything, so a slow or failed fetch never leaves an empty database.
  const scenario = await loadCaliforniaScenario(live);
  const d = db(),
    t = now();
  d.exec(
    "DELETE FROM simulator_state; DELETE FROM safe_checkins; DELETE FROM shelter_checkins; DELETE FROM incident_data; DELETE FROM fraud_cases; DELETE FROM audit_logs; DELETE FROM escalations; DELETE FROM notifications; DELETE FROM community_reports; DELETE FROM assignments; DELETE FROM help_requests; DELETE FROM shelters; DELETE FROM locations; DELETE FROM responders; DELETE FROM incidents; DELETE FROM users;",
  );
  const password_hash = await bcrypt.hash("Demo123!", 10);
  const users = [
    ["usr_admin", "admin@rescuermap.local", "Demo Admin", "ADMIN"],
    [
      "usr_coord",
      "coordinator@rescuermap.local",
      "Maya Coordinator",
      "COORDINATOR",
    ],
    ["usr_resident", "resident@rescuermap.local", "Ravi Resident", "RESIDENT"],
    [
      "usr_resident2",
      "resident2@rescuermap.local",
      "Asha Resident",
      "RESIDENT",
    ],
    [
      "usr_responder",
      "responder@rescuermap.local",
      "Sam Responder",
      "RESPONDER",
    ],
    [
      "usr_responder2",
      "responder2@rescuermap.local",
      "Leena Responder",
      "RESPONDER",
    ],
  ];
  for (const [uid, email, name, role] of users)
    d.prepare(
      "INSERT INTO users(id,email,password_hash,name,role,status,verification_status,created_at,updated_at) VALUES(?,?,?, ?,?,'ACTIVE','VERIFIED',?,?)",
    ).run(uid, email, password_hash, name, role, t, t);
  ensureSystemUsers();

  // The first (most threatened) zone is the primary demo incident and keeps the id the console and tests use.
  const plans = scenario.plans;
  const incidentIds = plans.map((_, n) => (n === 0 ? "inc_demo" : `inc_ca_${n + 1}`));
  plans.forEach((plan, n) => insertIncident(incidentIds[n], plan, t));
  const inc = incidentIds[0];
  const primary = plans[0];
  const near = (northKm: number, eastKm: number) => offsetKm(primary, northKm, eastKm);

  const responders = [
    ["rsp_demo", "usr_responder"],
    ["rsp_demo2", "usr_responder2"],
  ];
  for (let n = 0; n < responders.length; n++) {
    const [rid, uid] = responders[n];
    d.prepare(
      "INSERT INTO responders(id,user_id,verification_status,skills,capabilities,vehicle_available,passenger_capacity,availability,current_incident_id,status,updated_at) VALUES(?,?, 'VERIFIED',?, ?,1,4,1,?,'AVAILABLE',?)",
    ).run(
      rid,
      uid,
      JSON.stringify(["First aid", "Evacuation"]),
      JSON.stringify(
        n === 0
          ? ["MEDICAL_FIRST_AID", "EVACUATION_ASSISTANCE", "TRANSPORT"]
          : ["GENERAL_ASSISTANCE", "TRANSPORT"],
      ),
      inc,
      t,
    );
    const spot = near(primary.radiusKm + 1.5 + n, -1.5 + n * 2.5);
    d.prepare(
      "INSERT INTO locations VALUES(?,?,?,?,?,?,?,?,?,'AVAILABLE',?)",
    ).run(id("loc"), uid, inc, null, spot.latitude, spot.longitude, 8, "GPS", "SHARED", t);
  }
  const residentSpots = [near(0.4, 0.3), near(-0.6, 0.8)];
  ["usr_resident", "usr_resident2"].forEach((uid, n) =>
    d
      .prepare("INSERT INTO locations VALUES(?,?,?,?,?,?,?,?,?,'AVAILABLE',?)")
      .run(
        id("loc"),
        uid,
        inc,
        null,
        residentSpots[n].latitude,
        residentSpots[n].longitude,
        12 + n * 3,
        "GPS",
        "SHARED",
        t,
      ),
  );

  // One shelter per incident, in the nearest town safely outside its radius.
  const capacities = [120, 200, 80];
  plans.forEach((plan, n) => {
    const town = nearestTown(plan, plan.radiusKm + 5, 90);
    d.prepare("INSERT INTO shelters VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
      n === 0 ? "shl_demo" : `shl_ca_${n + 1}`,
      incidentIds[n],
      `${town.name} evacuation shelter (demo)`,
      town.latitude,
      town.longitude,
      capacities[n] ?? 100,
      Math.round((capacities[n] ?? 100) * 0.3),
      "OPEN",
      1,
      JSON.stringify(["WATER", "FIRST_AID", "ACCESSIBLE_BEDS"]),
      t,
      t,
    );
  });

  const blocked = near(-0.3, -0.7);
  d.prepare("INSERT INTO community_reports VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
    "rpt_demo",
    inc,
    "usr_resident2",
    blocked.latitude,
    blocked.longitude,
    "BLOCKED_ROAD",
    `Fallen tree obstructing the evacuation road toward ${nearestTown(primary, primary.radiusKm + 5, 90).name}`,
    "COMMUNITY",
    "VERIFIED",
    t,
    t,
  );
  plans.forEach((plan, n) => insertHotspotReports(incidentIds[n], plan, scenario.hotspots, n, t));

  // Secondary incidents first: the console opens the most recently updated incident, which must be the primary.
  plans.forEach((plan, n) => {
    if (n > 0) recomputeSeverity(incidentIds[n], severityInputs(plan));
  });
  createHelpRequest("usr_resident", {
    clientRequestId: "demo-critical",
    incidentId: inc,
    latitude: residentSpots[0].latitude,
    longitude: residentSpots[0].longitude,
    category: "MEDICAL",
    description: "Mobility assistance and first aid needed",
    peopleCount: 2,
    medicalEmergency: true,
    vulnerabilities: ["MOBILITY_LIMITATION", "ELDERLY"],
    immediateDanger: true,
  });
  createHelpRequest("usr_resident2", {
    clientRequestId: "demo-evacuation",
    incidentId: inc,
    latitude: residentSpots[1].latitude,
    longitude: residentSpots[1].longitude,
    category: "EVACUATION",
    description: "Need transport to shelter",
    peopleCount: 3,
    medicalEmergency: false,
    vulnerabilities: [],
    immediateDanger: true,
  });
  recomputeSeverity(inc, severityInputs(primary));
  audit("DEMO_DATA_SEEDED", {
    incidentId: inc,
    actorId: "usr_admin",
    metadata: {
      source: scenario.source,
      note: scenario.note,
      zones: plans.map((p) => p.code),
    },
  });
  return {
    users: users.length,
    incidentId: inc,
    source: scenario.source,
    note: scenario.note,
    incidents: plans.map((p, n) => ({ id: incidentIds[n], name: incidentName(p) })),
  };
}

function insertIncident(incidentId: string, plan: IncidentPlan, t: string) {
  const description = plan.zoneId
    ? `${plan.notes} · Cal OES evacuation zone ${plan.code}${
        plan.hotspotKm !== null ? ` · nearest NASA FIRMS hotspot ${plan.hotspotKm.toFixed(1)} km` : ""
      } · via RescuerMap statewide intelligence`
    : plan.notes;
  db()
    .prepare(
      `INSERT INTO incidents(id,disaster_type,name,description,latitude,longitude,radius_km,boundary_json,spread_direction,spread_speed,start_time,status,severity_score,severity_level,severity_factors,severity_reasons,source_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      incidentId,
      "WILDFIRE",
      incidentName(plan),
      description,
      plan.latitude,
      plan.longitude,
      plan.radiusKm,
      plan.boundary ? JSON.stringify(plan.boundary) : null,
      plan.windDirection,
      2.5,
      plan.updatedAt ?? t,
      "ACTIVE",
      0,
      "LOW",
      "{}",
      "[]",
      plan.zoneId ? "OFFICIAL" : "SIMULATED",
      t,
      t,
    );
  db()
    .prepare("INSERT INTO incident_data VALUES(?,?,?,?,?,?,?,?,?)")
    .run(
      id("dat"),
      incidentId,
      "CALOES_ZONE",
      JSON.stringify({
        zoneId: plan.zoneId,
        code: plan.code,
        county: plan.county,
        status: plan.status,
        notes: plan.notes,
        threatScore: plan.threatScore,
        hotspotKm: plan.hotspotKm,
        windKmh: plan.windKmh,
      }),
      plan.zoneId ? "OFFICIAL" : "SIMULATED",
      plan.zoneId ? "cal-oes-via-statewide-intelligence" : "offline-california-sample",
      plan.updatedAt ?? t,
      new Date(Date.now() + 3_600_000).toISOString(),
      t,
    );
}

// Up to three real satellite detections within 30 km of the incident, as verified smoke/fire reports.
function insertHotspotReports(incidentId: string, plan: IncidentPlan, hotspots: Hotspot[], n: number, t: string) {
  hotspots
    .map((h) => ({ h, km: haversineKm(plan, h) }))
    .filter((x) => x.km <= 30)
    .sort((a, b) => a.km - b.km)
    .slice(0, 3)
    .forEach(({ h, km }, k) =>
      db()
        .prepare("INSERT INTO community_reports VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          `rpt_firms_${n + 1}_${k + 1}`,
          incidentId,
          SYSTEM_USERS.intelligence,
          h.latitude,
          h.longitude,
          "SMOKE_FIRE",
          `NASA FIRMS VIIRS hotspot ${km.toFixed(1)} km from the incident centre: ${h.frp} MW fire radiative power, detected ${h.acquired}, confidence ${h.confidence}`,
          "SATELLITE",
          "VERIFIED",
          t,
          t,
        ),
    );
}

function severityInputs(plan: IncidentPlan) {
  return {
    threat: Math.min(100, Math.max(25, Math.round(plan.threatScore * 100))),
    population: 60,
    spread: Math.min(100, Math.round(plan.windKmh * 3)),
    weather: Math.min(100, Math.round(plan.windKmh * 2.5 + 20)),
    roads: 55,
  };
}
