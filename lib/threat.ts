import { centroid, distance, bearing } from '@turf/turf';
import type { Zone, Fire, Wind } from './types';

export function threatScore(zone: Zone, fires: Fire[], wind: Wind, maxPop: number) {
  const c = centroid(zone.geom);
  let nearest = { km: Infinity, bear: 0 };

  for (const f of fires) {
    const p = { type: 'Point' as const, coordinates: [+f.longitude, +f.latitude] };
    const km = distance(p, c, { units: 'kilometers' });
    if (km < nearest.km) nearest = { km, bear: bearing(p, c) };
  }

  const proximity = Math.max(0, 1 - nearest.km / 20);
  const delta = ((nearest.bear - wind.direction + 540) % 360) - 180;
  const alignment = Math.max(0, Math.cos((delta * Math.PI) / 180));
  const exposure = maxPop ? zone.population / maxPop : 0;

  const score = 0.6 * proximity + 0.3 * alignment * proximity + 0.1 * exposure;

  return { score: +score.toFixed(3), proximity, alignment, exposure, km: nearest.km };
}
