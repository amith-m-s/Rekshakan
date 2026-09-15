import { createHash } from 'node:crypto';
import { inCalifornia } from '@/lib/california';
import { allowReport, listReports, saveReport } from '@/lib/data';
import { REPORT_KINDS } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await listReports());
}

// Salted hash of the caller's IP, used only for rate limiting.
function clientHash(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  return createHash('sha256').update(`rescuermap:${ip}`).digest('hex').slice(0, 32);
}

// Intended for the mobile app: { kind, message, lat, lng, reporter? }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const lat = Number(body.lat);
  const lng = Number(body.lng);

  if (!REPORT_KINDS.includes(body.kind)) {
    return Response.json({ error: `kind must be one of ${REPORT_KINDS.join(', ')}` }, { status: 400 });
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inCalifornia(lat, lng)) {
    return Response.json({ error: 'lat/lng must be numbers inside California' }, { status: 400 });
  }
  if (!(await allowReport(clientHash(req)))) {
    return Response.json({ error: 'too many reports, try again shortly' }, { status: 429, headers: { 'Retry-After': '60' } });
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
