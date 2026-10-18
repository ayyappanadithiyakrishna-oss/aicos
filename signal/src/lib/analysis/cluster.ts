/**
 * Event clustering. Syndicated and derivative reports about the same underlying event collapse
 * into one cluster; reports about different companies never merge even when worded alike.
 *
 * Merge rule (union-find over pairs within a time window):
 *   - entity sets both non-empty and disjoint  → never merge
 *   - different event-kind hints (both set)    → never merge
 *   - text Jaccard ≥ STRONG                    → merge
 *   - same specific kind + (shared entity | both entity-free) within 12h → merge
 *   - shared entity + Jaccard ≥ WEAK                → merge
 */
import type { Novelty } from "@/lib/domain/types";
import { jaccard, shingles } from "./canonicalize";
import { hashHex } from "@/lib/quant/stats";

export const CLUSTER_WINDOW_HOURS = 36;
export const STRONG_SIMILARITY = 0.55;
export const WEAK_SIMILARITY = 0.2;
export const SAME_EVENT_HOURS = 12;

export interface ClusterInput {
  id: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  publisher: string;
  entityIds: string[];
  kindHint: string | null;
  isOriginalDisclosure: boolean;
}

export interface ArticleCluster {
  id: string;
  articleIds: string[];
  entityIds: string[];
  kindHint: string | null;
  firstPublishedAt: string;
  novelty: Novelty;
}

class UnionFind {
  private readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]!]!;
      i = this.parent[i]!;
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/** Clustering granularity: earnings and M&A sub-kinds describe one event; others stay specific. */
export function clusterKind(subtype: string): string {
  if (subtype.startsWith("earnings.")) return "earnings";
  if (subtype.startsWith("ma.")) return "ma";
  return subtype;
}

export function shouldMerge(a: ClusterInput, b: ClusterInput, sim: number): boolean {
  const ea = new Set(a.entityIds);
  const eb = new Set(b.entityIds);
  const shared = [...ea].some((x) => eb.has(x));
  if (ea.size && eb.size && !shared) return false;
  if (a.kindHint && b.kindHint && a.kindHint !== b.kindHint) return false;
  const hours = Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt)) / 3_600_000;
  if (hours > CLUSTER_WINDOW_HOURS) return false;
  if (sim >= STRONG_SIMILARITY) return true;
  const specificSameKind = Boolean(a.kindHint) && a.kindHint === b.kindHint && !a.kindHint!.startsWith("other.");
  // Same company + same specific event kind within half a day is the same event, however worded.
  if (shared && specificSameKind && hours <= SAME_EVENT_HOURS) return true;
  // Entity-free events (macro releases, commodity shocks) merge on a shared specific kind.
  const entityFree = !ea.size && !eb.size;
  if (entityFree && specificSameKind && hours <= SAME_EVENT_HOURS) return true;
  return shared && sim >= WEAK_SIMILARITY;
}

export function clusterArticles(items: readonly ClusterInput[]): ArticleCluster[] {
  const sh = items.map((x) => shingles(`${x.title} ${x.excerpt}`));
  const uf = new UnionFind(items.length);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (shouldMerge(items[i]!, items[j]!, jaccard(sh[i]!, sh[j]!))) uf.union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  items.forEach((_, i) => {
    const r = uf.find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  });
  const clusters: ArticleCluster[] = [];
  for (const idxs of groups.values()) {
    const members = idxs.map((i) => items[i]!).sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
    const first = members[0]!;
    const publishers = new Set(members.map((m) => m.publisher));
    const originals = members.filter((m) => m.isOriginalDisclosure);
    const originalCount = Math.max(1, originals.length);
    const echoCount = members.length - originalCount;
    clusters.push({
      // Stable identity: keyed on the earliest report so later coverage joins the same event.
      id: `cl_${hashHex(first.id)}`,
      articleIds: members.map((m) => m.id),
      entityIds: [...new Set(members.flatMap((m) => m.entityIds))],
      kindHint: members.find((m) => m.kindHint)?.kindHint ?? null,
      firstPublishedAt: first.publishedAt,
      novelty: {
        // One catalyst reported 19 times is still one catalyst: echoes do not raise novelty.
        score: originals.length ? 1 : Math.max(0.35, 1 - 0.1 * (publishers.size - 1)),
        originalCount,
        echoCount,
        distinctPublishers: publishers.size,
        firstReportAt: first.publishedAt,
        firstReportPublisher: (originals[0] ?? first).publisher,
      },
    });
  }
  return clusters.sort((a, b) => Date.parse(b.firstPublishedAt) - Date.parse(a.firstPublishedAt));
}
