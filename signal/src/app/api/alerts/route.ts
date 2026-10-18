import { randomUUID } from "node:crypto";
import { getRepository } from "@/lib/db/client";
import { AlertBody, requireUser } from "@/lib/api/account";
import { json, parseBody } from "@/lib/security/api";

export async function GET(req: Request) {
  const { user, res } = await requireUser(req);
  if (!user) return res;
  return json({ alerts: await getRepository().listAlerts(user.id) });
}

export async function POST(req: Request) {
  const { user, res } = await requireUser(req, true);
  if (!user) return res;
  const body = await parseBody(req, AlertBody);
  if (!body.ok) return body.res;
  const { id, paused, digest, ...rule } = body.data;
  const a = { id: id ?? randomUUID().slice(0, 12), userId: user.id, rule, paused, digest, createdAt: new Date().toISOString() };
  await getRepository().upsertAlert(a);
  return json({ alert: a }, { status: 201 });
}
