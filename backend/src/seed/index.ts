import bcrypt from "bcryptjs";
import { db } from "../db/index.js";
import { audit } from "../services/audit.js";
import {
  createHelpRequest,
  recomputeSeverity,
} from "../services/operations.js";
import { id, now } from "../utils/core.js";
import { DEMO_GEOGRAPHY } from "../config/geography.js";

const demoUsers = [
  ["usr_admin", "admin@rescuermap.local", "Demo Admin", "ADMIN"],
  [
    "usr_coord",
    "coordinator@rescuermap.local",
    "Maya Coordinator",
    "COORDINATOR",
  ],
  ["usr_resident", "resident@rescuermap.local", "Ravi Resident", "RESIDENT"],
  ["usr_resident2", "resident2@rescuermap.local", "Asha Resident", "RESIDENT"],
  ["usr_responder", "responder@rescuermap.local", "Sam Responder", "RESPONDER"],
  [
    "usr_responder2",
    "responder2@rescuermap.local",
    "Leena Responder",
    "RESPONDER",
  ],
] as const;

export async function seedAccountsOnly() {
  const database = db();
  const timestamp = now();
  const passwordHash = await bcrypt.hash("Demo123!", 10);
  for (const [userId, email, name, role] of demoUsers) {
    database
      .prepare(
        "INSERT OR IGNORE INTO users(id,email,password_hash,name,role,status,verification_status,created_at,updated_at) VALUES(?,?,?, ?,?,'ACTIVE','VERIFIED',?,?)",
      )
      .run(userId, email, passwordHash, name, role, timestamp, timestamp);
  }
  for (const [responderId, userId] of [
    ["rsp_demo", "usr_responder"],
    ["rsp_demo2", "usr_responder2"],
  ]) {
    database
      .prepare(
        "INSERT OR IGNORE INTO responders(id,user_id,verification_status,skills,capabilities,vehicle_available,passenger_capacity,availability,status,updated_at) VALUES(?,?,'VERIFIED',?,?,1,4,0,'OFFLINE',?)",
      )
      .run(
        responderId,
        userId,
        JSON.stringify(["First aid", "Evacuation"]),
        JSON.stringify([
          "MEDICAL_FIRST_AID",
          "EVACUATION_ASSISTANCE",
          "TRANSPORT",
        ]),
        timestamp,
      );
  }
  return { users: demoUsers.length };
}
export async function seed() {
  const d = db(),
    t = now();
  d.exec(
    "DELETE FROM simulator_state; DELETE FROM safe_checkins; DELETE FROM shelter_checkins; DELETE FROM incident_data; DELETE FROM fraud_cases; DELETE FROM audit_logs; DELETE FROM escalations; DELETE FROM notifications; DELETE FROM community_reports; DELETE FROM assignments; DELETE FROM help_requests; DELETE FROM shelters; DELETE FROM locations; DELETE FROM responders; DELETE FROM incidents; DELETE FROM users;",
  );
  const password_hash = await bcrypt.hash("Demo123!", 10);
  const users = demoUsers;
  for (const [uid, email, name, role] of users)
    d.prepare(
      "INSERT INTO users(id,email,password_hash,name,role,status,verification_status,created_at,updated_at) VALUES(?,?,?, ?,?,'ACTIVE','VERIFIED',?,?)",
    ).run(uid, email, password_hash, name, role, t, t);
  const inc = "inc_demo";
  d.prepare(
    `INSERT INTO incidents(id,disaster_type,name,description,latitude,longitude,radius_km,spread_direction,spread_speed,start_time,status,severity_score,severity_level,severity_factors,severity_reasons,source_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    inc,
    "WILDFIRE",
    "Santa Cruz Mountains Wildfire",
    "Simulated California wildfire for the unified RescuerMap demo",
    DEMO_GEOGRAPHY.incident.latitude,
    DEMO_GEOGRAPHY.incident.longitude,
    2.5,
    45,
    3.1,
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
    d.prepare(
      "INSERT INTO locations VALUES(?,?,?,?,?,?,?,?,?,'AVAILABLE',?)",
    ).run(
      id("loc"),
      uid,
      inc,
      null,
      37.13 + n * 0.006,
      -122.116 + n * 0.004,
      8,
      "GPS",
      "SHARED",
      t,
    );
  }
  d.prepare(
    "INSERT INTO locations VALUES(?,?,?,?,?,?,?,?,?,'AVAILABLE',?)",
  ).run(
    id("loc"),
    "usr_resident",
    inc,
    null,
    37.127,
    -122.119,
    12,
    "GPS",
    "SHARED",
    t,
  );
  d.prepare(
    "INSERT INTO locations VALUES(?,?,?,?,?,?,?,?,?,'AVAILABLE',?)",
  ).run(
    id("loc"),
    "usr_resident2",
    inc,
    null,
    37.135,
    -122.111,
    15,
    "GPS",
    "SHARED",
    t,
  );
  d.prepare("INSERT INTO shelters VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
    "shl_demo",
    inc,
    "Santa Cruz Valley Relief Centre",
    37.145,
    -122.101,
    120,
    42,
    "OPEN",
    1,
    JSON.stringify(["WATER", "FIRST_AID", "ACCESSIBLE_BEDS"]),
    t,
    t,
  );
  d.prepare("INSERT INTO community_reports VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
    "rpt_demo",
    inc,
    "usr_resident2",
    37.128,
    -122.122,
    "BLOCKED_ROAD",
    "Fallen tree obstructing west access road",
    "COMMUNITY",
    "VERIFIED",
    t,
    t,
  );
  createHelpRequest("usr_resident", {
    clientRequestId: "demo-critical",
    incidentId: inc,
    latitude: 37.127,
    longitude: -122.119,
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
    latitude: 37.135,
    longitude: -122.111,
    category: "EVACUATION",
    description: "Need transport to shelter",
    peopleCount: 3,
    medicalEmergency: false,
    vulnerabilities: [],
    immediateDanger: true,
  });
  recomputeSeverity(inc, {
    threat: 85,
    population: 70,
    spread: 78,
    weather: 72,
    roads: 60,
  });
  audit("DEMO_DATA_SEEDED", { incidentId: inc, actorId: "usr_admin" });
  return { users: users.length, incidentId: inc };
}
