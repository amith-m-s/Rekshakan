import { area, centroid } from '@turf/turf';
import { getZones } from './data';
import { fetchActiveZones, fetchFires, fetchWinds } from './sources';
import { threatScore } from './threat';
import type { Fire, ScoredZone, Wind, Zone, ZonesResponse } from './types';

// Scoring every zone takes a few seconds (Cal OES, FIRMS, Open-Meteo), and none of those sources
// change faster than every few minutes, so share one result per server instance for a minute.
const TTL_MS = 60_000;
let cached: { at: number; body: Promise<ZonesResponse> } | null = null;

export function getScoredZones(): Promise<ZonesResponse> {
  if (!cached || Date.now() - cached.at > TTL_MS) {
    const body = computeScoredZones();
    cached = { at: Date.now(), body };
    body.catch(() => (cached = null));
  }
  return cached.body;
}

// Call after a zone status change so the next request reflects it.
export function invalidateScoredZones() {
  cached = null;
}

async function computeScoredZones(): Promise<ZonesResponse> {
  const [demo, live, fires] = await Promise.all([
    getZones(),
    fetchActiveZones()
      .then(({ zones, stale }) => ({ zones, stale, ok: true }))
      .catch((e): { zones: Zone[]; stale: number; ok: boolean } => {
        console.warn('[zones] Cal OES unavailable:', e.message);
        return { zones: [], stale: 0, ok: false };
      }),
    fetchFires().catch((e): Fire[] => (console.warn('[zones] fires unavailable:', e.message), [])),
  ]);

  const zones = [...live.zones, ...demo.zones];
  const centers = zones.map(z => {
    const [lng, lat] = centroid(z.geom).geometry.coordinates;
    return { lat, lng };
  });
  const winds = await fetchWinds(centers).catch((e): (Wind | null)[] => {
    console.warn('[zones] wind unavailable:', e.message);
    return zones.map(() => null);
  });

  const maxPop = Math.max(0, ...zones.map(z => z.population ?? 0));
  const scored: ScoredZone[] = zones
    .map((z, i) => {
      const wind = winds[i];
      const t = threatScore(z, fires, wind ?? { speed: 0, direction: 0 }, maxPop);
      // Without wind data, drop the alignment term rather than scoring against a fake direction.
      const threat = wind
        ? t
        : { ...t, alignment: 0, score: +(0.6 * t.proximity + 0.1 * t.exposure).toFixed(3) };
      return {
        ...z,
        threat: { ...threat, km: Number.isFinite(t.km) ? t.km : null },
        wind,
        areaKm2: +(area(z.geom) / 1e6).toFixed(2),
      };
    })
    .sort((a, b) => b.threat.score - a.threat.score);

  return {
    zones: scored,
    fireCount: fires.length,
    sources: { live: live.ok ? 'caloes' : 'unavailable', demo: demo.source, staleHidden: live.stale },
  };
}
