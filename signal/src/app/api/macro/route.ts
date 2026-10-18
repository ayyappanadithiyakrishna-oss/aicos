import { getMacro } from "@/lib/data/service";
import { json } from "@/lib/security/api";

export async function GET() {
  return json(await getMacro(), { cache: "short" });
}
