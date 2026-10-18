/** Seed reference data (sources + their licence flags) for live mode. Idempotent. */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../src/lib/db/schema";
import { liveConfig, liveSources } from "../src/lib/live/registry";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = drizzle(neon(url), { schema });
  for (const s of liveSources(liveConfig())) {
    await db
      .insert(schema.sources)
      .values({ id: s.id, name: s.name, kind: s.kind, reliability: s.reliability, homepage: s.homepage, displayLicensed: s.displayLicensed, permittedFields: s.permittedFields })
      .onConflictDoUpdate({ target: schema.sources.id, set: { displayLicensed: s.displayLicensed, reliability: s.reliability } });
  }
  console.log("Seeded sources.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
