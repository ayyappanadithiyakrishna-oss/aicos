import { executeResolve } from "@/lib/api/jobs";
import { cronAuthorized } from "@/lib/security/auth";
import { error } from "@/lib/security/api";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return error(401, "unauthorized", "Missing or invalid cron authorization");
  return executeResolve();
}
