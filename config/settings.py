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
class ScannerConfig:
    """Universe scanner filters (financedatabase-backed).

    Note: financedatabase reports market cap as an ordered category, not a dollar
    figure, so the floor is a tier name. Ordered smallest→largest:
        Nano Cap < Micro Cap < Small Cap < Mid Cap < Large Cap < Mega Cap
    ``market_cap_floor`` keeps that tier and every larger one.
    """

    # NYSE / NASDAQ MIC codes. Kept configurable but defaults to the scoped exchanges.
    mics: list[str] = field(default_factory=lambda: ["XNYS", "XNAS"])
    country: str = "United States"

    market_cap_floor: str = "Mid Cap"

    # Sector filters. Empty allowlist = all sectors permitted; denylist always subtracts.
    # Sector names must match financedatabase's set (e.g. "Information Technology",
    # "Health Care", "Financials", "Energy", "Utilities", …).
    sector_allowlist: list[str] = field(default_factory=list)
    sector_denylist: list[str] = field(default_factory=list)

    exclude_delisted: bool = True
    max_candidates: int = 250  # cap the written candidate list

    output_path: Path = Path("config/scanner_candidates.json")


@dataclass
class SchedulerConfig:
    """Daily watchlist scheduler.

    Fires once per weekday at (hour:minute) US/Eastern; the job itself re-checks
    market hours and enforces once-per-trading-day via the run ledger. Default is
    09:35 ET — five minutes after the regular open — so intraday prices are live.
    """

    hour: int = 9
    minute: int = 35
    timezone: str = "America/New_York"
    day_of_week: str = "mon-fri"          # cron field; weekends never fire
    misfire_grace_seconds: int = 3600      # tolerate a late wake-up within the hour


@dataclass
class Settings:
    ledger: LedgerConfig = field(default_factory=LedgerConfig)
    committee: CommitteeConfig = field(default_factory=CommitteeConfig)
    portfolio: PortfolioConfig = field(default_factory=PortfolioConfig)
    scanner: ScannerConfig = field(default_factory=ScannerConfig)
    scheduler: SchedulerConfig = field(default_factory=SchedulerConfig)
    model: str = "claude-opus-4-8"
    dry_run: bool = True
