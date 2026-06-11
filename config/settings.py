from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class LedgerConfig:
    base_path: Path = Path("ledger")


@dataclass
class CommitteeConfig:
    quorum: int = 3
    min_conviction: float = 0.6
    dissent_threshold: float = 0.3


@dataclass
class Settings:
    ledger: LedgerConfig = field(default_factory=LedgerConfig)
    committee: CommitteeConfig = field(default_factory=CommitteeConfig)
    model: str = "claude-sonnet-4-6"
    dry_run: bool = True
