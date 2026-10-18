import { getEarningsAndFilings } from "@/lib/data/service";
import { json } from "@/lib/security/api";

export async function GET() {
  return json(await getEarningsAndFilings(), { cache: "short" });
}
