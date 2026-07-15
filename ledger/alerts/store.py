import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

# Alert kinds — the trigger condition that produced the alert.
KIND_CONVICTION = "conviction"        # committee confidence crossed the conviction threshold
KIND_PNL = "pnl"                      # an open position's unrealized P&L crossed ±threshold
KIND_STALE_PENDING = "stale_pending"  # a pending-queue item has waited too long for review


@dataclass
class Alert:
    id: str
    kind: str               # KIND_CONVICTION | KIND_PNL | KIND_STALE_PENDING
    ticker: str
    severity: str           # "info" | "warning" | "critical"
    title: str              # short headline, e.g. "Conviction crossed threshold"
    message: str            # human-readable detail
    dedup_key: str          # stable key so the same condition alerts once until acknowledged
    created_at: str         # ISO-8601
    acknowledged: bool = False
    acknowledged_at: str = ""            # ISO-8601 or ""
    context: dict = field(default_factory=dict)  # extra structured data (confidence, pnl_pct, …)


def _new_id(kind: str) -> str:
    return f"{kind}-{uuid.uuid4().hex[:10]}"


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


class AlertStore:
    """Append-only alert log.

    Follows the ledger convention: existing records are never edited or deleted.
    The file is an event log with two record kinds:

        {"event": "alert", ...Alert fields...}
        {"event": "ack",   "alert_id": "...", "acknowledged_at": "..."}

    Acknowledgement appends an ``ack`` event rather than mutating the original
    alert, so the on-disk history stays immutable. ``load_all`` folds the ack
    events back onto their alerts when reconstructing the current state.
    """

    def __init__(self, path: Path = Path("ledger/alerts/alerts.jsonl")):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    # ── Persistence ───────────────────────────────────────────────────────────

    def _append(self, record: dict) -> None:
        with self.path.open("a") as f:
            f.write(json.dumps(record) + "\n")

    def load_all(self) -> list[Alert]:
        if not self.path.exists():
            return []
        alerts: dict[str, Alert] = {}
        acks: dict[str, str] = {}
        with self.path.open() as f:
            for line in f:
                if not line.strip():
                    continue
                rec = json.loads(line)
                if rec.get("event") == "ack":
                    acks[rec["alert_id"]] = rec.get("acknowledged_at", "")
                else:  # "alert" (default for forward-compat)
                    rec.pop("event", None)
                    alerts[rec["id"]] = Alert(**rec)
        for alert_id, acked_at in acks.items():
            a = alerts.get(alert_id)
            if a is not None:
                a.acknowledged = True
                a.acknowledged_at = acked_at
        return sorted(alerts.values(), key=lambda a: a.created_at)

    # ── Write API ─────────────────────────────────────────────────────────────

    def record(self, alert: Alert) -> Alert:
        """Append a new alert unconditionally."""
        self._append({"event": "alert", **asdict(alert)})
        return alert

    def record_if_new(self, alert: Alert) -> Alert | None:
        """Append the alert only if no unacknowledged alert shares its dedup_key.

        Returns the recorded alert, or None when a live duplicate already exists.
        This is what keeps a persisting condition (P&L stuck above +10%, a still-open
        high-conviction call) from re-alerting on every evaluation pass. Once the
        existing alert is acknowledged, a fresh crossing can alert again.
        """
        if alert.dedup_key in self.active_dedup_keys():
            return None
        return self.record(alert)

    def acknowledge(self, alert_id: str) -> Alert | None:
        """Append an ack event for the given alert id."""
        current = {a.id: a for a in self.load_all()}
        alert = current.get(alert_id)
        if alert is None or alert.acknowledged:
            return None
        acked_at = _now_iso()
        self._append({"event": "ack", "alert_id": alert_id, "acknowledged_at": acked_at})
        alert.acknowledged = True
        alert.acknowledged_at = acked_at
        return alert

    # ── Read API ──────────────────────────────────────────────────────────────

    def unacknowledged(self) -> list[Alert]:
        return [a for a in self.load_all() if not a.acknowledged]

    def active_dedup_keys(self) -> set[str]:
        return {a.dedup_key for a in self.load_all() if not a.acknowledged}

    # ── Factory ───────────────────────────────────────────────────────────────

    @staticmethod
    def make(
        *,
        kind: str,
        ticker: str,
        severity: str,
        title: str,
        message: str,
        dedup_key: str,
        context: dict | None = None,
    ) -> Alert:
        return Alert(
            id=_new_id(kind),
            kind=kind,
            ticker=ticker,
            severity=severity,
            title=title,
            message=message,
            dedup_key=dedup_key,
            created_at=_now_iso(),
            acknowledged=False,
            acknowledged_at="",
            context=context or {},
        )
