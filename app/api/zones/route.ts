import { getZones } from '@/lib/data';
import { fetchFires, fetchWind, MAP_CENTER } from '@/lib/sources';
import { threatScore } from '@/lib/threat';
import type { Fire, Wind, ZonesResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [{ zones, source }, fires, wind] = await Promise.all([
    getZones(),
    fetchFires().catch((e): Fire[] => (console.warn('[zones] fires unavailable:', e.message), [])),
    fetchWind(MAP_CENTER.lat, MAP_CENTER.lng).catch((e): Wind => (console.warn('[zones] wind unavailable:', e.message), { speed: 0, direction: 0 })),
  ]);

  const maxPop = Math.max(0, ...zones.map(z => z.population));
  const scored = zones
    .map(z => {
      const t = threatScore(z, fires, wind, maxPop);
      return { ...z, threat: { ...t, km: Number.isFinite(t.km) ? t.km : null } };
    })
    .sort((a, b) => b.threat.score - a.threat.score);

  const body: ZonesResponse = { zones: scored, wind, fireCount: fires.length, source };
  return Response.json(body);
}
