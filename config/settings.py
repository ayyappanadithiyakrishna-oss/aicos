from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class LedgerConfig:
    base_path: Path = Path("ledger")


@dataclass
class CommitteeConfig:
    quorum: int = 3
    min_conviction: float = 0.6         # per-agent conviction floor (for future use)
    dissent_threshold: float = 0.3      # fraction of conviction weight on losing side that triggers a warning
    conviction_threshold: float = 0.65  # min committee confidence to open or close a position


@dataclass
class PortfolioConfig:
    paper_balance: float = 100_000.0    # starting paper capital in USD

    # Hard cap: no single position ever exceeds this fraction of current portfolio value.
    # At $100k inception this is $5,000.  Enforced unconditionally.
    max_position_pct: float = 0.05

    # Conviction-to-size tiers (fractions of current portfolio value):
    #   65% ≤ confidence < 70%  →  tier_low_pct
    #   70% ≤ confidence < 80%  →  tier_mid_pct
    #   confidence ≥ 80%        →  tier_high_pct  (or max_position_pct if allow_max_position)
    tier_low_pct: float = 0.02    # 2%
    tier_mid_pct: float = 0.03    # 3%
    tier_high_pct: float = 0.04   # 4%

    # Manual override: when True the top tier (conviction ≥ 80%) is sized at
    # max_position_pct (5%) instead of tier_high_pct (4%).
    # Requires a deliberate change to False → True so no position accidentally
    # reaches the hard cap without human intent.
    allow_max_position: bool = False


@dataclass
class Settings:
    ledger: LedgerConfig = field(default_factory=LedgerConfig)
    committee: CommitteeConfig = field(default_factory=CommitteeConfig)
    portfolio: PortfolioConfig = field(default_factory=PortfolioConfig)
    model: str = "claude-opus-4-8"
    dry_run: bool = True
