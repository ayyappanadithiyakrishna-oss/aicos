import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { PgRepository } from "./pgRepo";
import { MemoryRepository, type Repository } from "./repo";

let repo: Repository | null = null;

/**
 * Postgres (Neon serverless HTTP driver — safe for short-lived functions, no pooled sockets held)
 * when DATABASE_URL is set; otherwise an ephemeral per-instance memory store.
 */
export function getRepository(): Repository {
  if (repo) return repo;
  const url = process.env.DATABASE_URL;
  if (url) {
    const db = drizzle(neon(url), { schema });
    repo = new PgRepository(db as never);
  } else {
    repo = new MemoryRepository();
  }
  return repo;
}
