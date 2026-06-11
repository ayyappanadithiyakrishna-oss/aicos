"""
Position sizing tests.

Covers:
  1. PositionSizer tier boundaries and the manual-override flag
  2. _current_portfolio_value() accounting through buy/sell cycles
  3. End-to-end workflow: BUY at each conviction tier produces correct shares
  4. Hard-cap enforcement (notional never exceeds max_position_pct)
  5. Old Position JSON (pre-sizing) loads cleanly with safe defaults

Key note on CommitteeSession.confidence:
  The session confidence is the fraction of total conviction-weight held by the
  winning signal (e.g. unanimous 5-agent "buy" → 1.0).  Tests that need precise
  confidence values use _PresetSession to bypass the real vote aggregation and
  inject a known confidence directly into the workflow.

No API calls.  All deterministic.

Usage:
    python3 tests/test_sizing.py   (from /Users/preeya/aicos)
"""

import json
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from agents.base import AgentContext, AgentOutput, BaseAgent
from config.settings import CommitteeConfig, PortfolioConfig, Settings
from ledger.decisions.store import DecisionStore
from ledger.positions.store import Position, PositionStore
from ledger.transactions.store import Transaction, TransactionStore
from orchestrator.committee.session import CommitteeResult, CommitteeSession
from orchestrator.sizing.sizer import PositionSizer, SizeResult
from orchestrator.workflows.investment_review import InvestmentReviewWorkflow


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _approx(a: float, b: float, tol: float = 0.01) -> bool:
    return abs(a - b) <= tol


# ---------------------------------------------------------------------------
# _PresetSession — injects a known confidence/signal into the workflow
# without going through vote aggregation
# ---------------------------------------------------------------------------

class _PresetSession(CommitteeSession):
    """Returns a CommitteeResult with pre-specified signal and confidence."""

    def __init__(self, signal: str, confidence: float):
        self._signal = signal
        self._confidence = confidence

    def convene(self, ctx: AgentContext) -> CommitteeResult:
        return CommitteeResult(
            ticker=ctx.ticker,
            final_signal=self._signal,
            confidence=self._confidence,
            votes=[],
            dissents=[],
            dissent_summary="",
            rationale="preset stub",
            rounds=[],
        )


def _make_workflow(
    tmpdir: Path,
    *,
    signal: str = "buy",
    confidence: float = 0.75,
    conviction_threshold: float = 0.65,
    allow_max_position: bool = False,
    paper_balance: float = 100_000.0,
) -> InvestmentReviewWorkflow:
    """Build an InvestmentReviewWorkflow with a preset session for exact confidence control."""
    session = _PresetSession(signal=signal, confidence=confidence)
    settings = Settings(
        committee=CommitteeConfig(conviction_threshold=conviction_threshold),
        portfolio=PortfolioConfig(
            paper_balance=paper_balance,
            allow_max_position=allow_max_position,
        ),
    )
    return InvestmentReviewWorkflow(
        session=session,
        decision_store=DecisionStore(tmpdir / "decisions.jsonl"),
        position_store=PositionStore(tmpdir / "positions.json"),
        transaction_store=TransactionStore(tmpdir / "transactions.jsonl"),
        settings=settings,
    )


# ---------------------------------------------------------------------------
# 1. PositionSizer unit tests (pure math — no workflow)
# ---------------------------------------------------------------------------

def test_tier_boundaries() -> None:
    sizer = PositionSizer()
    cfg = PortfolioConfig(paper_balance=100_000, allow_max_position=False)
    pv = 100_000.0
    price = 100.0

    # ── 2% tier: [65%, 70%) ──────────────────────────────────────────────────
    for c in (0.65, 0.67, 0.699):
        r = sizer.compute(c, price, pv, cfg)
        _assert(r.pct_of_portfolio == 0.02,
                f"Conviction {c:.3f} should be 2% tier, got {r.pct_of_portfolio}")
        _assert(_approx(r.notional, 2_000.0),
                f"Conviction {c:.3f}: notional should be $2,000, got {r.notional}")
        _assert(_approx(r.shares, 20.0),
                f"Conviction {c:.3f}: shares should be 20.0, got {r.shares}")

    # ── 3% tier: [70%, 80%) ──────────────────────────────────────────────────
    for c in (0.70, 0.75, 0.799):
        r = sizer.compute(c, price, pv, cfg)
        _assert(r.pct_of_portfolio == 0.03,
                f"Conviction {c:.3f} should be 3% tier, got {r.pct_of_portfolio}")
        _assert(_approx(r.notional, 3_000.0), f"Notional mismatch at {c:.3f}")
        _assert(_approx(r.shares, 30.0), f"Shares mismatch at {c:.3f}")

    # ── 4% tier: [80%, ∞) without override ──────────────────────────────────
    for c in (0.80, 0.85, 0.95, 1.0):
        r = sizer.compute(c, price, pv, cfg)
        _assert(r.pct_of_portfolio == 0.04,
                f"Conviction {c:.3f} should be 4% tier (no override), got {r.pct_of_portfolio}")
        _assert(_approx(r.notional, 4_000.0), f"Notional mismatch at {c:.3f}")
        _assert(_approx(r.shares, 40.0), f"Shares mismatch at {c:.3f}")

    print("  [PASS] Tier boundaries (no override)")


