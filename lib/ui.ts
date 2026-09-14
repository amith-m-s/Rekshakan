import type { ReportKind, Zone, ZoneStatus } from './types';

export const STATUS_COLOR: Record<ZoneStatus, string> = {
  normal: '#22c55e',
  advisory: '#eab308',
  warning: '#f97316',
  order: '#dc2626',
  shelter: '#a855f7',
  repopulation: '#3b82f6',
};

export const REPORT_COLOR: Record<ReportKind, string> = {
  fire: '#ef4444',
  smoke: '#a1a1aa',
  blocked_road: '#f59e0b',
  needs_help: '#d946ef',
  other: '#14b8a6',
};

export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'zh', label: 'Chinese' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'tl', label: 'Tagalog' },
];

// [[south, west], [north, east]] of all outer rings (Polygon or MultiPolygon).
export function zoneBounds(zone: Zone): [[number, number], [number, number]] {
  const polygons = zone.geom.type === 'Polygon' ? [zone.geom.coordinates] : zone.geom.coordinates;
  const ring = polygons.flatMap(p => p[0]);
  const lngs = ring.map(p => p[0]);
  const lats = ring.map(p => p[1]);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

export function zoneCenter(zone: Zone): { lat: number; lng: number } {
  const [[s, w], [n, e]] = zoneBounds(zone);
  return { lat: (s + n) / 2, lng: (w + e) / 2 };
}

// Compass label for the direction wind blows toward.
export function compass(deg: number) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
