import json
from pathlib import Path
from dataclasses import dataclass, asdict


@dataclass
class Position:
    ticker: str
    shares: float
    avg_cost: float
    opened_at: str
    status: str = "open"  # "open" | "closed"


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
        return {k: Position(**v) for k, v in raw.items()}

    def _save(self) -> None:
        with self.path.open("w") as f:
            json.dump({k: asdict(v) for k, v in self._positions.items()}, f, indent=2)

    def upsert(self, position: Position) -> None:
        self._positions[position.ticker] = position
        self._save()

    def get(self, ticker: str) -> Position | None:
        return self._positions.get(ticker)

    def all_open(self) -> list[Position]:
        return [p for p in self._positions.values() if p.status == "open"]