def test_max_position_override() -> None:
    sizer = PositionSizer()
    pv = 100_000.0
    price = 100.0
    cfg_override = PortfolioConfig(paper_balance=100_000, allow_max_position=True)

    # Top tier with override → 5%
    for c in (0.80, 0.90, 1.0):
        r = sizer.compute(c, price, pv, cfg_override)
        _assert(r.pct_of_portfolio == 0.05,
                f"Conviction {c:.2f} with override should be 5%, got {r.pct_of_portfolio}")
        _assert("manual override" in r.tier_label,
                f"Tier label should mention manual override: {r.tier_label}")
        _assert(_approx(r.notional, 5_000.0), "Notional should be $5,000 with override")
        _assert(_approx(r.shares, 50.0), "Shares should be 50 with override")

    # Mid and low tiers are unaffected by the override flag
    r_mid = sizer.compute(0.72, price, pv, cfg_override)
    _assert(r_mid.pct_of_portfolio == 0.03, "3% tier unaffected by override")

    r_low = sizer.compute(0.66, price, pv, cfg_override)
    _assert(r_low.pct_of_portfolio == 0.02, "2% tier unaffected by override")

    print("  [PASS] allow_max_position=True override")


def test_hard_cap_enforced() -> None:
    """Notional must never exceed max_position_pct even on a misconfigured tier."""
    sizer = PositionSizer()
    cfg = PortfolioConfig(
        paper_balance=100_000,
        max_position_pct=0.05,
        tier_high_pct=0.10,     # deliberately wrong — should be capped at 5%
        allow_max_position=False,
    )
    r = sizer.compute(0.90, 100.0, 100_000.0, cfg)
    _assert(
        r.notional <= cfg.max_position_pct * 100_000.0,
        f"Notional ${r.notional:,.2f} exceeds hard cap $5,000"
    )
    print("  [PASS] Hard cap enforcement")


def test_fractional_price() -> None:
    """Shares should divide correctly for a fractional-cent price."""
    sizer = PositionSizer()
    cfg = PortfolioConfig(paper_balance=100_000)
    # 3% of $100,000 = $3,000 / $295.63 ≈ 10.1478 shares
    r = sizer.compute(0.72, 295.63, 100_000.0, cfg)
    _assert(r.pct_of_portfolio == 0.03, "Should be 3% tier")
    expected_shares = 3_000.0 / 295.63
    _assert(_approx(r.shares, expected_shares, tol=0.0001),
            f"Expected {expected_shares:.4f} shares, got {r.shares:.4f}")
    print(f"  [PASS] Fractional price — {r.shares:.4f} shares @ $295.63")


# ---------------------------------------------------------------------------
# 2. Portfolio value accounting
# ---------------------------------------------------------------------------

