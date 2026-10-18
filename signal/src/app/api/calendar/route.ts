import { getCalendar, getRibbon } from "@/lib/data/service";
import { json } from "@/lib/security/api";

export async function GET() {
  const [items, ribbon] = await Promise.all([getCalendar(), getRibbon()]);
  return json({ mode: ribbon.mode, items }, { cache: "short" });
}
