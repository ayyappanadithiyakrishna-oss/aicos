import { executeIngest } from "@/lib/api/jobs";
import { adminAuthorized, cronAuthorized } from "@/lib/security/auth";
import { error } from "@/lib/security/api";

export const maxDuration = 60;

/** Operator-triggered ingest. Accepts no URLs or payloads — it only runs the configured providers. */
export async function POST(req: Request) {
  if (!adminAuthorized(req) && !cronAuthorized(req)) return error(401, "unauthorized", "Missing or invalid admin authorization");
  return executeIngest("admin");
}
