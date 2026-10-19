import { describe, expect, it } from "vitest";
import { getDemoWorld } from "@/lib/demo/world";
import { queryFeed, CATEGORIES } from "@/lib/data/feedQuery";

describe("feed snapshots", () => {
  it("advances to a disjoint next page when the live request clock has moved", async () => {
    const w = await getDemoWorld();
    const first = queryFeed(w.events, { limit: 4 }, w.anchor);
    expect(first.nextCursor).toBeTruthy();
    const second = queryFeed(w.events, { limit: 4, cursor: first.nextCursor! }, new Date(w.anchor.getTime() + 60_000));
    const expected = queryFeed(w.events, { limit: 8 }, w.anchor).items.slice(4).map((e) => e.id);
    expect(second.items.map((e) => e.id)).toEqual(expected);
    expect(second.items.some((e) => first.items.some((p) => p.id === e.id))).toBe(false);
  });
  it("does not shift page two when a newly published event arrives", async () => {
    const w = await getDemoWorld();
    const first = queryFeed(w.events, { limit: 4 }, w.anchor);
    const added = { ...w.events[0]!, id: "later", firstPublishedAt: new Date(w.anchor.getTime() + 1000).toISOString() };
    const second = queryFeed([added, ...w.events], { limit: 4, cursor: first.nextCursor! }, new Date(w.anchor.getTime() + 60_000));
    expect(second.items.map((e) => e.id)).toEqual(queryFeed(w.events, { limit: 8 }, w.anchor).items.slice(4).map((e) => e.id));
  });
  it("does not classify every company with a sector as sector news", async () => {
    const w = await getDemoWorld();
    const company = { ...w.events[0]!, eventType: "other" as const, sectors: ["Technology"] };
    expect(CATEGORIES.find((c) => c.key === "sector")!.match(company)).toBe(false);
  });
});
