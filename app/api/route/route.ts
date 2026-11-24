import { parseLngLat } from '../../../lib/route-coordinates.mjs';

const OSRM_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLineStringGeometry(
  value: unknown,
): value is { type: 'LineString'; coordinates: [number, number][] } {
  if (
    !isRecord(value) ||
    value.type !== 'LineString' ||
    !Array.isArray(value.coordinates) ||
    value.coordinates.length < 2
  ) {
    return false;
  }

  return value.coordinates.every(
    (point) =>
      Array.isArray(point) &&
      point.length === 2 &&
      point.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)),
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = parseLngLat(searchParams.get('from'));
  const to = parseLngLat(searchParams.get('to'));
  if (!from || !to) {
    return Response.json({ error: 'from and to must be valid "longitude,latitude" pairs' }, { status: 400 });
  }

  const url = `https://router.project-osrm.org/route/v1/driving/${from.join(',')};${to.join(',')}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(OSRM_TIMEOUT_MS) });
    const data: unknown = await res.json().catch(() => null);
    const firstRoute = isRecord(data) && Array.isArray(data.routes) ? data.routes[0] : null;
    const geometry = isRecord(firstRoute) ? firstRoute.geometry : null;

    if (!res.ok || !isRecord(data) || data.code !== 'Ok' || !isLineStringGeometry(geometry)) {
      let message = `OSRM returned HTTP ${res.status} or an invalid response`;
      if (isRecord(data)) {
        if (typeof data.message === 'string') message = data.message;
        else if (typeof data.code === 'string') message = `OSRM returned ${data.code}`;
      }
      return Response.json({ error: message }, { status: 502 });
    }

    return Response.json(geometry);
  } catch {
    return Response.json({ error: 'Routing service unavailable or timed out' }, { status: 502 });
  }
}
