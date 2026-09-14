import { updateZoneStatus } from '@/lib/data';
import { ZONE_STATUSES, type ZoneStatus } from '@/lib/types';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status } = await req.json().catch(() => ({}));
  if (!ZONE_STATUSES.includes(status)) {
    return Response.json({ error: `status must be one of ${ZONE_STATUSES.join(', ')}` }, { status: 400 });
  }

  try {
    const { source } = await updateZoneStatus(id, status as ZoneStatus);
    return Response.json({ id, status, source });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}
