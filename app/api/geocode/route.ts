// Nominatim's usage policy requires an identifying User-Agent with contact info.
const USER_AGENT = 'RescuerMapHackathon/1.0 (contact: REPLACE_WITH_MY_EMAIL)';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');
  if (!q) return Response.json({ error: 'q is required' }, { status: 400 });

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return Response.json({ error: `Nominatim returned ${res.status}` }, { status: 502 });

  const results: { lat: string; lon: string }[] = await res.json();
  if (!results.length) return Response.json({ error: `No results for "${q}"` }, { status: 404 });

  return Response.json({ lat: +results[0].lat, lon: +results[0].lon });
}
