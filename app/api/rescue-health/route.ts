export const dynamic = "force-dynamic";

export async function GET() {
  const baseUrl =
    process.env.RESCUERMAP_API_URL ||
    process.env.NEXT_PUBLIC_RESCUERMAP_API_URL ||
    "http://localhost:4000";
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    if (!response.ok) throw new Error("Rescue API health check failed");
    return Response.json({ online: body?.data?.service === "up" });
  } catch {
    return Response.json({ online: false }, { status: 503 });
  }
}
