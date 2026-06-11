"""
Mock implementations of all five committee agents for AAPL.

Each agent implements all three debate rounds:
  Round 1 (analyze)      — independent analysis, no knowledge of peers
  Round 2 (deliberate)   — engages at least one opposing Round 1 position explicitly
  Round 3 (final_vote)   — signal + conviction only, no new analysis

No API calls are made anywhere in this file.
"""

from agents.base import AgentContext, AgentOutput, BaseAgent


# ---------------------------------------------------------------------------
# Bear — Victoria Preservation
# ---------------------------------------------------------------------------

class MockBearAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("bear")

    def name(self) -> str:
        return "Victoria Preservation (Bear) [MOCK]"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="reduce",
            conviction=0.70,
            rationale=(
                "AAPL trades at 36× trailing earnings with iPhone revenue flat YoY and "
                "Greater China at ~17% of total revenue against a deteriorating geopolitical "
                "backdrop. Services growth is real but decelerating — Apple Music, TV+, and "
                "Arcade face intensifying competition while the App Store faces regulatory "
                "dismantling in the EU and active DOJ litigation in the US. The market is "
                "pricing in a Services-led re-rating that is unlikely to fully materialize. "
                "At $4.3T market cap the margin for error is zero. I see 10–25% downside "
                "to fair value over 12 months and vote Reduce."
            ),
            metadata={
                "round": 1,
                "vote": 3,
                "confidence": 70,
                "agent_name": "Victoria Preservation",
                "failure_modes": [
                    {
                        "mode": (
                            "China revenue collapse triggered by tariff escalation above 60% "
                            "or a Beijing directive for state-owned enterprises to replace "
                            "iPhones with domestic alternatives."
                        ),
                        "estimated_downside": "-28%; ~$60B annualized revenue at risk.",
                    },
                    {
                        "mode": (
                            "App Store antitrust ruling forces mandatory third-party payment "
                            "processing globally, cutting effective commission rate from ~27% "
                            "to ~5–8% on digital goods."
                        ),
                        "estimated_downside": "-12% standalone; Services gross profit -$8–10B annually.",
                    },
                    {
                        "mode": (
                            "iPhone 17 AI feature cycle disappoints as Android OEMs replicate "
                            "capabilities within one product generation; units 8–10% below "
                            "consensus in FY2026 forcing ~15% EPS guidance cuts."
                        ),
                        "estimated_downside": "-18% as multiple compresses from 36× to ~28×.",
                    },
                ],
            },
        )

    def deliberate(self, ctx: AgentContext, round1_outputs: list[AgentOutput]) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="reduce",
            conviction=0.73,
            rationale=(
                "Maximilian argues that $101B of annual FCF creates a durable floor and that "
                "the buyback program bounds the downside. I want to address that directly. "
                "The FCF figure is correct, but it is forward-looking pricing that matters. "
                "Devlin has correctly identified that the App Store take rate — the engine "
                "of Services margin — is under active legal attack in every major jurisdiction "
                "simultaneously. If take rates fall from ~27% to 12–15% (the regulatory "
                "trajectory Devlin and I both see), Services gross profit falls by $10–12B "
                "annually. The $101B FCF becomes ~$89B, and the market was pricing in "
                "growth to $120B+. That is not a tail risk — it is the base case under the "
                "current regulatory trajectory. Aria's 10-year thesis about on-device AI is "
                "interesting, but it presupposes the App Store model survives long enough to "
                "fund continued silicon R&D. I am not confident it does on the current timeline. "
                "Conviction increases to 73%: Devlin's analysis confirms the most dangerous "
                "of my three failure modes."
            ),
            metadata={
                "round": 2,
                "vote": 3,
                "confidence": 73,
                "agent_name": "Victoria Preservation",
                "opposing_reference": (
                    "Addresses Maximilian's FCF-as-floor argument directly. "
                    "Accepts Devlin's App Store take-rate finding as corroborating evidence."
                ),
                "position_change": "conviction_increased",
            },
        )

    def final_vote(self, ctx: AgentContext, prior_outputs: list[AgentOutput]) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="reduce",
            conviction=0.73,
            rationale="Maintaining Reduce. Round 2 debate strengthened my App Store thesis.",
            metadata={
                "round": 3,
                "vote": 3,
                "confidence": 73,
                "agent_name": "Victoria Preservation",
                "position_change": "maintained",
            },
        )


# ---------------------------------------------------------------------------
# Bull — Maximilian Growth
# ---------------------------------------------------------------------------

class MockBullAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("bull")

    def name(self) -> str:
        return "Maximilian Growth (Bull) [MOCK]"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="buy",
            conviction=0.62,
            rationale=(
                "Apple's competitive moat operates at three mutually reinforcing layers: "
                "silicon (proprietary A/M-series chips), software (iOS/macOS ecosystem with "
                "2B+ active devices), and services (~$100B annualized revenue at 70%+ gross "
                "margin). The installed base is a distribution platform competitors cannot "
                "replicate without matching Apple on all three dimensions simultaneously. "
                "FCF of $101B per year funds 2.5% float buybacks annually, creating durable "
                "per-share earnings growth even in zero-revenue-growth scenarios. Services "
                "ARPU growing 9% per year on a stable-to-growing installed base is the "
                "core compounding engine. I vote Buy; the 36× P/E is defensible if "
                "Services sustains 12%+ growth."
            ),
            metadata={
                "round": 1,
                "vote": 6,
                "confidence": 62,
                "agent_name": "Maximilian Growth",
                "competitive_moat": (
                    "Vertical integration across silicon, OS, and services creates switching "
                    "costs that compound with each additional Apple device. Average household "
                    "with 3+ Apple devices churns at <4% annually."
                ),
                "earnings_quality": (
                    "High. FCF of $101B vs net income of ~$97B — near 1:1 conversion ratio "
                    "over three years. No meaningful R&D capitalization distortions."
                ),
                "revenue_scenario": {
                    "bear_case_cagr": "+3% — China declines offset Services growth",
                    "base_case_cagr": "+8% — Services at 12%, hardware flat, India grows",
                    "bull_case_cagr": "+14% — AI supercycle FY2026–2027",
                    "expected_cagr": "+8% (25% bear / 55% base / 20% bull)",
                    "key_drivers": [
                        "Services ARPU compounding on 2B+ installed base",
                        "India premium smartphone penetration",
                        "Apple Intelligence ASP uplift of $30–50/unit",
                    ],
                },
                "valuation_justification": "N/A — voting Buy (6), not Strong Buy (7).",
            },
        )

    def deliberate(self, ctx: AgentContext, round1_outputs: list[AgentOutput]) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="buy",
            conviction=0.59,
            rationale=(
                "Victoria's China failure mode is the strongest opposing view on this committee "
                "and I want to engage it directly. A $60B revenue shock in Greater China is "
                "within the range of possibility — I do not dismiss it. My response has two "
                "parts. First, India is already absorbing 15–20% of the displacement volume, "
                "and the India premium smartphone opportunity is structurally larger than "
                "China's remaining addressable market for Apple. Second, even under Victoria's "
                "China scenario, Apple's FCF floor of ~$75B still supports a $3.2T+ market "
                "cap at the historical ex-China hardware multiple. The downside is bounded. "
                "Where I do take Devlin's point seriously: App Store take rates are under "
                "genuine regulatory pressure, and I am adjusting my conviction down by 3 "
                "points to acknowledge that the Services multiple I was using may be too "
                "generous under the regulatory baseline. I maintain Buy but with less "
                "certainty on the Services re-rating component."
            ),
            metadata={
                "round": 2,
                "vote": 6,
                "confidence": 59,
                "agent_name": "Maximilian Growth",
                "opposing_reference": (
                    "Directly engages Victoria's China revenue collapse failure mode ($60B at risk). "
                    "Partially concedes Devlin's App Store take-rate regulatory point."
                ),
                "position_change": "conviction_decreased",
            },
        )

    def final_vote(self, ctx: AgentContext, prior_outputs: list[AgentOutput]) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="buy",
            conviction=0.59,
            rationale="Maintaining Buy at reduced conviction. China risk is real; FCF floor limits downside.",
            metadata={
                "round": 3,
                "vote": 6,
                "confidence": 59,
                "agent_name": "Maximilian Growth",
                "position_change": "maintained",
            },
        )


# ---------------------------------------------------------------------------
# Contrarian — Cassandra Cross
# ---------------------------------------------------------------------------

class MockContrarianAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("contrarian")

    def name(self) -> str:
        return "Cassandra Cross (Contrarian) [MOCK]"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="buy",
            conviction=0.58,
            rationale=(
                "The consensus view — that Apple is a mature hardware company justifying a "
                "modest multiple — is built on a valuation framework that is wrong for the "
                "business it is being applied to. Stripped out and valued on SaaS comps at "
                "20× revenue, Services alone is worth ~$2T against a total market cap of "
                "$4.3T — implying the hardware business is priced at $2.3T, or ~2.3× hardware "
                "revenue. That is cheap for the world's most profitable consumer hardware "
                "business. The consensus is right that headline P/E is high, but wrong about "
                "what is causing it. I vote Buy on the SOTP argument."
            ),
            metadata={
                "round": 1,
                "vote": 6,
                "confidence": 58,
                "agent_name": "Cassandra Cross",
                "consensus_view": (
                    "Apple is a mature hardware company with slowing iPhone growth, trading "
                    "at 36× P/E that is difficult to justify given mid-single-digit revenue "
                    "growth. Services faces regulatory risk."
                ),
                "contrarian_thesis": (
                    "Apple is two businesses. Blended P/E obscures that Services deserves a "
                    "SaaS multiple and hardware deserves a hardware multiple. SOTP math says "
                    "the stock is cheap, not expensive."
                ),
                "challenged_assumptions": [
                    {
                        "assumption": "36× P/E is stretched for a hardware company.",
                        "why_wrong": "Apple is not a hardware company — Services is 28% of revenue at 72% gross margin.",
                        "falsifying_event": "Apple breaks out Services operating income; buy-side reprices to SOTP.",
                    },
                    {
                        "assumption": "Services growth is decelerating toward high single digits.",
                        "why_wrong": "Deceleration is a base effect; ARPU growing 9% with installed base still growing 5%.",
                        "falsifying_event": "Two consecutive quarters of Services growth above 15%.",
                    },
                    {
                        "assumption": "China risk is binary and unmanageable.",
                        "why_wrong": "India is absorbing volume displacement; China share has been resilient for 3 years.",
                        "falsifying_event": "India iPhone shipments cross 10M units/quarter.",
                    },
                ],
            },
        )

    def deliberate(self, ctx: AgentContext, round1_outputs: list[AgentOutput]) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="buy",
            conviction=0.55,
            rationale=(
                "Devlin's App Store take rate argument is the most direct challenge to my "
                "SOTP thesis and I want to address it with numbers. If App Store take rates "
                "fall from ~27% to 12% — Devlin's stated regulatory trajectory — Services "
                "gross profit falls from ~$67B to approximately $38B annually. At 20× gross "
                "profit (a reasonable SaaS multiple), Services is worth ~$760B rather than "
                "~$1.34T. Adding hardware at 2.3× revenue ($800B), the SOTP value is "
                "~$1.56T — which is actually below the current market cap of $4.3T. "
                "I have to acknowledge: Devlin's scenario breaks my SOTP thesis. "
                "However, I do not think a 12% take rate is the base case — the regulatory "
                "consensus I track still centers at 18–22%, not 12%. At 20% take rate, "
                "Services gross profit is ~$51B, SOTP value is ~$2.8T for Services + "
                "$800B hardware = $3.6T, still 16% below current market cap but not "
                "catastrophic. I reduce conviction to 55% to reflect this genuine uncertainty "
                "but maintain Buy: the SOTP argument survives at most regulatory scenarios "
                "except the most aggressive outcome Devlin is flagging."
            ),
            metadata={
                "round": 2,
                "vote": 6,
                "confidence": 55,
                "agent_name": "Cassandra Cross",
                "opposing_reference": (
                    "Directly engages Devlin's App Store take-rate regulatory argument "
                    "with quantified SOTP sensitivity analysis at 12%, 20%, and 27% take rates."
                ),
                "position_change": "conviction_decreased",
            },
        )

    def final_vote(self, ctx: AgentContext, prior_outputs: list[AgentOutput]) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="buy",
            conviction=0.55,
            rationale="Maintaining Buy at reduced conviction. SOTP survives at 18–22% take rate base case.",
            metadata={
                "round": 3,
                "vote": 6,
                "confidence": 55,
                "agent_name": "Cassandra Cross",
                "position_change": "maintained",
            },
        )


# ---------------------------------------------------------------------------
# Devil's Advocate — Devlin Sharp
# ---------------------------------------------------------------------------

class MockDevilsAdvocateAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("devils_advocate")

    def name(self) -> str:
        return "Devlin Sharp (Devil's Advocate) [MOCK]"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="reduce",
            conviction=0.55,
            rationale=(
                "The dominant position on Apple is mildly bullish — most institutional holders "
                "are overweight, analyst consensus is Outperform, and the AI upgrade cycle "
                "narrative is broadly accepted. I stress-tested it and found three structural "
                "weaknesses. The fatal flaw: the entire Services bull case rests on App Store "
                "take rates that are simultaneously under attack in every major jurisdiction. "
                "The consensus models assume take rates decline modestly from ~27% to ~22% over "
                "five years. The regulatory trajectory — EU DMA, US DOJ litigation, South "
                "Korea law — suggests a faster decline to 10–15% is more probable than priced. "
                "This is not a tail risk; it is in active litigation. I vote Reduce: not "
                "because the business is bad, but because the dominant bull case has a crack "
                "at its most load-bearing joint."
            ),
            metadata={
                "round": 1,
                "vote": 3,
                "confidence": 55,
                "agent_name": "Devlin Sharp",
                "dominant_position": "bullish",
                "weakest_arguments": [
                    {
                        "argument": "Services is a durable, high-margin annuity at 12–15% growth.",
                        "rebuttal": "App Store take rates are under active multi-jurisdiction regulatory attack, which is not reflected in consensus growth models.",
                    },
                    {
                        "argument": "Apple Intelligence will drive a multi-year iPhone supercycle similar to 5G.",
                        "rebuttal": "5G forced hardware incompatibility; AI Intelligence is software and already runs on iPhone 15 Pro+. The addressable upgrade pool is far smaller than modeled.",
                    },
                    {
                        "argument": "$101B FCF and 2.5% buyback yield create a durable stock floor.",
                        "rebuttal": "Berkshire Hathaway has been a net seller for five consecutive quarters — the 'buyback as floor' logic deserves scrutiny at $4.3T market cap.",
                    },
                ],
                "fatal_flaw": (
                    "The Services bull case's most critical assumption — that App Store take "
                    "rates are structurally protected — is simultaneously under attack in every "
                    "major operating jurisdiction. This is underpriced by the market."
                ),
            },
        )

    def deliberate(self, ctx: AgentContext, round1_outputs: list[AgentOutput]) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="reduce",
            conviction=0.58,
            rationale=(
                "Aria's on-device AI inference argument is the strongest opposing view on this "
                "committee and I want to engage it on its own terms before I explain why I "
                "still vote Reduce. Aria is correct that Apple's A/M-series silicon achieves "
                "2–4× energy efficiency versus competing chips for AI workloads. If the AI era "
                "truly shifts from cloud inference to edge inference, Apple's vertical silicon "
                "integration is a genuine structural moat that I was underweighting. I take "
                "that point seriously. "
                "My response: the on-device AI moat compounds only if Apple can continue "
                "funding the R&D that maintains silicon leadership. That R&D is funded, "
                "ultimately, by the Services gross margin that my App Store analysis shows "
                "is under regulatory attack. The chain is: take rates fall → Services gross "
                "profit falls → R&D budget is constrained → silicon leadership erodes over a "
                "5–8 year horizon. It is not an immediate concern, but it links Aria's 10-year "
                "thesis to the exact vulnerability I identified. "
                "Additionally, Cassandra's deliberation confirmed my central point: at 12% "
                "take rates, her own SOTP math breaks. I increase conviction to 58%: the "
                "debate has clarified that the App Store regulatory risk is the load-bearing "
                "assumption for both the bull and contrarian cases."
            ),
            metadata={
                "round": 2,
                "vote": 3,
                "confidence": 58,
                "agent_name": "Devlin Sharp",
                "opposing_reference": (
                    "Steel-mans Aria's on-device AI silicon thesis, then links it back to "
                    "App Store take rate dependency. Notes Cassandra's deliberation confirmed "
                    "the regulatory point with SOTP sensitivity numbers."
                ),
                "position_change": "conviction_increased",
            },
        )

    def final_vote(self, ctx: AgentContext, prior_outputs: list[AgentOutput]) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="reduce",
            conviction=0.58,
            rationale="Maintaining Reduce. App Store take-rate regulatory risk remains the unpriced load-bearing flaw.",
            metadata={
                "round": 3,
                "vote": 3,
                "confidence": 58,
                "agent_name": "Devlin Sharp",
                "position_change": "maintained",
            },
        )


# ---------------------------------------------------------------------------
# Future Looker — Aria Horizon
# ---------------------------------------------------------------------------

class MockFutureLookerAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("future_looker")

    def name(self) -> str:
        return "Aria Horizon (Future Looker) [MOCK]"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="buy",
            conviction=0.65,
            rationale=(
                "Over a 10-year horizon, Apple's structural position is better than any "
                "near-term risk suggests. The on-device AI inference transition structurally "
                "advantages companies with proprietary silicon + OS integration, and Apple "
                "has a multi-year head start. As the AI era shifts from cloud inference "
                "(which benefits AWS/Azure/Google) to edge inference (which benefits device "
                "makers with custom silicon), Apple's moat deepens rather than narrows. "
                "Base case FY2034 revenue: $680–720B driven by Services reaching 35% of "
                "revenue and a spatial computing platform at meaningful scale by 2028. "
                "I vote Buy; the secular outlook is underappreciated."
            ),
            metadata={
                "round": 1,
                "vote": 6,
                "confidence": 65,
                "agent_name": "Aria Horizon",
                "secular_tailwinds": [
                    "On-device AI inference transition: A/M-series silicon at 2–4× energy efficiency advantage; privacy regulation tilts AI processing to edge.",
                    "India/SEA premium smartphone penetration: same cohort dynamic as China 2010–2018 with 40% larger addressable population.",
                    "Spatial computing platform option value: Vision Pro form factor at $1,500–$2,000 by 2028 opens new ARPU category.",
                ],
                "secular_headwinds": [
                    "Hardware commoditization via open-source AI: if Llama equivalents run on Android chips by 2027–2028, Apple Intelligence loses hardware differentiation.",
                    "Regulatory fragmentation: DMA + DSA + AI Act mandate interoperability over 10 years, structurally weakening App Store lock-in.",
                ],
                "disruption_risk": (
                    "Medium probability, 6–9 year timeframe. An AI-native smartphone OS — "
                    "conversational interface over icon grid — could render iOS's UX paradigm "
                    "obsolete if a competitor (OpenAI, Perplexity, or Huawei HarmonyOS) "
                    "achieves mainstream adoption before Apple ships a conversational iOS layer."
                ),
                "decade_revenue_scenario": (
                    "Base $680–720B by FY2034 (vs ~$400B TTM). "
                    "Bear $480B (China + regulatory). Bull $950B (AI supercycle + Vision mass market)."
                ),
            },
        )

    def deliberate(self, ctx: AgentContext, round1_outputs: list[AgentOutput]) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="buy",
            conviction=0.65,
            rationale=(
                "Victoria's China failure mode is the most credible near-term challenge to "
                "my 10-year thesis, and I want to be explicit about how I handle it. A $60B "
                "revenue shock in Greater China — Victoria's base estimate — would reduce my "
                "FY2034 base case from $700B to approximately $610–630B. That is a meaningful "
                "reduction and I do not dismiss it. My response is structural: over a 10-year "
                "horizon, India and Southeast Asia absorb that volume with a 3–4 year lag "
                "based on the penetration curves I have modeled. The China risk Victoria "
                "identifies is real on a 1–3 year horizon. It is substantially mitigated "
                "on my 10-year frame. "
                "On Devlin's App Store regulatory point: I acknowledge the 2–3 year take rate "
                "headwind is real. Over 10 years, I expect the Services portfolio to rotate "
                "toward iCloud, Apple TV+, Apple One bundles, and new platform categories "
                "that are not subject to the same regulatory pressure as App Store payments. "
                "The Services gross margin may compress 5–8 points over a decade, which I "
                "have partially accounted for in my model. "
                "Conviction unchanged at 65%: my time horizon absorbs the near-term risks "
                "both Victoria and Devlin have correctly identified."
            ),
            metadata={
                "round": 2,
                "vote": 6,
                "confidence": 65,
                "agent_name": "Aria Horizon",
                "opposing_reference": (
                    "Directly addresses Victoria's China failure mode with a 10-year reframe "
                    "($700B → $610–630B base case). Acknowledges Devlin's App Store point "
                    "but argues Services rotation mitigates it over the decade."
                ),
                "position_change": "maintained",
            },
        )

    def final_vote(self, ctx: AgentContext, prior_outputs: list[AgentOutput]) -> AgentOutput:
        return AgentOutput(
            agent_id=self.agent_id,
            signal="buy",
            conviction=0.65,
            rationale="Maintaining Buy. 10-year structural thesis absorbs near-term China and regulatory risks.",
            metadata={
                "round": 3,
                "vote": 6,
                "confidence": 65,
                "agent_name": "Aria Horizon",
                "position_change": "maintained",
            },
        )
