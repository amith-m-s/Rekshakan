import { listReports, saveReport } from '@/lib/data';
import { REPORT_KINDS } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Rough California bounding box; field reports outside it are rejected.
const CA = { minLat: 32.5, maxLat: 42.1, minLng: -124.5, maxLng: -114.1 };

export async function GET() {
  return Response.json(await listReports());
}

// Intended for the mobile app: { kind, message, lat, lng, reporter? }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const lat = Number(body.lat);
  const lng = Number(body.lng);

  if (!REPORT_KINDS.includes(body.kind)) {
    return Response.json({ error: `kind must be one of ${REPORT_KINDS.join(', ')}` }, { status: 400 });
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < CA.minLat || lat > CA.maxLat || lng < CA.minLng || lng > CA.maxLng) {
    return Response.json({ error: 'lat/lng must be numbers inside California' }, { status: 400 });
  }

  const report = await saveReport({
    kind: body.kind,
    message: String(body.message ?? '').slice(0, 500),
    lat,
    lng,
    reporter: body.reporter ? String(body.reporter).slice(0, 80) : null,
  });
  return Response.json(report, { status: 201 });
}
