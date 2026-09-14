export const revalidate = 300;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bbox = searchParams.get('bbox') ?? '-123,36.5,-121,38';
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${process.env.FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/${bbox}/2`;

  const csv = await fetch(url, { next: { revalidate: 300 } }).then(r => r.text());
  const [head, ...rows] = csv.trim().split('\n');
  const cols = head.split(',');

  return Response.json(
    rows.filter(Boolean).map(r => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v])))
  );
}
