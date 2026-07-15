"""Universe scanner — proposes candidate tickers from the US equity universe.

Queries US equities on NYSE/NASDAQ via `financedatabase`, filtered by a market-cap
floor and a sector allow/deny list, and writes the result to
`config/scanner_candidates.json`.

This is deliberately decoupled from the committee: it does not open positions or
feed `InvestmentReviewWorkflow`. It only proposes tickers a human can promote into
`config/watchlist.json` (via the dashboard /scanner route).

`financedatabase` reports market cap as an ordered category, not a dollar amount, so
the "floor" is a tier name — see `MARKET_CAP_ORDER`.
"""

import json
import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from config.settings import ScannerConfig, Settings

logger = logging.getLogger(__name__)

# Ordered smallest → largest. Index is the ordinal used for floor comparison.
MARKET_CAP_ORDER = [
    "Nano Cap",
    "Micro Cap",
    "Small Cap",
    "Mid Cap",
    "Large Cap",
    "Mega Cap",
]


@dataclass
class Candidate:
    symbol: str
    name: str
    sector: str
    industry: str
    market_cap: str
    exchange: str
    mic: str


def _caps_at_or_above(floor: str) -> list[str]:
    """Return the market-cap tiers at or above `floor` (inclusive)."""
    try:
        i = MARKET_CAP_ORDER.index(floor)
    except ValueError:
        logger.warning("Unknown market_cap_floor %r; defaulting to all tiers.", floor)
        i = 0
    return MARKET_CAP_ORDER[i:]


class UniverseScanner:
    def __init__(self, settings: Settings | None = None, equities=None):
        self.config: ScannerConfig = (settings or Settings()).scanner
        # `equities` is injectable for tests (a stub exposing .select(...)); when
        # absent the real financedatabase.Equities() is created lazily in scan().
        self._equities = equities

    # ── Public API ────────────────────────────────────────────────────────────

    def scan(self, write: bool = True) -> dict:
        """Run the scan and (optionally) write config/scanner_candidates.json.

        Returns the full result document (metadata + candidates).
        """
        cfg = self.config
        allowed_caps = _caps_at_or_above(cfg.market_cap_floor)
        allowlist = {s for s in cfg.sector_allowlist}
        denylist = {s for s in cfg.sector_denylist}

        eq = self._equities or self._make_equities()
        # financedatabase applies country/mic/market_cap/allowlist server-side.
        # Denylist and max_candidates are applied here afterward.
        select_sector = list(allowlist) if allowlist else None
        df = eq.select(
            country=cfg.country,
            mic=cfg.mics,
            market_cap=allowed_caps,
            sector=select_sector,
            exclude_delisted=cfg.exclude_delisted,
        )

        candidates: list[Candidate] = []
        for symbol, row in df.iterrows():
            sector = _clean(row.get("sector"))
            if sector in denylist:
                continue
            candidates.append(
                Candidate(
                    symbol=str(symbol),
                    name=_clean(row.get("name")),
                    sector=sector,
                    industry=_clean(row.get("industry")),
                    market_cap=_clean(row.get("market_cap")),
                    exchange=_clean(row.get("exchange")),
                    mic=_clean(row.get("mic")),
                )
            )

        # Deterministic order: largest cap first, then symbol.
        cap_rank = {c: i for i, c in enumerate(MARKET_CAP_ORDER)}
        candidates.sort(key=lambda c: (-cap_rank.get(c.market_cap, -1), c.symbol))

        truncated = len(candidates) > cfg.max_candidates
        candidates = candidates[: cfg.max_candidates]

        result = {
            "generated_at": datetime.now(tz=timezone.utc).isoformat(),
            "filters": {
                "country": cfg.country,
                "mics": cfg.mics,
                "market_cap_floor": cfg.market_cap_floor,
                "market_cap_tiers": allowed_caps,
                "sector_allowlist": cfg.sector_allowlist,
                "sector_denylist": cfg.sector_denylist,
                "exclude_delisted": cfg.exclude_delisted,
                "max_candidates": cfg.max_candidates,
            },
            "count": len(candidates),
            "truncated": truncated,
            "candidates": [asdict(c) for c in candidates],
        }

        if write:
            self._write(result)
        return result

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _make_equities(self):
        try:
            import financedatabase as fd
        except ImportError as exc:  # pragma: no cover - environment dependent
            raise RuntimeError(
                "financedatabase is not installed. Add it with "
                "`pip install financedatabase` to run the universe scanner."
            ) from exc
        return fd.Equities()

    def _write(self, result: dict) -> None:
        path = self.config.output_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result, indent=2))
        logger.info("Wrote %d candidates to %s", result["count"], path)


def _clean(value) -> str:
    """Normalize a possibly-NaN / pandas value to a plain string."""
    if value is None:
        return ""
    try:
        # pandas NaN is a float that != itself
        if value != value:  # noqa: PLR0124
            return ""
    except Exception:
        pass
    s = str(value).strip()
    return "" if s.lower() in ("nan", "none", "<na>") else s


if __name__ == "__main__":  # pragma: no cover
    logging.basicConfig(level=logging.INFO)
    res = UniverseScanner().scan()
    print(f"{res['count']} candidates written to {Settings().scanner.output_path}")
