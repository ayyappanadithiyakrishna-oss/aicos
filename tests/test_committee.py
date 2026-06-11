"""
Full committee debate test — three rounds, mock agents, no API calls.

Prints the complete debate transcript round by round, then the final
CommitteeResult with weighted vote breakdown and dissent summary.

Usage:
    python3 tests/test_committee.py        (from /Users/preeya/aicos)
"""

import sys
import textwrap
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from agents.base import AgentContext, AgentOutput
from orchestrator.committee.session import CommitteeResult, CommitteeSession, DebateRound
from tests.mocks.agents import (
    MockBearAgent,
    MockBullAgent,
    MockContrarianAgent,
    MockDevilsAdvocateAgent,
    MockFutureLookerAgent,
)

AAPL_STUB = {
    "price": 295.63,
    "market_cap_bn": 4342.0,
    "pe_ratio_trailing": 35.83,
    "pe_ratio_forward": 31.2,
    "revenue_ttm_bn": 391.0,
    "gross_margin_pct": 46.2,
    "free_cash_flow_bn": 101.1,
    "total_debt_bn": 97.3,
    "revenue_growth_yoy_pct": 4.0,
    "analyst_recommendation": "buy",
    "iphone_revenue_note": "iPhone ~52% of total revenue (FY2024)",
    "china_revenue_note": "Greater China ~17% of total revenue",
}

W = 74  # output width
_SIGNAL_ORDER = ["buy", "hold", "reduce", "sell", "avoid"]


def _bar(value: float, width: int = 18) -> str:
    filled = round(max(0.0, min(1.0, value)) * width)
    return "█" * filled + "░" * (width - filled)


def _wrap(text: str, indent: int = 4) -> str:
    pad = " " * indent
    return textwrap.fill(text, width=W - indent, initial_indent=pad, subsequent_indent=pad)


def _agent_label(output: AgentOutput) -> str:
    name = output.metadata.get("agent_name", output.agent_id.replace("_", " ").title())
    return f"{name} ({output.agent_id})"


def _position_change_tag(output: AgentOutput) -> str:
    change = output.metadata.get("position_change", "")
    return {
        "maintained": "  [→ maintained]",
        "conviction_increased": "  [↑ conviction up]",
        "conviction_decreased": "  [↓ conviction down]",
        "signal_changed": "  [⚡ signal changed]",
    }.get(change, "")


# ---------------------------------------------------------------------------
# Printers
# ---------------------------------------------------------------------------

def print_header(title: str) -> None:
    print(f"\n{'═' * W}")
    print(f"  {title}")
    print(f"{'═' * W}")


def print_subheader(title: str) -> None:
    print(f"\n  {'─' * (W - 2)}")
    print(f"  {title}")
    print(f"  {'─' * (W - 2)}")


def print_round1_output(output: AgentOutput) -> None:
    vote = output.metadata.get("vote", "?")
    conf = output.metadata.get("confidence", "?")
    print(f"\n  ┌─ {_agent_label(output)}")
    print(f"  │  Signal: {output.signal.upper():<8} Vote: {vote}/7  Conviction: {_bar(output.conviction)} {output.conviction:.0%}  (confidence {conf}/100)")
    print(f"  │")
    for line in textwrap.wrap(output.rationale, width=W - 6):
        print(f"  │  {line}")

    meta = output.metadata

    if output.agent_id == "bear" and "failure_modes" in meta:
        print(f"  │")
        print(f"  │  Failure Modes:")
        for i, fm in enumerate(meta["failure_modes"], 1):
            mode_lines = textwrap.wrap(fm["mode"], width=W - 12)
            print(f"  │    [{i}] {mode_lines[0]}")
            for l in mode_lines[1:]:
                print(f"  │        {l}")
            print(f"  │        ↳ Downside: {fm['estimated_downside']}")

    elif output.agent_id == "bull" and "revenue_scenario" in meta:
        rs = meta["revenue_scenario"]
        print(f"  │")
        print(f"  │  Revenue Scenario:")
        print(f"  │    Bear CAGR: {rs['bear_case_cagr']}")
        print(f"  │    Base CAGR: {rs['base_case_cagr']}")
        print(f"  │    Bull CAGR: {rs['bull_case_cagr']}")
        print(f"  │    Expected:  {rs['expected_cagr']}")

    elif output.agent_id == "contrarian" and "challenged_assumptions" in meta:
        print(f"  │")
        print(f"  │  Consensus Being Challenged:")
        for line in textwrap.wrap(meta.get("consensus_view", ""), width=W - 10):
            print(f"  │    {line}")
        print(f"  │  Challenged Assumptions:")
        for i, a in enumerate(meta["challenged_assumptions"], 1):
            print(f"  │    [{i}] {a['assumption']}")

    elif output.agent_id == "devils_advocate" and "fatal_flaw" in meta:
        print(f"  │")
        print(f"  │  Fatal Flaw:")
        for line in textwrap.wrap(meta["fatal_flaw"], width=W - 10):
            print(f"  │    {line}")

    elif output.agent_id == "future_looker" and "secular_tailwinds" in meta:
        print(f"  │")
        print(f"  │  Secular Tailwinds:")
        for tw in meta["secular_tailwinds"]:
            first_line = textwrap.wrap(tw, width=W - 12)[0]
            print(f"  │    ↑ {first_line}{'…' if len(tw) > len(first_line) else ''}")
        print(f"  │  Secular Headwinds:")
        for hw in meta["secular_headwinds"]:
            first_line = textwrap.wrap(hw, width=W - 12)[0]
            print(f"  │    ↓ {first_line}{'…' if len(hw) > len(first_line) else ''}")

    print(f"  └{'─' * (W - 3)}")


