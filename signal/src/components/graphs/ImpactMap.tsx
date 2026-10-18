"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";
import type { MechanismEdge, MechanismGraph, MechanismNode } from "@/lib/domain/types";
import { RELATIONSHIP_LABEL } from "@/lib/format";

const COL_W = 196;
const NODE_W = 160;
const NODE_H = 40;
const ROW_GAP = 16;

function layout(g: MechanismGraph) {
  const depth = new Map<string, number>();
  const root = g.nodes.find((n) => n.kind === "event")?.id ?? g.nodes[0]?.id;
  if (root) depth.set(root, 0);
  // Longest-path layering (graph is a small DAG).
  for (let iter = 0; iter < g.nodes.length; iter++) {
    let changed = false;
    for (const e of g.edges) {
      const d = depth.get(e.from);
      if (d === undefined) continue;
      if ((depth.get(e.to) ?? -1) < d + 1) {
        depth.set(e.to, d + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const n of g.nodes) if (!depth.has(n.id)) depth.set(n.id, 1);
  // Securities always sit in the last column.
  const maxD = Math.max(...depth.values());
  for (const n of g.nodes) if (n.kind === "security") depth.set(n.id, maxD);
  const cols = new Map<number, MechanismNode[]>();
  for (const n of g.nodes) {
    const d = depth.get(n.id)!;
    cols.set(d, [...(cols.get(d) ?? []), n]);
  }
  const maxRows = Math.max(...[...cols.values()].map((c) => c.length));
  const height = Math.max(160, maxRows * (NODE_H + ROW_GAP) + 24);
  const pos = new Map<string, { x: number; y: number }>();
  for (const [d, nodes] of cols) {
    const total = nodes.length * NODE_H + (nodes.length - 1) * ROW_GAP;
    const top = (height - total) / 2;
    nodes.forEach((n, i) => pos.set(n.id, { x: 12 + d * COL_W, y: top + i * (NODE_H + ROW_GAP) }));
  }
  return { pos, width: 12 + (maxD + 1) * COL_W - (COL_W - NODE_W) + 12, height };
}

const signColor = (s: MechanismEdge["sign"]) => (s === "positive" ? "var(--pos)" : s === "negative" ? "var(--neg)" : "var(--warn)");
const signText = (s: MechanismEdge["sign"]) => (s === "positive" ? "raises" : s === "negative" ? "lowers" : "mixed effect on");

export function ImpactMap({ graph, evidenceLabels }: { graph: MechanismGraph; evidenceLabels?: Record<string, string> }) {
  const { pos, width, height } = useMemo(() => layout(graph), [graph]);
  const [active, setActive] = useState<{ kind: "node" | "edge"; id: string } | null>(null);
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const activeEdges = new Set(active?.kind === "edge" ? [active.id] : active?.kind === "node" ? graph.edges.filter((e) => e.from === active.id || e.to === active.id).map((e) => e.id) : []);
  const detailEdge = active?.kind === "edge" ? graph.edges.find((e) => e.id === active.id) : null;
  const detailNode = active?.kind === "node" ? byId.get(active.id) : null;

  return (
    <div>
      <div className="hidden overflow-x-auto rounded-md border border-line bg-bg/50 sm:block" tabIndex={0} role="region" aria-label="Transmission graph">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMinYMid meet" role="group" aria-label="Transmission graph from event to exposed assets" className="grid-bg block h-auto w-full" style={{ minWidth: Math.min(width, 640) }}>
          <defs>
            {(["positive", "negative", "mixed"] as const).map((s) => (
              <marker key={s} id={`arrow-${s}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" fill={signColor(s)} />
              </marker>
            ))}
          </defs>
          {graph.edges.map((e) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x - 2;
            const y2 = b.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            const on = activeEdges.has(e.id);
            const dim = active && !on;
            return (
              <g key={e.id}>
                <path
                  d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                  fill="none"
                  stroke={signColor(e.sign)}
                  strokeWidth={on ? 2.4 : 1.5}
                  strokeDasharray={e.hypothesized ? "4 4" : undefined}
                  opacity={dim ? 0.18 : on ? 1 : 0.7}
                  markerEnd={`url(#arrow-${e.sign})`}
                />
                <path
                  d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12}
                  tabIndex={0}
                  role="button"
                  aria-label={`${byId.get(e.from)?.label} ${signText(e.sign)} ${byId.get(e.to)?.label}: ${e.rationale}${e.hypothesized ? " (hypothesized)" : ""}`}
                  onMouseEnter={() => setActive({ kind: "edge", id: e.id })}
                  onFocus={() => setActive({ kind: "edge", id: e.id })}
                  className="cursor-pointer outline-none"
                />
              </g>
            );
          })}
          {graph.nodes.map((n) => {
            const p = pos.get(n.id)!;
            const isActive = active?.kind === "node" && active.id === n.id;
            const connected = active && (isActive || graph.edges.some((e) => activeEdges.has(e.id) && (e.from === n.id || e.to === n.id)));
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                tabIndex={0}
                role="button"
                aria-label={`${n.kind}: ${n.label}${n.observed ? `, observed ${n.observed.changeLabel}` : ""}`}
                onMouseEnter={() => setActive({ kind: "node", id: n.id })}
                onFocus={() => setActive({ kind: "node", id: n.id })}
                className="cursor-pointer outline-none"
                opacity={active && !connected ? 0.35 : 1}
              >
                <rect width={NODE_W} height={NODE_H} rx={6} fill={n.kind === "event" ? "var(--accent-dim)" : "var(--surface)"} stroke={isActive ? "var(--accent)" : n.kind === "event" ? "var(--accent)" : "var(--line-2)"} />
                <text x={10} y={16} fontSize={9.5} fill="var(--ink-3)" fontFamily="var(--ff-mono)" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {n.kind === "security" ? "asset" : n.kind}
                </text>
                <text x={10} y={31} fontSize={12} fill="var(--ink)" fontFamily={n.kind === "security" ? "var(--ff-mono)" : "var(--ff-sans)"} fontWeight={n.kind === "security" ? 600 : 500}>
                  {n.label.length > 24 ? `${n.label.slice(0, 23)}…` : n.label}
                </text>
                {n.observed ? (
                  <text x={NODE_W - 8} y={16} fontSize={9.5} textAnchor="end" fill="var(--ink-2)" fontFamily="var(--ff-mono)">
                    {n.observed.changeLabel.split(" ")[0]}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Detail panel (also the keyboard/touch path). */}
      <div className="mt-3 min-h-[86px] rounded-md border border-line bg-surface p-3 text-sm" aria-live="polite">
        {detailEdge ? (
          <div>
            <div className="text-2xs text-ink-3">
              {RELATIONSHIP_LABEL[detailEdge.relationship]} · {detailEdge.directness === "direct" ? "direct" : "second-order"} · lag {detailEdge.lag} · uncertainty {detailEdge.uncertainty}
              {detailEdge.hypothesized ? <span className="text-warn"> · hypothesized</span> : null}
            </div>
            <p className="mt-1 text-ink">
              {byId.get(detailEdge.from)?.label} <span style={{ color: signColor(detailEdge.sign) }}>{signText(detailEdge.sign)}</span> {byId.get(detailEdge.to)?.label}
            </p>
            <p className="mt-0.5 text-ink-2">{detailEdge.rationale}</p>
            {detailEdge.evidenceIds.length ? <p className="mt-1 text-2xs text-ink-3">Evidence: {detailEdge.evidenceIds.map((id) => evidenceLabels?.[id] ?? id).join(", ")}</p> : null}
          </div>
        ) : detailNode ? (
          <div>
            <div className="text-2xs text-ink-3">{detailNode.kind === "security" ? "Exposed asset" : detailNode.kind}</div>
            <p className="mt-1 text-ink">{detailNode.label}</p>
            {detailNode.observed ? <p className="mt-0.5 text-ink-2">Observed: {detailNode.observed.changeLabel} ({detailNode.observed.provenance === "synthetic" ? "synthetic price path" : "observed"}) — co-movement, not causal attribution.</p> : null}
            {detailNode.kind === "security" ? (
              <div className="mt-1 flex gap-3 text-xs">
                <Link href={`/ticker/${detailNode.label}`} className="text-accent hover:underline">
                  Open {detailNode.label}
                </Link>
                <Link href={`/?q=${detailNode.label}`} className="text-accent hover:underline">
                  Filter feed by {detailNode.label}
                </Link>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-ink-3">Hover or focus a node or link to see its evidence, direction, lag and confidence. Dashed links are hypothesized.</p>
        )}
      </div>

      {/* Small screens: the same graph as readable paths. */}
      <ol className="mt-3 space-y-1.5 sm:hidden">
        {graph.edges.map((e) => (
          <li key={e.id} className={clsx("rounded-md border border-line bg-surface p-2 text-xs", e.hypothesized && "border-dashed")}>
            <span className="text-ink">{byId.get(e.from)?.label}</span> <span style={{ color: signColor(e.sign) }}>→ {signText(e.sign)}</span> <span className="text-ink">{byId.get(e.to)?.label}</span>
            <div className="mt-0.5 text-ink-3">
              {e.rationale}
              {e.hypothesized ? " · hypothesized" : ""}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
