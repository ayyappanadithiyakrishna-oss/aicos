import { getRepository } from "@/lib/db/client";
import { requireUser } from "@/lib/api/account";
import { error, json } from "@/lib/security/api";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, res } = await requireUser(req, true);
  if (!user) return res;
  const { id } = await ctx.params;
  const ok = await getRepository().deleteWatchlist(user.id, id);
  return ok ? json({ deleted: id }) : error(404, "not_found", "Watchlist not found");
}
