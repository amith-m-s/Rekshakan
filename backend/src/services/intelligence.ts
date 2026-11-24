// Link between the rescue console and the statewide intelligence dashboard (repo-root Next.js app).
//
// - Seeding: live Cal OES evacuation zones and NASA FIRMS hotspots from the dashboard decide where the demo
//   incidents, reports, shelters and people are placed.
// - Sync: field reports posted to the dashboard (phones, simulator) become community reports here, "needs help"
//   reports become help requests, and alerts generated on the dashboard become console notifications.
//
// The dashboard pulls the other direction from GET /api/public/incidents.
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { config } from "../config/index.js";
import { nearestTown, OFFLINE_SAMPLE_INCIDENTS } from "../data/california.js";
import { db } from "../db/index.js";
import { haversineKm, id, log, now } from "../utils/core.js";
import { audit } from "./audit.js";
import { createHelpRequest, notify } from "./operations.js";
import { emitToRoles } from "./runtime.js";

// Accounts that own imported records. Status SYSTEM means they can never log in.
export const SYSTEM_USERS = {
  intelligence: "usr_intelligence",
  fieldApp: "usr_field_app",
} as const;

// Field reports farther than this from every active incident start a new incident.
const ATTACH_KM = 50;
// Only import reports and alerts from the last two days.
const MAX_AGE_MS = 48 * 3_600_000;

type Geometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

interface DashboardZone {
  id: string;
  code: string;
  name: string;
  county?: string | null;
  status: string;
  origin?: string;
  notes?: string | null;
  updatedAt?: string | null;
  geom: Geometry;
  areaKm2?: number;
  threat: { score: number; km: number | null };
  wind: { speed: number; direction: number } | null;
}

interface DashboardFire {
  latitude: string;
  longitude: string;
  frp: string;
  acq_date: string;
  acq_time: string;
  confidence?: string;
}

interface DashboardReport {
  id: string;
  kind: string;
  message: string;
  lat: number;
  lng: number;
  reporter: string | null;
  created_at: string;
}

interface DashboardAlert {
  id: string;
  zone_id: string;
  zone_code: string;
  status: string;
  messages: Record<string, string>;
  created_at: string;
}

export interface Hotspot {
  latitude: number;
  longitude: number;
  frp: number;
  acquired: string;
  confidence: string;
}

export interface IncidentPlan {
  county: string;
  code: string;
  zoneId: string | null;
  status: string;
  notes: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  threatScore: number;
  hotspotKm: number | null;
  windKmh: number;
  windDirection: number | null;
  boundary: Geometry | null;
  updatedAt: string | null;
}

