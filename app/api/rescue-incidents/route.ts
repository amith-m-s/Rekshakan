export const dynamic = 'force-dynamic';

// Incidents from the rescue operations API, for the map layer. Aggregates only (no personal locations).
export async function GET() {
  const baseUrl = process.env.RESCUERMAP_API_URL || process.env.NEXT_PUBLIC_RESCUERMAP_API_URL || 'http://localhost:4000';
  try {
    const response = await fetch(`${baseUrl}/api/public/incidents`, {
      cache: 'no-store',
      // The free Render service may be waking up.
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json();
    if (!response.ok || !body?.success) throw new Error('Rescue API unavailable');
    return Response.json({ online: true, incidents: body.data });
  } catch {
    return Response.json({ online: false, incidents: [] }, { status: 503 });
  }
}
