export type ZoneStatus = 'normal' | 'advisory' | 'warning' | 'order' | 'shelter' | 'repopulation';

export const ZONE_STATUSES: ZoneStatus[] = ['normal', 'advisory', 'warning', 'order', 'shelter', 'repopulation'];

// caloes: live statewide feed (read-only, status set by counties). demo: Supabase table or lib/seed.ts.
export type ZoneOrigin = 'caloes' | 'demo';

export interface Zone {
  id: string;
  code: string;
  name: string;
  population: number | null;
  status: ZoneStatus;
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  origin?: ZoneOrigin;
  county?: string | null;
  notes?: string | null;
  updatedAt?: string | null;
}

export interface Fire {
  latitude: string;
  longitude: string;
  frp: string;
  acq_date: string;
  acq_time: string;
  [key: string]: string;
}

export interface Wind {
  speed: number;
  direction: number;
}

export interface Threat {
  score: number;
  proximity: number;
  alignment: number;
  exposure: number;
  km: number | null;
}

export interface ScoredZone extends Zone {
  threat: Threat;
  wind: Wind | null;
  areaKm2: number;
}

// Where demo zones came from: the Supabase tables, or lib/seed.ts when the tables are missing/unreachable.
export type DataSource = 'supabase' | 'seed';

export interface ZonesResponse {
  zones: ScoredZone[];
  fireCount: number;
  sources: {
    live: 'caloes' | 'unavailable';
    demo: DataSource;
    // Live zones dropped because the county hasn't updated them in months.
    staleHidden: number;
  };
}

export interface AlertRecord {
  id: string;
  zone_id: string;
  zone_code: string;
  status: ZoneStatus;
  messages: Record<string, string>;
  created_at: string;
}

export type ReportKind = 'fire' | 'smoke' | 'blocked_road' | 'needs_help' | 'other';

export const REPORT_KINDS: ReportKind[] = ['fire', 'smoke', 'blocked_road', 'needs_help', 'other'];

export interface Report {
  id: string;
  kind: ReportKind;
  message: string;
  lat: number;
  lng: number;
  reporter: string | null;
  created_at: string;
}

// Incident summary from the rescue operations API (GET /api/public/incidents). Aggregates only, no personal data.
export interface RescueIncident {
  id: string;
  disaster_type: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_km: number;
  status: string;
  severity_score: number;
  severity_level: string;
  source_type: string;
  updated_at: string;
  openHelpRequests: number;
  criticalHelpRequests: number;
  respondersEngaged: number;
  sheltersOpen: number;
  reports: number;
}
