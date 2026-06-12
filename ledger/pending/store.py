import json
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class PendingRecommendation:
    id: str
    decision_ref: str       # timestamp key into DecisionStore
    ticker: str
    signal: str             # "buy" | "sell" | "reduce" | "avoid"
    confidence: float
    proposed_action: str    # "buy" | "sell"
    proposed_price: float   # price at decision time
    proposed_shares: float
    proposed_notional: float
    size_tier: str
    status: str             # "pending" | "approved" | "rejected"
    created_at: str         # ISO-8601
    reviewed_at: str        # ISO-8601 or ""
    review_reason: str      # rejection reason or ""


def _new_id(ticker: str) -> str:
    return f"{ticker.upper()}-{uuid.uuid4().hex[:10]}"


class PendingStore:
    def __init__(self, path: Path = Path("ledger/pending/pending.json")):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._items: dict[str, PendingRecommendation] = self._load()

    # ── Persistence ───────────────────────────────────────────────────────────

    def _load(self) -> dict[str, PendingRecommendation]:
        if not self.path.exists():
            return {}
        try:
            raw = json.loads(self.path.read_text())
            return {k: PendingRecommendation(**v) for k, v in raw.items()}
        except Exception:
            return {}

    def _save(self) -> None:
        self.path.write_text(
            json.dumps({k: asdict(v) for k, v in self._items.items()}, indent=2)
        )

    # ── Write API ─────────────────────────────────────────────────────────────

    def add(self, rec: PendingRecommendation) -> None:
        self._items[rec.id] = rec
        self._save()

    def approve(self, item_id: str) -> PendingRecommendation | None:
        rec = self._items.get(item_id)
        if rec is None or rec.status != "pending":
            return None
        rec.status = "approved"
        rec.reviewed_at = datetime.now(tz=timezone.utc).isoformat()
        self._save()
        return rec

    def reject(self, item_id: str, reason: str) -> PendingRecommendation | None:
        rec = self._items.get(item_id)
        if rec is None or rec.status != "pending":
            return None
        rec.status = "rejected"
        rec.reviewed_at = datetime.now(tz=timezone.utc).isoformat()
        rec.review_reason = reason
        self._save()
        return rec

    # ── Read API ──────────────────────────────────────────────────────────────

    def get(self, item_id: str) -> PendingRecommendation | None:
        return self._items.get(item_id)

    def get_all_pending(self) -> list[PendingRecommendation]:
        return [r for r in self._items.values() if r.status == "pending"]

    def get_all(self) -> list[PendingRecommendation]:
        return list(self._items.values())

    # ── Factory ───────────────────────────────────────────────────────────────

    @staticmethod
    def make(
        *,
        decision_ref: str,
        ticker: str,
        signal: str,
        confidence: float,
        proposed_action: str,
        proposed_price: float,
        proposed_shares: float,
        proposed_notional: float,
        size_tier: str,
    ) -> PendingRecommendation:
        return PendingRecommendation(
            id=_new_id(ticker),
            decision_ref=decision_ref,
            ticker=ticker,
            signal=signal,
            confidence=confidence,
            proposed_action=proposed_action,
            proposed_price=proposed_price,
            proposed_shares=proposed_shares,
            proposed_notional=proposed_notional,
            size_tier=size_tier,
            status="pending",
            created_at=datetime.now(tz=timezone.utc).isoformat(),
            reviewed_at="",
            review_reason="",
        )