def test_portfolio_value_accounting() -> None:
    """_current_portfolio_value() stays correct through a buy then sell cycle."""
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        # Use confidence=0.75 (3% tier) → $3,000 at $200/share = 15 shares
        wf = _make_workflow(tmpdir, signal="buy", confidence=0.75)

        # Initially: no transactions, no open positions → paper balance
        initial_pv = wf._current_portfolio_value()
        _assert(
            _approx(initial_pv, 100_000.0),
            f"Initial portfolio value should be $100,000, got ${initial_pv:,.2f}"
        )

        # Open a BUY position @ $200 (3% tier → $3,000 / $200 = 15 shares)
        r1 = wf.run("AAPL", data={"price": 200.0})
        _assert(r1.ledger_action == "opened", f"Expected opened, got {r1.ledger_action}")
        _assert(_approx(r1.transaction.shares, 15.0, tol=0.001),
                f"Expected 15 shares @ $200, got {r1.transaction.shares:.4f}")

        # After BUY: cash decreased by $3,000, open position adds $3,000 back
        # → portfolio value unchanged at $100,000
        pv_after_buy = wf._current_portfolio_value()
        _assert(
            _approx(pv_after_buy, 100_000.0, tol=0.01),
            f"Portfolio value should still be ~$100,000 after buy, got ${pv_after_buy:,.2f}"
        )

        # Now SELL at $220: P&L = (220-200)*15 = $300
        wf_sell = InvestmentReviewWorkflow(
            session=_PresetSession(signal="sell", confidence=0.80),
            decision_store=wf.decision_store,
            position_store=wf.position_store,
            transaction_store=wf.transaction_store,
            settings=wf.settings,
        )
        r2 = wf_sell.run("AAPL", data={"price": 220.0})
        _assert(r2.ledger_action == "closed", f"Expected closed, got {r2.ledger_action}")

        pv_after_sell = wf_sell._current_portfolio_value()
        _assert(
            _approx(pv_after_sell, 100_300.0, tol=0.10),
            f"Portfolio value after selling at profit should be ~$100,300, got ${pv_after_sell:,.2f}"
        )

    print("  [PASS] Portfolio value accounting through buy/sell")


# ---------------------------------------------------------------------------
# 3. End-to-end workflow: conviction tier → correct shares
# ---------------------------------------------------------------------------

def test_workflow_2pct_tier() -> None:
    """65–69% confidence → 2% notional, correct shares."""
    with tempfile.TemporaryDirectory() as tmp:
        # confidence=0.67 → 2% tier → $2,000 / $250 = 8 shares
        wf = _make_workflow(Path(tmp), signal="buy", confidence=0.67)
        r = wf.run("TSLA", data={"price": 250.0})

        _assert(r.ledger_action == "opened", f"Expected opened, got {r.ledger_action}")
        _assert(_approx(r.transaction.shares, 8.0, tol=0.001),
                f"Expected 8.0 shares, got {r.transaction.shares:.4f}")
        _assert(_approx(r.size_result.notional, 2_000.0),
                f"Expected $2,000 notional, got ${r.size_result.notional:,.2f}")
        _assert(r.position.size_tier == "2% tier",
                f"Expected '2% tier', got '{r.position.size_tier}'")

    print("  [PASS] Workflow 2% tier (confidence 67%)")


def test_workflow_3pct_tier() -> None:
    """70–79% confidence → 3% notional, correct shares."""
    with tempfile.TemporaryDirectory() as tmp:
        # confidence=0.75 → 3% tier → $3,000 / $200 = 15 shares
        wf = _make_workflow(Path(tmp), signal="buy", confidence=0.75)
        r = wf.run("AAPL", data={"price": 200.0})

        _assert(r.ledger_action == "opened", f"Expected opened, got {r.ledger_action}")
        _assert(_approx(r.transaction.shares, 15.0, tol=0.001),
                f"Expected 15.0 shares, got {r.transaction.shares:.4f}")
        _assert(_approx(r.size_result.notional, 3_000.0),
                f"Expected $3,000 notional, got ${r.size_result.notional:,.2f}")
        _assert(r.position.size_pct == 0.03,
                f"Expected size_pct=0.03, got {r.position.size_pct}")

    print("  [PASS] Workflow 3% tier (confidence 75%)")


def test_workflow_4pct_tier() -> None:
    """≥80% confidence without override → 4% notional."""
    with tempfile.TemporaryDirectory() as tmp:
        # confidence=0.85 → 4% tier → $4,000 / $500 = 8 shares
        wf = _make_workflow(Path(tmp), signal="buy", confidence=0.85)
        r = wf.run("NVDA", data={"price": 500.0})

        _assert(r.ledger_action == "opened", f"Expected opened, got {r.ledger_action}")
        _assert(_approx(r.transaction.shares, 8.0, tol=0.001),
                f"Expected 8.0 shares, got {r.transaction.shares:.4f}")
        _assert(_approx(r.size_result.notional, 4_000.0),
                f"Expected $4,000 notional, got ${r.size_result.notional:,.2f}")
        _assert("4%" in r.position.size_tier,
                f"Expected 4% tier label, got '{r.position.size_tier}'")

    print("  [PASS] Workflow 4% tier (confidence 85%, no override)")


