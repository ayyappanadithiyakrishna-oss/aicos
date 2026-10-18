import { describe, expect, it } from "vitest";
import { clusterArticles, type ClusterInput } from "@/lib/analysis/cluster";
import { canonicalUrl } from "@/lib/analysis/canonicalize";

const base = (o: Partial<ClusterInput>): ClusterInput => ({
  id: "a",
  title: "",
  excerpt: "",
  publishedAt: "2026-10-14T13:00:00Z",
  publisher: "Wire",
  entityIds: [],
  kindHint: null,
  isOriginalDisclosure: false,
  ...o,
});

describe("event clustering", () => {
  it("collapses syndicated copies of one event and counts echoes", () => {
    const items = [
      base({ id: "pr", title: "Acme Corp raises full-year outlook", excerpt: "Acme Corp raised its full-year revenue outlook on strong demand.", publisher: "Acme PR", entityIds: ["acme"], kindHint: "earnings", isOriginalDisclosure: true }),
      base({ id: "w1", title: "Acme raises full-year outlook on strong demand", excerpt: "Acme Corp raised its outlook, the wire reports.", publisher: "Wire A", entityIds: ["acme"], kindHint: "earnings", publishedAt: "2026-10-14T13:05:00Z" }),
      base({ id: "w2", title: "Acme lifts outlook", excerpt: "Shares of Acme rose after the company lifted guidance.", publisher: "Daily B", entityIds: ["acme"], kindHint: "earnings", publishedAt: "2026-10-14T14:00:00Z" }),
    ];
    const cl = clusterArticles(items);
    expect(cl).toHaveLength(1);
    expect(cl[0]!.novelty.originalCount).toBe(1);
    expect(cl[0]!.novelty.echoCount).toBe(2);
    expect(cl[0]!.novelty.firstReportPublisher).toBe("Acme PR");
  });

  it("never merges events about two different companies even with identical wording", () => {
    const cl = clusterArticles([
      base({ id: "x", title: "Company raises full-year outlook", excerpt: "The company raised its full-year outlook.", entityIds: ["acme"], kindHint: "earnings" }),
      base({ id: "y", title: "Company raises full-year outlook", excerpt: "The company raised its full-year outlook.", entityIds: ["globex"], kindHint: "earnings" }),
    ]);
    expect(cl).toHaveLength(2);
  });

  it("does not merge different event kinds for the same company", () => {
    const cl = clusterArticles([
      base({ id: "x", title: "Acme CEO to retire", excerpt: "Acme said its CEO will retire.", entityIds: ["acme"], kindHint: "company.leadership_change" }),
      base({ id: "y", title: "Acme authorizes buyback", excerpt: "Acme authorized a share repurchase.", entityIds: ["acme"], kindHint: "company.buyback", publishedAt: "2026-10-14T13:10:00Z" }),
    ]);
    expect(cl).toHaveLength(2);
  });

  it("merges entity-free reports of the same macro release", () => {
    const cl = clusterArticles([
      base({ id: "r", title: "CPI rises 3.4%", excerpt: "Official release.", kindHint: "macro.cpi", isOriginalDisclosure: true }),
      base({ id: "s", title: "Consumer prices hotter than expected", excerpt: "Traders reprice.", kindHint: "macro.cpi", publishedAt: "2026-10-14T13:09:00Z" }),
    ]);
    expect(cl).toHaveLength(1);
  });

  it("keeps cluster identity stable when later coverage joins", () => {
    const first = base({ id: "pr", title: "Acme raises outlook", excerpt: "Acme raised guidance.", entityIds: ["acme"], kindHint: "earnings", isOriginalDisclosure: true });
    const a = clusterArticles([first]);
    const b = clusterArticles([first, base({ id: "late", title: "Acme raises outlook again in focus", excerpt: "Acme guidance.", entityIds: ["acme"], kindHint: "earnings", publishedAt: "2026-10-14T15:00:00Z" })]);
    expect(b[0]!.id).toBe(a[0]!.id);
  });

  it("canonicalizes tracking parameters and AMP variants for dedup", () => {
    expect(canonicalUrl("https://www.Example.com/news/x/amp/?utm_source=t&id=2#frag")).toBe("https://example.com/news/x?id=2");
  });
});
