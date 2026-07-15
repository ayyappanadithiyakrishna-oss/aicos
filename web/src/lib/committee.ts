/* ============================================================
   AICOS Committee — agent definitions + debate model.

   This is the front-end domain model for the signature committee
   experience. The debate is generated deterministically per ticker
   so the UI can demo end-to-end without a backend; the same shapes
   map onto the streaming orchestrator (orchestrator/committee) when
   live agent output is wired in.
   ============================================================ */

export type Verdict =
  | "BUY"
  | "WATCHLIST"
  | "SPECULATIVE"
  | "REDUCE"
  | "SELL";

export type Stance = "bull" | "bear" | "neutral";

export type AgentId =
  | "marcus"
  | "diana"
  | "raymond"
  | "priya"
  | "solomon"
  | "chair";

export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  mandate: string;
  stance: Stance;
  initials: string;
}

export const AGENTS: Agent[] = [
  {
    id: "marcus",
    name: "Marcus",
    role: "The Bull",
    mandate: "Find asymmetric upside",
    stance: "bull",
    initials: "MB",
  },
  {
    id: "diana",
    name: "Diana",
    role: "The Bear",
    mandate: "Destroy weak theses",
    stance: "bear",
    initials: "DB",
  },
  {
    id: "raymond",
    name: "Raymond",
    role: "The Quant",
    mandate: "Only mathematics and evidence",
    stance: "neutral",
    initials: "RQ",
  },
  {
    id: "priya",
    name: "Priya",
    role: "Macro Strategist",
    mandate: "Evaluate external forces",
    stance: "neutral",
    initials: "PM",
  },
  {
    id: "solomon",
    name: "Solomon",
    role: "Chief Risk Officer",
    mandate: "Protect capital at all costs",
    stance: "bear",
    initials: "SR",
  },
  {
    id: "chair",
    name: "The Chair",
    role: "Final decision-maker",
    mandate: "Weigh evidence. No bias.",
    stance: "neutral",
    initials: "CH",
  },
];

export const AGENT_MAP: Record<AgentId, Agent> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a]),
) as Record<AgentId, Agent>;

export type Phase =
  | "convene"
  | "opening"
  | "cross"
  | "synthesis"
  | "verdict";

export interface DebateLine {
  id: string;
  agent: AgentId;
  phase: Phase;
  /** Optional agent this line is challenging. */
  rebuts?: AgentId;
  kind: "statement" | "challenge" | "concession" | "evidence" | "ruling";
  text: string;
}

export interface AgentScore {
  agent: AgentId;
  /** Headline score 0–100 (conviction / bear score / risk rating …). */
  score: number;
  label: string;
  signal: "buy" | "sell" | "hold" | "reduce" | "avoid";
  bullets: string[];
}

export interface Decision {
  ticker: string;
  company: string;
  verdict: Verdict;
  confidence: number; // 0–100
  priceTarget: number;
  stop: number;
  maxAllocationPct: number;
  thesis: string;
  killConditions: string[];
}

export interface Debate {
  ticker: string;
  company: string;
  lines: DebateLine[];
  scores: AgentScore[];
  decision: Decision;
}

/* ---------- deterministic per-ticker generation ---------- */

const COMPANIES: Record<string, string> = {
  NVDA: "NVIDIA Corporation",
  AAPL: "Apple Inc.",
  TSLA: "Tesla, Inc.",
  MSFT: "Microsoft Corporation",
  AMD: "Advanced Micro Devices",
  GOOGL: "Alphabet Inc.",
  META: "Meta Platforms, Inc.",
  AMZN: "Amazon.com, Inc.",
};

/** Cheap deterministic hash so the same ticker always rules the same way. */
function seed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pick<T>(arr: T[], n: number): T {
  return arr[n % arr.length];
}

