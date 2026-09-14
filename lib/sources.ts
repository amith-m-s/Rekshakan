import { inCalifornia } from './california';
import type { Fire, Wind, Zone, ZoneStatus } from './types';

// Rough California bounding box (west,south,east,north).
export const CA_BBOX = '-124.5,32.5,-114,42.1';
export const DEFAULT_BBOX = CA_BBOX;
export const MAP_CENTER = { lat: 37.2, lng: -119.5 };

export async function fetchFires(bbox = DEFAULT_BBOX): Promise<Fire[]> {
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${process.env.FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/${bbox}/2`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`FIRMS returned ${res.status}`);

  const csv = await res.text();
  const [head, ...rows] = csv.trim().split('\n');
  // FIRMS answers errors (bad key, bad bbox) with a plain-text line instead of a CSV header.
  if (!head?.startsWith('latitude')) throw new Error(`FIRMS error: ${head?.slice(0, 120)}`);
  const cols = head.split(',');

  const fires = rows.filter(Boolean).map(r => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v])) as Fire);
  // The FIRMS query is a rectangle; for the statewide default, drop hotspots in NV, AZ, OR and Mexico.
  return bbox === CA_BBOX ? fires.filter(f => inCalifornia(+f.latitude, +f.longitude)) : fires;
}

export async function fetchWeather(lat: number | string, lng: number | string) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&current=wind_speed_10m,wind_direction_10m`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
  return res.json();
}

type Current = { current: { wind_speed_10m: number; wind_direction_10m: number } };

// Open-Meteo reports the direction wind blows FROM; threatScore compares against the
// fire->zone bearing, so flip it to the direction the wind blows TOWARD.
const toWind = (d: Current): Wind => ({
  speed: d.current.wind_speed_10m,
  direction: (d.current.wind_direction_10m + 180) % 360,
});

export async function fetchWind(lat: number, lng: number): Promise<Wind> {
  return toWind(await fetchWeather(lat, lng));
}

// Wind for many points in as few requests as possible. Points are snapped to a 0.1° grid
// (~10 km) so nearby zones share a lookup. Returns winds in the same order as `points`.
export async function fetchWinds(points: { lat: number; lng: number }[]): Promise<Wind[]> {
  const keyOf = (p: { lat: number; lng: number }) => `${p.lat.toFixed(1)},${p.lng.toFixed(1)}`;
  const unique = [...new Set(points.map(keyOf))];
  const byKey = new Map<string, Wind>();

  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const lats = chunk.map(k => k.split(',')[0]).join(',');
    const lngs = chunk.map(k => k.split(',')[1]).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&current=wind_speed_10m,wind_direction_10m`;
    const res = await fetch(url, { next: { revalidate: 900 } });
    if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
    const body: Current | Current[] = await res.json();
    // A single location comes back as an object, several as an array.
    (Array.isArray(body) ? body : [body]).forEach((d, j) => byKey.set(chunk[j], toWind(d)));
  }

  return points.map(p => byKey.get(keyOf(p))!);
}

// Cal OES aggregation of county evacuation zones. Only zones under an active order,
// warning, or shelter-in-place are published. Public, no key, refreshed every ~5 minutes.
const CALOES_QUERY =
  'https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/CA_EVACUATIONS_CalOESHosted_view/FeatureServer/0/query';

const CALOES_STATUS: Record<string, ZoneStatus> = {
  'evacuation order': 'order',
  'evacuation warning': 'warning',
  'shelter in place': 'shelter',
  advisory: 'advisory',
  normal: 'normal',
  repopulation: 'repopulation',
};

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

interface CalOesFeature {
  id?: number;
  geometry: GeoJSON.Geometry | null;
  properties: {
    ZONE_ID: string | null;
    COUNTY: string | null;
    CITY: string | null;
    ZONE_NAME: string | null;
    STATUS: string | null;
    NOTES: string | null;
    EDIT_DATE: number | null;
  };
}

// Some counties never clear old zones (e.g. Tulare flood orders from 2023 are still published).
// Every current incident has been edited within weeks, so treat anything older as stale.
const STALE_DAYS = 90;

export async function fetchActiveZones(): Promise<{ zones: Zone[]; stale: number }> {
  const features: CalOesFeature[] = [];

  for (let offset = 0; ; offset += 2000) {
    const params = new URLSearchParams({
      where: '1=1',
      outFields: 'ZONE_ID,COUNTY,CITY,ZONE_NAME,STATUS,NOTES,EDIT_DATE',
      outSR: '4326',
      geometryPrecision: '5',
      maxAllowableOffset: '0.0005', // ~50 m simplification: 1.7 MB -> ~110 KB
      resultOffset: String(offset),
      resultRecordCount: '2000',
      f: 'geojson',
    });
    const res = await fetch(`${CALOES_QUERY}?${params}`, { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`Cal OES returned ${res.status}`);
    const page = await res.json();
    if (page.error) throw new Error(`Cal OES error: ${page.error.message}`);

    features.push(...page.features);
    const more = page.exceededTransferLimit ?? page.properties?.exceededTransferLimit;
    if (!more || !page.features.length) break;
  }

  const cutoff = Date.now() - STALE_DAYS * 86_400_000;
  const polygons = features.filter(f => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon');
  const fresh = polygons.filter(f => !f.properties.EDIT_DATE || f.properties.EDIT_DATE >= cutoff);

  const zones = fresh
    .map((f, i): Zone => {
      const p = f.properties;
      const county = p.COUNTY ? titleCase(p.COUNTY) : null;
      return {
        // GeoJSON output carries no feature id, but ZONE_ID is unique and stable across refreshes.
        id: `caloes-${p.ZONE_ID ?? i}`,
        code: p.ZONE_ID ?? `unknown-${i}`,
        name: p.ZONE_NAME || (county ? `${county} County` : 'Unnamed zone'),
        population: null,
        status: CALOES_STATUS[(p.STATUS ?? '').toLowerCase()] ?? 'advisory',
        geom: f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
        origin: 'caloes',
        county,
        notes: p.NOTES?.trim() || null,
        updatedAt: p.EDIT_DATE ? new Date(p.EDIT_DATE).toISOString() : null,
      };
    });

  return { zones, stale: polygons.length - fresh.length };
}
