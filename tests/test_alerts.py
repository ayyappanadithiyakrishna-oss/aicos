"""Alert store + monitor tests — temp dirs, no API calls."""

from datetime import datetime, timedelta, timezone
from pathlib import Path

from config.settings import CommitteeConfig, Settings
from ledger.alerts.store import (
    KIND_CONVICTION,
    KIND_PNL,
    KIND_STALE_PENDING,
    AlertStore,
)
from ledger.decisions.store import DecisionStore
from ledger.pending.store import PendingStore, PendingRecommendation
from ledger.positions.store import Position, PositionStore
from orchestrator.workflows.alerts import AlertMonitor


def _stores(tmp: Path):
    return (
        AlertStore(tmp / "alerts" / "alerts.jsonl"),
        DecisionStore(tmp / "decisions" / "history.jsonl"),
        PositionStore(tmp / "positions" / "positions.json"),
        PendingStore(tmp / "pending" / "pending.json"),
    )


def _settings(threshold=0.65):
    return Settings(committee=CommitteeConfig(conviction_threshold=threshold))


# ── AlertStore: append-only + acknowledgement ─────────────────────────────────

def test_store_record_and_unacknowledged(tmp_path):
    store = AlertStore(tmp_path / "alerts.jsonl")
    a = store.record(AlertStore.make(
        kind=KIND_CONVICTION, ticker="AAPL", severity="warning",
        title="t", message="m", dedup_key="k1",
    ))
    assert [x.id for x in store.unacknowledged()] == [a.id]

    store.acknowledge(a.id)
    assert store.unacknowledged() == []
    # Reloading from disk preserves the acknowledgement (append-only ack event).
    assert AlertStore(tmp_path / "alerts.jsonl").unacknowledged() == []


def test_store_dedup_until_acknowledged(tmp_path):
    store = AlertStore(tmp_path / "alerts.jsonl")
    mk = lambda: AlertStore.make(
        kind=KIND_PNL, ticker="MSFT", severity="warning",
        title="t", message="m", dedup_key="pnl:MSFT:gain",
    )
    assert store.record_if_new(mk()) is not None
    assert store.record_if_new(mk()) is None          # deduped while live
    acked = store.unacknowledged()[0]
    store.acknowledge(acked.id)
    assert store.record_if_new(mk()) is not None      # can re-alert once cleared


# ── AlertMonitor: the three trigger conditions ────────────────────────────────

class _Res:
    """Minimal stand-in for CommitteeResult accepted by DecisionStore.record."""
    def __init__(self, ticker, confidence, signal="buy"):
        self.timestamp = datetime.now(tz=timezone.utc)
        self.ticker = ticker
        self.final_signal = signal
        self.confidence = confidence
        self.votes = []
        self.dissents = []
        self.dissent_summary = ""
        self.rationale = ""
        self.rounds = []


def test_conviction_trigger_only_for_watchlist_above_threshold(tmp_path):
    alerts, decisions, positions, pending = _stores(tmp_path)
    decisions.record(_Res("AAPL", 0.72), ledger_action="opened")   # watchlist, above
    decisions.record(_Res("MSFT", 0.40), ledger_action="passed")   # watchlist, below
    decisions.record(_Res("ZZZZ", 0.90), ledger_action="opened")   # not on watchlist

    mon = AlertMonitor(alerts, decisions, positions, pending,
                       settings=_settings(0.65), watchlist=["AAPL", "MSFT"])
    new = mon.evaluate()
    kinds = {(a.kind, a.ticker) for a in new}
    assert (KIND_CONVICTION, "AAPL") in kinds
    assert not any(a.ticker in ("MSFT", "ZZZZ") for a in new)
    # Re-running does not duplicate the same decision's alert.
    assert mon.evaluate() == []


def test_pnl_trigger_crosses_threshold(tmp_path):
    alerts, decisions, positions, pending = _stores(tmp_path)
    positions.upsert(Position(ticker="AAPL", shares=10, avg_cost=100.0,
                              opened_at="2026-01-01T00:00:00+00:00"))
    positions.upsert(Position(ticker="MSFT", shares=10, avg_cost=100.0,
                              opened_at="2026-01-01T00:00:00+00:00"))
    prices = {"AAPL": 112.0, "MSFT": 103.0}  # +12% trips, +3% does not

    mon = AlertMonitor(alerts, decisions, positions, pending,
                       settings=_settings(), price_fn=lambda t: prices.get(t),
                       watchlist=[])
    new = mon.evaluate()
    tickers = {a.ticker for a in new if a.kind == KIND_PNL}
    assert tickers == {"AAPL"}


def test_stale_pending_trigger(tmp_path):
    alerts, decisions, positions, pending = _stores(tmp_path)
    old = (datetime.now(tz=timezone.utc) - timedelta(hours=30)).isoformat()
    fresh = datetime.now(tz=timezone.utc).isoformat()
    pending.add(PendingRecommendation(
        id="AAPL-old", decision_ref="", ticker="AAPL", signal="buy", confidence=0.7,
        proposed_action="buy", proposed_price=100.0, proposed_shares=5.0,
        proposed_notional=500.0, size_tier="2% tier", status="pending",
        created_at=old, reviewed_at="", review_reason=""))
    pending.add(PendingRecommendation(
        id="MSFT-new", decision_ref="", ticker="MSFT", signal="buy", confidence=0.7,
        proposed_action="buy", proposed_price=100.0, proposed_shares=5.0,
        proposed_notional=500.0, size_tier="2% tier", status="pending",
        created_at=fresh, reviewed_at="", review_reason=""))

    mon = AlertMonitor(alerts, decisions, positions, pending,
                       settings=_settings(), watchlist=[])
    new = mon.evaluate()
    stale = {a.ticker for a in new if a.kind == KIND_STALE_PENDING}
    assert stale == {"AAPL"}
