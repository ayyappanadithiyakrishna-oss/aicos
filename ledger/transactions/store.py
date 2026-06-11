import json
from dataclasses import dataclass, asdict
from pathlib import Path


@dataclass
class Transaction:
    id: str
    ticker: str
    action: str         # "buy" | "sell"
    shares: float
    price: float
    timestamp: str      # ISO-8601
    decision_ref: str = ""   # timestamp of the CommitteeResult that triggered this
    notes: str = ""          # human-readable reasoning (threshold met, signal, confidence)


class TransactionStore:
    def __init__(self, path: Path = Path("ledger/transactions/transactions.jsonl")):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def record(self, tx: Transaction) -> None:
        with self.path.open("a") as f:
            f.write(json.dumps(asdict(tx)) + "\n")

    def load_all(self) -> list[Transaction]:
        if not self.path.exists():
            return []
        with self.path.open() as f:
            return [Transaction(**json.loads(line)) for line in f if line.strip()]
