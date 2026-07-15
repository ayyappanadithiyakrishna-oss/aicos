"""Alert monitor — evaluates trigger conditions against the ledger and records alerts.

Trigger conditions:
  1. Committee confidence crosses the conviction threshold for a watchlist ticker.
  2. An open position's unrealized P&L crosses ±PNL_ALERT_PCT.
  3. A pending-queue item has waited for approval longer than STALE_HOURS.

Output is the append-only AlertStore. No external notification (email/SMS) — the
dashboard surfaces unacknowledged alerts. Alerts are deduplicated by dedup_key so a
persisting condition fires once until acknowledged (see AlertStore.record_if_new).
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from config.settings import Settings
from ledger.alerts.store import (
    KIND_CONVICTION,
    KIND_PNL,
    KIND_STALE_PENDING,
    Alert,
    AlertStore,
)
from ledger.decisions.store import DecisionStore
from ledger.pending.store import PendingStore
from ledger.positions.store import PositionStore

logger = logging.getLogger(__name__)

# Unrealized P&L magnitude (fraction) that trips a position alert.
PNL_ALERT_PCT = 0.10
# How long a pending item may wait for review before it is flagged as stale.
STALE_HOURS = 24.0


def _parse_ts(ts: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(ts)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


class AlertMonitor:
    def __init__(
        self,
        alert_store: AlertStore,
        decision_store: DecisionStore,
        position_store: PositionStore,
        pending_store: PendingStore,
        settings: Settings | None = None,
        price_fn: Callable[[str], float | None] | None = None,
        watchlist: list[str] | None = None,
        pnl_threshold: float = PNL_ALERT_PCT,
        stale_hours: float = STALE_HOURS,
    ):
        self.alerts = alert_store
        self.decisions = decision_store
        self.positions = position_store
        self.pending = pending_store
        self.settings = settings or Settings()
        # price_fn maps a ticker to a current price (or None). When absent, P&L
        # crossings cannot be evaluated and are simply skipped.
        self.price_fn = price_fn
        self._watchlist = watchlist
        self.pnl_threshold = pnl_threshold
        self.stale_hours = stale_hours

    # ── Public API ────────────────────────────────────────────────────────────

    def evaluate(self, now: datetime | None = None) -> list[Alert]:
        """Run every trigger condition and record any new alerts.

        Returns only the alerts newly recorded on this pass (deduped ones excluded).
        """
        now = now or datetime.now(tz=timezone.utc)
        new: list[Alert] = []
        new += self._check_conviction()
        new += self._check_pnl()
        new += self._check_stale_pending(now)
        return new

    # ── 1. Conviction crossings on watchlist tickers ──────────────────────────

    def _check_conviction(self) -> list[Alert]:
        threshold = self.settings.committee.conviction_threshold
        watchlist = {t.upper() for t in self._load_watchlist()}
        if not watchlist:
            return []

        # Latest decision per ticker (decisions are appended chronologically).
        latest: dict[str, dict] = {}
        for d in self.decisions.load_all():
            tk = str(d.get("ticker", "")).upper()
            if tk:
                latest[tk] = d

        out: list[Alert] = []
        for tk, d in latest.items():
            if tk not in watchlist:
                continue
            conf = d.get("confidence")
            if conf is None or conf < threshold:
                continue
            ts = d.get("timestamp", "")
            signal = str(d.get("signal", "")).upper()
            # Dedup on the specific decision so a *new* crossing (a later decision
            # for the same ticker) can alert again, but re-running over the same
            # decision does not.
            dedup = f"{KIND_CONVICTION}:{tk}:{ts}"
            alert = AlertStore.make(
                kind=KIND_CONVICTION,
                ticker=tk,
                severity="warning",
                title="Conviction crossed threshold",
                message=(
                    f"{tk} committee confidence {conf:.1%} ≥ threshold {threshold:.1%} "
                    f"(signal {signal or 'n/a'})."
                ),
                dedup_key=dedup,
                context={"confidence": conf, "threshold": threshold,
                         "signal": d.get("signal", ""), "decision_ts": ts},
            )
            if self.alerts.record_if_new(alert) is not None:
                out.append(alert)
        return out

    # ── 2. Unrealized P&L crossings on open positions ─────────────────────────

    def _check_pnl(self) -> list[Alert]:
        if self.price_fn is None:
            return []
        out: list[Alert] = []
        for pos in self.positions.all_open():
            if not pos.avg_cost:
                continue
            price = self.price_fn(pos.ticker)
            if price is None:
                continue
            pnl_pct = price / pos.avg_cost - 1.0
            if abs(pnl_pct) < self.pnl_threshold:
                continue
            direction = "gain" if pnl_pct >= 0 else "loss"
            upnl = (price - pos.avg_cost) * pos.shares
            # Dedup per position + direction: a +10% gain alerts once; a later
            # move into a -10% loss is a distinct crossing and alerts separately.
            dedup = f"{KIND_PNL}:{pos.ticker.upper()}:{direction}"
            alert = AlertStore.make(
                kind=KIND_PNL,
                ticker=pos.ticker.upper(),
                severity="critical" if direction == "loss" else "warning",
                title=f"Position P&L {'+' if pnl_pct >= 0 else ''}{pnl_pct:.0%}",
                message=(
                    f"{pos.ticker.upper()} unrealized P&L {pnl_pct:+.1%} "
                    f"(${upnl:+,.2f}) crossed ±{self.pnl_threshold:.0%} "
                    f"— entry ${pos.avg_cost:.2f}, now ${price:.2f}."
                ),
                dedup_key=dedup,
                context={"pnl_pct": pnl_pct, "unrealized": upnl,
                         "avg_cost": pos.avg_cost, "price": price,
                         "threshold": self.pnl_threshold},
            )
            if self.alerts.record_if_new(alert) is not None:
                out.append(alert)
        return out

    # ── 3. Stale pending-queue items ──────────────────────────────────────────

    def _check_stale_pending(self, now: datetime) -> list[Alert]:
        out: list[Alert] = []
        for rec in self.pending.get_all_pending():
            created = _parse_ts(rec.created_at)
            if created is None:
                continue
            waited_h = (now - created).total_seconds() / 3600.0
            if waited_h < self.stale_hours:
                continue
            dedup = f"{KIND_STALE_PENDING}:{rec.id}"
            alert = AlertStore.make(
                kind=KIND_STALE_PENDING,
                ticker=rec.ticker.upper(),
                severity="warning",
                title="Pending review overdue",
                message=(
                    f"{rec.ticker.upper()} {rec.proposed_action.upper()} has awaited "
                    f"approval {waited_h:.0f}h (> {self.stale_hours:.0f}h) — "
                    f"{rec.proposed_shares:.4f} shares, ${rec.proposed_notional:,.2f}."
                ),
                dedup_key=dedup,
                context={"pending_id": rec.id, "waited_hours": waited_h,
                         "created_at": rec.created_at},
            )
            if self.alerts.record_if_new(alert) is not None:
                out.append(alert)
        return out

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _load_watchlist(self) -> list[str]:
        if self._watchlist is not None:
            return self._watchlist
        p = Path("config/watchlist.json")
        if not p.exists():
            return []
        try:
            return json.loads(p.read_text()).get("tickers", [])
        except Exception:
            return []