export function buildDebate(rawTicker: string): Debate {
  const ticker = rawTicker.toUpperCase().trim() || "NVDA";
  const company = COMPANIES[ticker] ?? `${ticker} Holdings`;
  const s = seed(ticker);

  const bullConv = 62 + (s % 33); // 62–94
  const bearScore = 40 + ((s >> 3) % 45); // 40–84
  const quantER = 6 + ((s >> 5) % 22); // expected annual return %
  const macroTail = 45 + ((s >> 7) % 50);
  const riskRating = 30 + ((s >> 9) % 55);

  const verdicts: Verdict[] = [
    "BUY",
    "WATCHLIST",
    "SPECULATIVE",
    "REDUCE",
    "SELL",
  ];
  // Net conviction blends the bull case against bear + risk pressure.
  const net = bullConv - (bearScore + riskRating) / 2 + (macroTail - 50) / 2;
  const verdict: Verdict =
    net > 28
      ? "BUY"
      : net > 12
        ? "WATCHLIST"
        : net > 0
          ? "SPECULATIVE"
          : net > -15
            ? "REDUCE"
            : "SELL";

  const basePrice = 80 + (s % 600);
  // The committee reasons its own levels. Sim: 5-13% stop by simulated
  // volatility, target at a 2:1-4:1 reward:risk ratio. (Live AI sets real ones.)
  const riskFrac = 0.05 + Math.random() * 0.08; // 5-13% below entry
  const stop = Math.round(basePrice * (1 - riskFrac) * 100) / 100;
  const rr = 2 + Math.random() * 2; // 2:1 to 4:1 reward:risk
  const priceTarget = Math.round(basePrice * (1 + riskFrac * rr) * 100) / 100;
  const confidence = Math.min(
    96,
    Math.max(38, Math.round(50 + net * 0.9)),
  );
  const maxAllocationPct = verdict === "BUY" ? 6 : verdict === "WATCHLIST" ? 3 : 1.5;

  const scores: AgentScore[] = [
    {
      agent: "marcus",
      score: bullConv,
      label: "Conviction",
      signal: "buy",
      bullets: [
        `Revenue acceleration into a ${pick(["data-center", "platform", "AI-compute", "ecosystem"], s)} supercycle`,
        `Durable moat — ${pick(["switching costs", "scale economics", "network effects", "IP depth"], s >> 2)}`,
        `Catalyst: ${pick(["next print", "product cycle", "buyback expansion", "guidance raise"], s >> 4)} within two quarters`,
      ],
    },
    {
      agent: "diana",
      score: bearScore,
      label: "Bear score",
      signal: bearScore > 65 ? "avoid" : "hold",
      bullets: [
        `Multiple priced for perfection — ${pick(["28x", "34x", "41x", "22x"], s)} forward`,
        `${pick(["Competitive incursion", "Margin compression", "Demand pull-forward", "Customer concentration"], s >> 3)} risk underappreciated`,
        `Insider selling and ${pick(["channel checks", "guidance hedging", "inventory build"], s >> 5)} flash caution`,
      ],
    },
    {
      agent: "raymond",
      score: Math.round(50 + quantER),
      label: `E[R] ${quantER}%`,
      signal: quantER > 12 ? "buy" : "hold",
      bullets: [
        `Sharpe ${(0.8 + (s % 12) / 10).toFixed(2)}, 1Y vol ${28 + (s % 22)}%`,
        `Max drawdown −${22 + (s % 18)}% over trailing cycle`,
        `Factor load: ${pick(["momentum + quality", "growth + low-vol", "momentum + size", "quality + value"], s >> 6)}`,
      ],
    },
    {
      agent: "priya",
      score: macroTail,
      label: "Tailwind",
      signal: macroTail > 55 ? "buy" : "hold",
      bullets: [
        `Regime: ${pick(["late-cycle easing", "disinflationary growth", "restrictive-but-peaking", "liquidity expansion"], s)}`,
        `Rate path ${pick(["supportive", "neutral", "a headwind"], s >> 2)} for long-duration equity`,
        `Sector rotation ${macroTail > 55 ? "into" : "away from"} the cohort`,
      ],
    },
    {
      agent: "solomon",
      score: riskRating,
      label: "Risk rating",
      signal: riskRating > 60 ? "reduce" : "hold",
      bullets: [
        `Position cap ${maxAllocationPct}% of book — concentration guardrail`,
        `Liquidity ample; tail hedge via ${pick(["put spread", "collar", "index overlay"], s)}`,
        `Kill line at ${stop} — −8% from entry`,
      ],
    },
  ];

  const lines = buildLines(ticker, company, s, verdict, scores);

  const decision: Decision = {
    ticker,
    company,
    verdict,
    confidence,
    priceTarget,
    stop,
    maxAllocationPct,
    thesis: synthThesis(company, verdict, quantER, scores),
    killConditions: [
      `Close below ${stop} on volume`,
      `${pick(["Gross margin", "Guidance", "Backlog"], s)} contraction two quarters running`,
      `Thesis-breaking ${pick(["regulatory action", "competitive launch", "demand air-pocket"], s >> 2)}`,
    ],
  };

  return { ticker, company, lines, scores, decision };
}

function synthThesis(
  company: string,
  verdict: Verdict,
  er: number,
  scores: AgentScore[],
): string {
  const bull = scores[0].score;
  const bear = scores[1].score;
  if (verdict === "BUY")
    return `${company} clears the committee. Marcus's growth case (${bull} conviction) survives Diana's cross-examination; Raymond's ${er}% expected return is risk-adjusted attractive and Priya confirms a supportive regime. Solomon sizes the position conservatively with a hard stop. Net: asymmetric upside with a defined floor — initiate.`;
  if (verdict === "WATCHLIST")
    return `${company} is a quality franchise at a demanding price. The bull and bear cases are roughly balanced (${bull} vs ${bear}); the committee wants a better entry or a confirming catalyst before deploying capital. Stage on the watchlist with alerts armed.`;
  if (verdict === "SPECULATIVE")
    return `${company} offers real upside but the evidence base is thin and dispersion is wide. The committee authorizes only a starter, tail-hedged position sized for being wrong.`;
  if (verdict === "REDUCE")
    return `Diana and Solomon carry the room. ${company}'s risk/reward has deteriorated — trim exposure into strength and tighten the stop.`;
  return `${company} fails committee review. The bear thesis is corroborated by the quant and risk desks; exit the position.`;
}

