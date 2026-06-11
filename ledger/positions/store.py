import json
from dataclasses import dataclass, asdict
from pathlib import Path

# Fields added to Position over time — kept as defaults so old JSON
# records that predate them still deserialise correctly.
_POSITION_DEFAULTS = {
    "target_notional": 0.0,   # $ allocation at open (from sizing rule)
    "size_pct": 0.0,           # fraction of portfolio at open (0.03 = 3%)
    "size_tier": "",           # human label, e.g. "3% tier"
}


@dataclass
class Position:
    ticker: str
    shares: float
    avg_cost: float             # price per share at open
    opened_at: str              # ISO-8601 timestamp
    status: str = "open"        # "open" | "closed"
    closed_at: str = ""         # ISO-8601 timestamp; empty when still open
    target_notional: float = 0.0  # $ amount allocated by the sizing rule at open
    size_pct: float = 0.0         # fraction of portfolio used (0.03 = 3%)
    size_tier: str = ""           # tier label, e.g. "3% tier"


class PositionStore:
    def __init__(self, path: Path = Path("ledger/positions/positions.json")):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._positions: dict[str, Position] = self._load()

    def _load(self) -> dict[str, Position]:
        if not self.path.exists():
            return {}
        with self.path.open() as f:
            raw = json.load(f)
        # Merge defaults so old records without the sizing fields still work.
        return {
            k: Position(**{**_POSITION_DEFAULTS, **v})
            for k, v in raw.items()
        }

    def _save(self) -> None:
        with self.path.open("w") as f:
            json.dump({k: asdict(v) for k, v in self._positions.items()}, f, indent=2)

    def upsert(self, position: Position) -> None:
        self._positions[position.ticker] = position
        self._save()

    def close(self, ticker: str, closed_at: str) -> Position | None:
        pos = self._positions.get(ticker)
        if pos is None or pos.status != "open":
            return None
        pos.status = "closed"
        pos.closed_at = closed_at
        self._save()
        return pos

    def get(self, ticker: str) -> Position | None:
        return self._positions.get(ticker)

    def all_open(self) -> list[Position]:
        return [p for p in self._positions.values() if p.status == "open"]
