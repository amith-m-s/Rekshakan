import { DEFAULT_BBOX, fetchFires } from '@/lib/sources';

export const revalidate = 300;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bbox = searchParams.get('bbox') ?? DEFAULT_BBOX;
  try {
    return Response.json(await fetchFires(bbox));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