function buildLines(
  ticker: string,
  company: string,
  s: number,
  verdict: Verdict,
  scores: AgentScore[],
): DebateLine[] {
  let i = 0;
  const id = () => `${ticker}-${i++}`;
  const L: DebateLine[] = [];

  L.push({
    id: id(),
    agent: "chair",
    phase: "convene",
    kind: "statement",
    text: `Committee is convened on ${ticker} — ${company}. Opening statements, then cross-examination. I want evidence, not narrative.`,
  });

  // --- Opening statements ---
  L.push({
    id: id(),
    agent: "marcus",
    phase: "opening",
    kind: "statement",
    text: `I'm carrying ${scores[0].score} conviction. ${scores[0].bullets[0]}. The market is anchoring on trailing numbers and missing the inflection — this re-rates higher.`,
  });
  L.push({
    id: id(),
    agent: "diana",
    phase: "opening",
    kind: "statement",
    text: `Guilty until proven innocent. ${scores[1].bullets[0]}, and ${scores[1].bullets[1].toLowerCase()}. Bull cases this clean usually have a hole in them.`,
  });
  L.push({
    id: id(),
    agent: "raymond",
    phase: "opening",
    kind: "evidence",
    text: `No narrative from me. ${scores[2].bullets[0]}. Expected annual return ${scores[2].label.replace("E[R] ", "")}, ${scores[2].bullets[1].toLowerCase()}. The distribution is right-skewed but fat-tailed.`,
  });
  L.push({
    id: id(),
    agent: "priya",
    phase: "opening",
    kind: "statement",
    text: `Zooming out: ${scores[3].bullets[0]}. ${scores[3].bullets[1]}. That sets the discount rate backdrop for everything Marcus just claimed.`,
  });

  // --- Cross-examination ---
  L.push({
    id: id(),
    agent: "diana",
    phase: "cross",
    rebuts: "marcus",
    kind: "challenge",
    text: `Marcus — your inflection assumes demand is structural, not pulled forward. ${scores[1].bullets[2]}. Defend the durability.`,
  });
  L.push({
    id: id(),
    agent: "marcus",
    phase: "cross",
    rebuts: "diana",
    kind: "statement",
    text: `Backlog and multi-year commitments say structural. ${scores[0].bullets[1]}. This isn't one quarter of pull-forward — it's a platform shift.`,
  });
  L.push({
    id: id(),
    agent: "raymond",
    phase: "cross",
    rebuts: "diana",
    kind: "evidence",
    text: `The data splits the difference. Momentum and quality both load positive, but realized vol is ${scores[2].bullets[0].split("vol ")[1] ?? "elevated"}. Diana's tail risk is real and priced — just not catastrophic.`,
  });
  L.push({
    id: id(),
    agent: "solomon",
    phase: "cross",
    rebuts: "marcus",
    kind: "challenge",
    text: `Conviction is not a sizing input. ${scores[4].bullets[0]}. ${scores[4].bullets[2]}. I will not let one name dominate the book regardless of how good the story is.`,
  });
  L.push({
    id: id(),
    agent: "priya",
    phase: "cross",
    rebuts: "diana",
    kind: "concession",
    text: `Diana's valuation point only bites if the regime turns. ${scores[3].bullets[2]} — for now the macro is a ${scores[3].score > 55 ? "tailwind" : "headwind"}, which ${scores[3].score > 55 ? "supports" : "pressures"} the multiple.`,
  });
  L.push({
    id: id(),
    agent: "diana",
    phase: "cross",
    rebuts: "raymond",
    kind: "concession",
    text: `Fine — I'll concede the floor is defined if Solomon's stop holds. My objection narrows to entry price, not the franchise.`,
  });

  // --- Synthesis ---
  L.push({
    id: id(),
    agent: "chair",
    phase: "synthesis",
    kind: "statement",
    text: `Logging the disagreement: Marcus and Raymond constructive, Diana and Solomon constraining, Priya conditional on regime. The crux is entry and sizing, not whether the franchise is real.`,
  });

  // --- Verdict ---
  L.push({
    id: id(),
    agent: "chair",
    phase: "verdict",
    kind: "ruling",
    text: rulingText(verdict, ticker),
  });

  return L;
}

function rulingText(verdict: Verdict, ticker: string): string {
  switch (verdict) {
    case "BUY":
      return `Ruling on ${ticker}: BUY. The upside is asymmetric and the downside is bounded by a hard stop. Initiate at Solomon's cap. Memo issued.`;
    case "WATCHLIST":
      return `Ruling on ${ticker}: WATCHLIST. Quality franchise, demanding entry. Arm alerts; deploy on a confirming catalyst or better price.`;
    case "SPECULATIVE":
      return `Ruling on ${ticker}: SPECULATIVE. Starter position only, tail-hedged and sized to be wrong. Revisit on new evidence.`;
    case "REDUCE":
      return `Ruling on ${ticker}: REDUCE. Risk/reward has decayed. Trim into strength and tighten the stop.`;
    case "SELL":
      return `Ruling on ${ticker}: SELL. The bear thesis is corroborated across desks. Exit the position.`;
  }
}