def print_round2_output(output: AgentOutput) -> None:
    vote = output.metadata.get("vote", "?")
    conf = output.metadata.get("confidence", "?")
    change_tag = _position_change_tag(output)

    print(f"\n  ┌─ {_agent_label(output)}{change_tag}")
    print(f"  │  Signal: {output.signal.upper():<8} Vote: {vote}/7  Conviction: {_bar(output.conviction)} {output.conviction:.0%}{change_tag}")
    print(f"  │")
    opp_ref = output.metadata.get("opposing_reference", "")
    if opp_ref:
        print(f"  │  ◈ Opposing reference: {opp_ref[:W - 24]}")
        if len(opp_ref) > W - 24:
            for line in textwrap.wrap(opp_ref[W - 24:], width=W - 8):
                print(f"  │    {line}")
        print(f"  │")
    for line in textwrap.wrap(output.rationale, width=W - 6):
        print(f"  │  {line}")
    print(f"  └{'─' * (W - 3)}")


def print_round3_output(output: AgentOutput) -> None:
    vote = output.metadata.get("vote", "?")
    conf = output.metadata.get("confidence", "?")
    change_tag = _position_change_tag(output)
    name = output.metadata.get("agent_name", output.agent_id.replace("_", " ").title())
    print(
        f"  {name:<30} {output.signal.upper():<8}  "
        f"Vote {vote}/7  {_bar(output.conviction, 14)} {output.conviction:.0%}"
        f"{change_tag}"
    )


def print_result(result: CommitteeResult) -> None:
    print_header(f"COMMITTEE DECISION — {result.ticker}  |  {result.timestamp.strftime('%Y-%m-%d %H:%M UTC')}")

    print(f"\n  FINAL SIGNAL   ▶  {result.final_signal.upper()}")
    print(f"  CONFIDENCE        {_bar(result.confidence)} {result.confidence:.1%}")

    # Conviction tally across all signals
    all_r3 = result.votes + result.dissents
    tally: dict[str, float] = {}
    agents_by_signal: dict[str, list[str]] = {}
    for o in all_r3:
        tally[o.signal] = tally.get(o.signal, 0.0) + o.conviction
        agents_by_signal.setdefault(o.signal, []).append(
            o.metadata.get("agent_name", o.agent_id).split()[0]
        )
    total_conviction = sum(tally.values())

    print(f"\n  {'Vote Tally':─<{W - 2}}")
    for sig in sorted(tally, key=lambda s: -tally[s]):
        frac = tally[sig] / total_conviction
        names = ", ".join(agents_by_signal[sig])
        print(f"  {sig.upper():<9} {_bar(frac, 22)} {frac:.1%}  — {names}")

    print(f"\n  {'Majority Coalition (Round 3)':─<{W - 2}}")
    for o in sorted(result.votes, key=lambda o: -o.conviction):
        name = o.metadata.get("agent_name", o.agent_id)
        print(f"  ✓  {name:<30} {o.signal.upper():<8} conviction {o.conviction:.0%}")

    if result.dissents:
        print(f"\n  {'Dissents (Round 3)':─<{W - 2}}")
        for o in sorted(result.dissents, key=lambda o: -o.conviction):
            name = o.metadata.get("agent_name", o.agent_id)
            print(f"  ✗  {name:<30} {o.signal.upper():<8} conviction {o.conviction:.0%}")

    print(f"\n  {'Dissent Summary':─<{W - 2}}")
    for line in result.dissent_summary.split("\n"):
        for wrapped in textwrap.wrap(line, width=W - 4) or [""]:
            print(f"  {wrapped}")

    print(f"\n{'═' * W}\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    agents = [
        MockBearAgent(),
        MockBullAgent(),
        MockContrarianAgent(),
        MockDevilsAdvocateAgent(),
        MockFutureLookerAgent(),
    ]

    ctx = AgentContext(ticker="AAPL", timeframe="12 months", data=AAPL_STUB)

    print_header(
        "AICOS — AI Investment Committee OS\n"
        f"  Ticker: {ctx.ticker}  |  Timeframe: {ctx.timeframe}  |  "
        f"Agents: {len(agents)}  |  Mode: MOCK"
    )

    # Run the session and capture rounds for display
    session = CommitteeSession(agents=agents)

    # Run each round manually so we can print as we go
    from orchestrator.committee.session import DebateRound

    print_subheader("ROUND 1 — Independent Analysis")
    print("  Each agent analyzes AAPL with no knowledge of peer positions.\n")
    r1_outputs = [a.analyze(ctx) for a in agents]
    for o in r1_outputs:
        print_round1_output(o)

    r1 = DebateRound(1, r1_outputs)

    print_subheader("ROUND 2 — Cross-Examination")
    print("  Each agent receives all Round 1 outputs and must explicitly")
    print("  reference at least one opposing position before confirming or updating.\n")
    r2_outputs = [a.deliberate(ctx, r1.outputs) for a in agents]
    for o in r2_outputs:
        print_round2_output(o)

    r2 = DebateRound(2, r2_outputs)

    print_subheader("ROUND 3 — Final Votes")
    print("  Signal and conviction only. No new analysis.\n")
    r3_outputs = [a.final_vote(ctx, r1.outputs + r2.outputs) for a in agents]
    for o in r3_outputs:
        print_round3_output(o)

    r3 = DebateRound(3, r3_outputs)

    # Build the result via session's internal logic
    result = session._build_result(ctx.ticker, [r1, r2, r3])

    print_result(result)


if __name__ == "__main__":
    main()
