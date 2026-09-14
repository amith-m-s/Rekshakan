import type { Fire, Wind } from './types';

export const DEFAULT_BBOX = '-123,36.5,-121,38';
export const MAP_CENTER = { lat: 37.05, lng: -122.05 };

export async function fetchFires(bbox = DEFAULT_BBOX): Promise<Fire[]> {
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${process.env.FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/${bbox}/2`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`FIRMS returned ${res.status}`);

  const csv = await res.text();
  const [head, ...rows] = csv.trim().split('\n');
  // FIRMS answers errors (bad key, bad bbox) with a plain-text line instead of a CSV header.
  if (!head?.startsWith('latitude')) throw new Error(`FIRMS error: ${head?.slice(0, 120)}`);
  const cols = head.split(',');

  return rows
    .filter(Boolean)
    .map(r => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v])) as Fire);
}

export async function fetchWeather(lat: number | string, lng: number | string) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&current=wind_speed_10m,wind_direction_10m`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
  return res.json();
}

// Open-Meteo reports the direction wind blows FROM; threatScore compares against the
// fire->zone bearing, so flip it to the direction the wind blows TOWARD.
export async function fetchWind(lat: number, lng: number): Promise<Wind> {
  const data = await fetchWeather(lat, lng);
  return {
    speed: data.current.wind_speed_10m,
    direction: (data.current.wind_direction_10m + 180) % 360,
  };
}
