export const dynamic = "force-dynamic";

/* GET /api/status — drives the sidebar AI/DATA indicators. */
export async function GET() {
  return Response.json(
    { aiLive: !!process.env.ANTHROPIC_API_KEY, dataLive: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
