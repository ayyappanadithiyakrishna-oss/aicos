import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db/client", async () => {
  const { MemoryRepository } = await import("@/lib/db/repo");
  const repo = new MemoryRepository();
  return { getRepository: () => repo };
});
import { getRepository } from "@/lib/db/client";
import { getDemoWorld } from "@/lib/demo/world";
import { liveArchive } from "@/lib/data/liveService";

afterEach(() => vi.useRealTimers());
it("live forecast archive advances across changing request times", async () => {
  const world = await getDemoWorld();
  const forecasts = world.events.flatMap((e) => e.forecasts);
  await getRepository().insertForecasts(forecasts);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  const first = await liveArchive({ limit: 2 });
  expect(first.nextCursor).toBeTruthy();
  vi.setSystemTime(new Date("2026-10-20T12:01:00Z"));
  const second = await liveArchive({ limit: 2, cursor: first.nextCursor! });
  expect(second.rows).toHaveLength(2);
  expect(second.rows.some((r) => first.rows.some((p) => p.forecast.id === r.forecast.id))).toBe(false);
});
