export type ZoneStatus = 'normal' | 'advisory' | 'warning' | 'order' | 'repopulation';

export const ZONE_STATUSES: ZoneStatus[] = ['normal', 'advisory', 'warning', 'order', 'repopulation'];

export interface Zone {
  id: string;
  code: string;
  name: string;
  population: number;
  status: ZoneStatus;
  geom: GeoJSON.Polygon;
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
}

// Where data came from: the Supabase tables, or lib/seed.ts when the tables are missing/unreachable.
export type DataSource = 'supabase' | 'seed';

export interface ZonesResponse {
  zones: ScoredZone[];
  wind: Wind;
  fireCount: number;
  source: DataSource;
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
