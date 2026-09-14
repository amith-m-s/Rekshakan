export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  if (!lat || !lng) return Response.json({ error: 'lat and lng are required' }, { status: 400 });

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&current=wind_speed_10m,wind_direction_10m`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) return Response.json({ error: `Open-Meteo returned ${res.status}` }, { status: 502 });

  return Response.json(await res.json());
}
