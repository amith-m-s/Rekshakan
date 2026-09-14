// from/to are "lng,lat" strings.
const LNG_LAT = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to || !LNG_LAT.test(from) || !LNG_LAT.test(to)) {
    return Response.json({ error: 'from and to are required as "lng,lat"' }, { status: 400 });
  }

  const url = `https://router.project-osrm.org/route/v1/driving/${from};${to}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.code !== 'Ok' || !data.routes?.length) {
    return Response.json({ error: data.message ?? `OSRM returned ${data.code ?? res.status}` }, { status: 502 });
  }

  return Response.json(data.routes[0].geometry);
}