async function getJson<T>(path: string, timeoutMs: number): Promise<T> {
  if (!config.intelligenceUrl) throw new Error("INTELLIGENCE_URL is not set");
  const res = await fetch(`${config.intelligenceUrl}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return (await res.json()) as T;
}

function geometryCenter(geom: Geometry) {
  const rings = geom.type === "Polygon" ? [geom.coordinates[0]] : geom.coordinates.map((p) => p[0]);
  const points = rings.flat();
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  };
}

export function incidentName(plan: IncidentPlan) {
  return plan.zoneId
    ? `${plan.county} County evacuation ${plan.status} · ${plan.code}`
    : `${plan.county} County wildfire · offline sample`;
}

// Where the demo scenario happens: the most threatened live zone in each of the top three counties, or
// fixed California samples when the dashboard can't be reached (it may be waking up) or live=false.
export async function loadCaliforniaScenario(live: boolean): Promise<{
  source: "live" | "offline";
  note: string | null;
  plans: IncidentPlan[];
  hotspots: Hotspot[];
}> {
  let note: string | null = live ? null : "live data disabled";
  if (live && config.intelligenceUrl) {
    try {
      const { zones } = await getJson<{ zones: DashboardZone[] }>("/api/zones", 45_000);
      const bestPerCounty = new Map<string, DashboardZone>();
      for (const zone of zones) {
        if (zone.origin !== "caloes" || !zone.county) continue;
        const current = bestPerCounty.get(zone.county);
        if (!current || zone.threat.score > current.threat.score) bestPerCounty.set(zone.county, zone);
      }
      const picked = [...bestPerCounty.values()].sort((a, b) => b.threat.score - a.threat.score).slice(0, 3);
      if (picked.length) {
        const fires = await getJson<DashboardFire[]>("/api/fires", 30_000).catch(() => []);
        return {
          source: "live",
          note: null,
          hotspots: (Array.isArray(fires) ? fires : []).map((f) => ({
            latitude: Number(f.latitude),
            longitude: Number(f.longitude),
            frp: Number(f.frp) || 0,
            acquired: `${f.acq_date} ${String(f.acq_time).padStart(4, "0")} UTC`,
            confidence: f.confidence ?? "n/a",
          })),
          plans: picked.map((zone) => ({
            county: zone.county!,
            code: zone.code,
            zoneId: zone.id,
            status: zone.status,
            notes: zone.notes?.trim() || `Active Cal OES evacuation ${zone.status}`,
            ...geometryCenter(zone.geom),
            radiusKm: Math.round(Math.min(12, Math.max(1, Math.sqrt((zone.areaKm2 ?? 3) / Math.PI))) * 10) / 10,
            threatScore: zone.threat.score,
            hotspotKm: zone.threat.km,
            windKmh: zone.wind?.speed ?? 15,
            windDirection: zone.wind?.direction ?? null,
            boundary: zone.geom,
            updatedAt: zone.updatedAt ?? null,
          })),
        };
      }
      note = "the dashboard reported no active Cal OES zones";
    } catch (error: any) {
      note = `statewide intelligence unavailable: ${error.message}`;
    }
  }
  return {
    source: "offline",
    note,
    hotspots: [],
    plans: OFFLINE_SAMPLE_INCIDENTS.map((sample) => ({
      ...sample,
      zoneId: null,
      hotspotKm: null,
      windDirection: null,
      boundary: null,
      updatedAt: null,
    })),
  };
}

export function ensureSystemUsers() {
  const t = now();
  const unusableHash = bcrypt.hashSync(crypto.randomUUID(), 8);
  const insert = db().prepare(
    "INSERT OR IGNORE INTO users(id,email,password_hash,name,role,status,verification_status,alerts_opt_in,created_at,updated_at) VALUES(?,?,?,?,?,'SYSTEM','VERIFIED',0,?,?)",
  );
  insert.run(
    SYSTEM_USERS.intelligence,
    "intelligence-feed@rescuermap.system",
    unusableHash,
    "Statewide intelligence feed",
    "COORDINATOR",
    t,
    t,
  );
  insert.run(
    SYSTEM_USERS.fieldApp,
    "field-app@rescuermap.system",
    unusableHash,
    "Public field app",
    "RESIDENT",
    t,
    t,
  );
}

// ---------------------------------------------------------------------------------------------------------
// Sync

const REPORT_CATEGORY: Record<string, string> = {
  fire: "SMOKE_FIRE",
  smoke: "SMOKE_FIRE",
  blocked_road: "BLOCKED_ROAD",
  needs_help: "OTHER",
  other: "HAZARD",
};

type ActiveIncident = { id: string; name: string; latitude: number; longitude: number };

const status = {
  lastRunAt: null as string | null,
  lastSuccessAt: null as string | null,
  lastError: null as string | null,
  lastResult: null as null | Record<string, number>,
  totals: { reports: 0, helpRequests: 0, alerts: 0, incidentsCreated: 0 },
};
let running: Promise<Record<string, number>> | null = null;

export function intelligenceStatus() {
  return {
    enabled: Boolean(config.intelligenceUrl),
    url: config.intelligenceUrl || null,
    intervalSeconds: config.intelligenceSyncSeconds,
    ...status,
  };
}

function activeIncidents(): ActiveIncident[] {
  return db()
    .prepare(
      "SELECT id,name,latitude,longitude FROM incidents WHERE status IN ('DETECTED','ACTIVE') AND source_type != 'SIMULATED' ORDER BY severity_score DESC",
    )
    .all() as ActiveIncident[];
}

// An incident for field reports that don't fall near any known incident.
function createFieldIncident(report: DashboardReport): ActiveIncident {
  const point = { latitude: report.lat, longitude: report.lng };
  const town = nearestTown(point);
  const t = now();
  const incident = {
    id: id("inc"),
    name: `Field-reported ${report.kind.replace("_", " ")} near ${town.name}`,
    latitude: point.latitude,
    longitude: point.longitude,
  };
  db()
    .prepare(
      `INSERT INTO incidents(id,disaster_type,name,description,latitude,longitude,radius_km,boundary_json,spread_direction,spread_speed,start_time,status,severity_score,severity_level,severity_factors,severity_reasons,source_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL,?,'DETECTED',0,'LOW','{}','[]','COMMUNITY',?,?)`,
    )
    .run(
      incident.id,
      "WILDFIRE",
      incident.name,
      "Created automatically from public field app reports received by the statewide intelligence dashboard.",
      incident.latitude,
      incident.longitude,
      3,
      t,
      t,
      t,
    );
  audit("INCIDENT_CREATED", {
    incidentId: incident.id,
    actorId: SYSTEM_USERS.intelligence,
    newState: "DETECTED",
    metadata: { source: "statewide-intelligence", reportId: report.id },
  });
  emitToRoles("incident.severity_changed", { incidentId: incident.id, score: 0, level: "LOW" });
  return incident;
}

function importReport(report: DashboardReport, incidents: ActiveIncident[], counts: Record<string, number>) {
  if (!(Date.now() - Date.parse(report.created_at) < MAX_AGE_MS)) return;
  if (!Number.isFinite(report.lat) || !Number.isFinite(report.lng)) return;
  const reportId = `rpt_field_${report.id}`;
  if (db().prepare("SELECT 1 FROM community_reports WHERE id=?").get(reportId)) return;

  const point = { latitude: report.lat, longitude: report.lng };
  const ranked = incidents
    .map((incident) => ({ incident, km: haversineKm(point, incident) }))
    .sort((a, b) => a.km - b.km);
  let incident = ranked[0] && ranked[0].km <= ATTACH_KM ? ranked[0].incident : null;
  if (!incident) {
    // Hazards far from any incident are noted but don't open one; fires, smoke and people needing help do.
    if (!["fire", "smoke", "needs_help"].includes(report.kind)) {
      counts.skipped++;
      return;
    }
    incident = createFieldIncident(report);
    incidents.push(incident);
    counts.incidentsCreated++;
  }

  const t = now();
  const row = {
    id: reportId,
    incident_id: incident.id,
    reporter_id: SYSTEM_USERS.fieldApp,
    latitude: point.latitude,
    longitude: point.longitude,
    category: REPORT_CATEGORY[report.kind] ?? "OTHER",
    description: `${report.message?.trim() || report.kind.replace("_", " ")} (${report.reporter ?? "anonymous"}, via field app)`.slice(
      0,
      1500,
    ),
    source_type: "FIELD_APP",
    verification_status: "UNVERIFIED",
    created_at: report.created_at,
    updated_at: t,
  };
  db()
    .prepare(
      "INSERT OR IGNORE INTO community_reports VALUES(@id,@incident_id,@reporter_id,@latitude,@longitude,@category,@description,@source_type,@verification_status,@created_at,@updated_at)",
    )
    .run(row);
  audit("COMMUNITY_REPORT_IMPORTED", {
    incidentId: incident.id,
    actorId: SYSTEM_USERS.intelligence,
    latitude: row.latitude,
    longitude: row.longitude,
    metadata: { reportId: row.id, dashboardReportId: report.id, kind: report.kind },
  });
  counts.reports++;

  if (report.kind === "needs_help") {
    const text = (report.message ?? "").toLowerCase();
    const vulnerabilities = [
      /elder|senior|old/.test(text) && "ELDERLY",
      /wheelchair|mobility|disab/.test(text) && "MOBILITY_LIMITATION",
      /child|kid|baby|infant/.test(text) && "CHILDREN",
    ].filter(Boolean);
    createHelpRequest(SYSTEM_USERS.fieldApp, {
      clientRequestId: `field-${report.id}`,
      incidentId: incident.id,
      latitude: point.latitude,
      longitude: point.longitude,
      category: /car|stuck|strand|trap/.test(text) ? "STRANDED" : "EVACUATION",
      description: row.description,
      peopleCount: 1,
      medicalEmergency: /injur|hurt|medical|bleed|burn|breath/.test(text),
      vulnerabilities,
      immediateDanger: true,
    });
    counts.helpRequests++;
  }
}

function importAlert(alert: DashboardAlert, counts: Record<string, number>) {
  if (!(Date.now() - Date.parse(alert.created_at) < MAX_AGE_MS)) return;
  const linked = db()
    .prepare(
      "SELECT incident_id FROM incident_data WHERE data_type='CALOES_ZONE' AND json_extract(payload,'$.zoneId')=? LIMIT 1",
    )
    .get(alert.zone_id) as { incident_id: string } | undefined;
  const text = alert.messages?.en ?? Object.values(alert.messages ?? {})[0] ?? "";
  const created = notify(
    null,
    linked?.incident_id ?? null,
    "INTELLIGENCE_ALERT",
    `${String(alert.status).toUpperCase()} alert issued · ${alert.zone_code}`,
    text,
    `intel-alert:${alert.id}`,
  );
  if (created) counts.alerts++;
}

async function runSync() {
  const counts = { reports: 0, helpRequests: 0, alerts: 0, incidentsCreated: 0, skipped: 0, failed: 0 };
  const [reportsBody, alerts] = await Promise.all([
    getJson<{ reports: DashboardReport[] }>("/api/reports", 30_000),
    getJson<DashboardAlert[]>("/api/alert", 30_000),
  ]);
  ensureSystemUsers();
  const incidents = activeIncidents();
  // Oldest first, so incidents created from early reports collect the later ones.
  for (const report of [...(reportsBody.reports ?? [])].reverse()) {
    try {
      importReport(report, incidents, counts);
    } catch (error: any) {
      counts.failed++;
      log("warn", "intelligence_report_import_failed", { reportId: report.id, error: error.message });
    }
  }
  for (const alert of [...(Array.isArray(alerts) ? alerts : [])].reverse()) {
    try {
      importAlert(alert, counts);
    } catch (error: any) {
      counts.failed++;
      log("warn", "intelligence_alert_import_failed", { alertId: alert.id, error: error.message });
    }
  }
  if (counts.reports || counts.alerts) {
    emitToRoles("intelligence.synced", counts);
    log("info", "intelligence_synced", counts);
  }
  return counts;
}

export async function syncIntelligence() {
  if (!config.intelligenceUrl) return { disabled: 1 };
  if (running) return running;
  status.lastRunAt = now();
  running = runSync()
    .then((counts) => {
      status.lastSuccessAt = now();
      status.lastError = null;
      status.lastResult = counts;
      status.totals.reports += counts.reports;
      status.totals.helpRequests += counts.helpRequests;
      status.totals.alerts += counts.alerts;
      status.totals.incidentsCreated += counts.incidentsCreated;
      return counts;
    })
    .catch((error) => {
      status.lastError = error.message;
      log("warn", "intelligence_sync_failed", { error: error.message });
      throw error;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

export function startIntelligenceSync() {
  if (!config.intelligenceUrl || config.intelligenceSyncSeconds <= 0) {
    log("info", "intelligence_sync_disabled");
    return;
  }
  ensureSystemUsers();
  const tick = () => syncIntelligence().catch(() => {});
  setTimeout(tick, 10_000);
  setInterval(tick, config.intelligenceSyncSeconds * 1000);
  log("info", "intelligence_sync_started", {
    url: config.intelligenceUrl,
    intervalSeconds: config.intelligenceSyncSeconds,
  });
}
