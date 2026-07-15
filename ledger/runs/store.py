"""Append-only run log.

Records one summary per scheduler/watchlist run — the "the system ran today and
here is what it decided" audit trail, distinct from the per-ticker decision log in
`ledger/decisions`. A RunRecord aggregates a whole run (counts, timings, the tickers
touched) and links back to the individual decisions it produced via `decision_refs`.

Same convention as the decision/transaction ledgers: newline-delimited JSON,
append-only, never edited or deleted. Kept free of orchestrator imports so the
ledger layer stays self-contained; callers build the RunRecord and hand it in.
"""

import json
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class RunRecord:
    run_id: str
    run_at: str                    # ISO-8601 UTC — when the run executed
    trading_day: str               # YYYY-MM-DD (ET) the run is attributed to
    trigger: str                   # "scheduled" | "manual" | "cli"
    market_status: str             # market label at run time, e.g. "OPEN", "CLOSED"
    watchlist_path: str

    tickers_analysed: int
    actionable: int               # opened + closed
    opened: int
    closed: int
    held: int
    passed: int
    errored: int

    open_positions: int
    total_unrealized_pnl: float | None
    elapsed_seconds: float

    decision_refs: list[str] = field(default_factory=list)  # decision timestamps written
    tickers: list[dict] = field(default_factory=list)       # [{ticker, signal, confidence, action, error}]
    notes: str = ""


def new_run_id() -> str:
    return f"run-{uuid.uuid4().hex[:12]}"


class RunStore:
    def __init__(self, path: Path = Path("ledger/runs/runs.jsonl")):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def record(self, record: RunRecord) -> RunRecord:
        with self.path.open("a") as f:
            f.write(json.dumps(asdict(record)) + "\n")
        return record

    def load_all(self) -> list[RunRecord]:
        if not self.path.exists():
            return []
        with self.path.open() as f:
            return [RunRecord(**json.loads(line)) for line in f if line.strip()]

    def latest(self) -> RunRecord | None:
        records = self.load_all()
        return records[-1] if records else None

    def for_trading_day(self, trading_day: str) -> list[RunRecord]:
        return [r for r in self.load_all() if r.trading_day == trading_day]

    def has_run_on(self, trading_day: str, trigger: str | None = None) -> bool:
        """True if a run is already logged for `trading_day` (optionally for a
        specific trigger). Used by the scheduler to enforce once-per-trading-day."""
        for r in self.load_all():
            if r.trading_day == trading_day and (trigger is None or r.trigger == trigger):
                return True
        return False