def test_workflow_5pct_override() -> None:
    """≥80% confidence with allow_max_position=True → 5% notional."""
    with tempfile.TemporaryDirectory() as tmp:
        # confidence=0.85, override=True → 5% → $5,000 / $400 = 12.5 shares
        wf = _make_workflow(
            Path(tmp), signal="buy", confidence=0.85,
            allow_max_position=True,
        )
        r = wf.run("MSFT", data={"price": 400.0})

        _assert(r.ledger_action == "opened", f"Expected opened, got {r.ledger_action}")
        _assert(_approx(r.transaction.shares, 12.5, tol=0.001),
                f"Expected 12.5 shares, got {r.transaction.shares:.4f}")
        _assert(_approx(r.size_result.notional, 5_000.0),
                f"Expected $5,000 notional, got ${r.size_result.notional:,.2f}")
        _assert("manual override" in r.position.size_tier,
                f"Expected manual override in tier label, got '{r.position.size_tier}'")

    print("  [PASS] Workflow 5% tier (confidence 85%, allow_max_position=True)")


def test_below_threshold_no_size() -> None:
    """Confidence below threshold → PASS, no SizeResult or Transaction."""
    with tempfile.TemporaryDirectory() as tmp:
        # confidence 0.60 < default 65% threshold
        wf = _make_workflow(Path(tmp), signal="buy", confidence=0.60)
        r = wf.run("AMZN", data={"price": 180.0})

        _assert(r.ledger_action == "passed",
                f"Expected 'passed' below threshold, got '{r.ledger_action}'")
        _assert(r.size_result is None, "SizeResult should be None when action is passed")
        _assert(r.transaction is None, "Transaction should be None when action is passed")

    print("  [PASS] Below threshold → PASS, no sizing")


# ---------------------------------------------------------------------------
# 4. Persistence verification
# ---------------------------------------------------------------------------

def test_position_fields_persisted() -> None:
    """Position written to the ledger file carries all three sizing fields."""
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        wf = _make_workflow(tmpdir, signal="buy", confidence=0.75)
        wf.run("GOOGL", data={"price": 190.0})

        raw = json.loads((tmpdir / "positions.json").read_text())
        pos_data = raw["GOOGL"]

        _assert("target_notional" in pos_data, "target_notional missing from persisted position")
        _assert("size_pct" in pos_data, "size_pct missing from persisted position")
        _assert("size_tier" in pos_data, "size_tier missing from persisted position")
        _assert(_approx(pos_data["target_notional"], 3_000.0),
                f"Expected target_notional $3,000, got {pos_data['target_notional']}")
        _assert(_approx(pos_data["size_pct"], 0.03),
                f"Expected size_pct 0.03, got {pos_data['size_pct']}")
        _assert(pos_data["size_tier"] == "3% tier",
                f"Expected '3% tier', got '{pos_data['size_tier']}'")

    print("  [PASS] Sizing fields persisted to ledger JSON")


def test_old_position_loads_without_sizing_fields() -> None:
    """A position JSON that predates the sizing fields loads with safe defaults."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "positions.json"
        old_data = {
            "AAPL": {
                "ticker": "AAPL",
                "shares": 1.0,
                "avg_cost": 227.50,
                "opened_at": "2025-01-06T09:30:00+00:00",
                "status": "open",
                "closed_at": "",
            }
        }
        path.write_text(json.dumps(old_data))

        store = PositionStore(path)
        pos = store.get("AAPL")

        _assert(pos is not None, "Old position should load")
        _assert(pos.target_notional == 0.0,
                f"target_notional should default to 0.0, got {pos.target_notional}")
        _assert(pos.size_pct == 0.0, f"size_pct should default to 0.0")
        _assert(pos.size_tier == "", f"size_tier should default to ''")
        _assert(pos.shares == 1.0, "shares should be 1.0")

    print("  [PASS] Old position JSON (no sizing fields) loads with safe defaults")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("\nPosition Sizing Tests")
    print("=" * 50)

    print("\n[Unit] PositionSizer")
    test_tier_boundaries()
    test_max_position_override()
    test_hard_cap_enforced()
    test_fractional_price()

    print("\n[Integration] Portfolio value + workflow")
    test_portfolio_value_accounting()
    test_workflow_2pct_tier()
    test_workflow_3pct_tier()
    test_workflow_4pct_tier()
    test_workflow_5pct_override()
    test_below_threshold_no_size()

    print("\n[Persistence]")
    test_position_fields_persisted()
    test_old_position_loads_without_sizing_fields()

    print("\n" + "=" * 50)
    print("All sizing tests passed.")


if __name__ == "__main__":
    main()
