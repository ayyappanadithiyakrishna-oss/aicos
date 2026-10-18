import { getEvent } from "@/lib/data/service";
import { error, json } from "@/lib/security/api";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-z0-9_-]{3,80}$/i.test(id)) return error(400, "invalid_id", "Malformed event id");
  const res = await getEvent(id);
  if (!res) return error(404, "not_found", "Event not found");
  return json(res, { cache: "short" });
}
