import { getScoredZones } from '@/lib/zones';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await getScoredZones());
}
