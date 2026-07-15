"""US equity market-hours helpers (single source of truth).

Extracted from dashboard/app.py's original `_market_status()` so the dashboard and
the daily scheduler compute market state from the same logic. All boundaries are in
US/Eastern and match regular NYSE/NASDAQ sessions.

Note: this reflects weekday sessions only — it does not know about market holidays,
matching the original dashboard behaviour. "Trading day" here means Mon–Fri.
"""

from __future__ import annotations

from datetime import datetime

try:
    import zoneinfo
    _ET: "zoneinfo.ZoneInfo | None" = zoneinfo.ZoneInfo("America/New_York")
except Exception:  # pragma: no cover - zoneinfo present on py>=3.11
    _ET = None

# Session boundaries as minutes-since-midnight ET.
_PRE_OPEN = 240    # 04:00
_REG_OPEN = 570    # 09:30
_REG_CLOSE = 960   # 16:00
_AFTER_CLOSE = 1200  # 20:00


def _now_et(now: datetime | None = None) -> datetime | None:
    if now is not None:
        return now
    if _ET is None:
        return None
    return datetime.now(tz=_ET)


def market_status(now: datetime | None = None) -> tuple[str, str]:
    """Return (label, css_class); css_class ∈ {open, pre, after, closed}.

    Pass `now` (an ET-aware or naive datetime) to evaluate a specific moment;
    otherwise the current ET time is used.
    """
    dt = _now_et(now)
    if dt is None:
        return "–", "closed"
    if dt.weekday() >= 5:
        return "CLOSED", "closed"
    mins = dt.hour * 60 + dt.minute
    if _PRE_OPEN <= mins < _REG_OPEN:
        return "PRE-MARKET", "pre"
    if _REG_OPEN <= mins < _REG_CLOSE:
        return "OPEN", "open"
    if _REG_CLOSE <= mins < _AFTER_CLOSE:
        return "AFTER-HOURS", "after"
    return "CLOSED", "closed"


def is_trading_day(now: datetime | None = None) -> bool:
    """True on Mon–Fri (holidays not considered), else False."""
    dt = _now_et(now)
    if dt is None:
        return False
    return dt.weekday() < 5


def is_market_open(now: datetime | None = None) -> bool:
    """True only during the regular 09:30–16:00 ET session on a weekday."""
    return market_status(now)[1] == "open"


def trading_day_str(now: datetime | None = None) -> str:
    """The ET calendar date (YYYY-MM-DD) a run is attributed to."""
    dt = _now_et(now)
    if dt is None:
        dt = datetime.utcnow()
    return dt.strftime("%Y-%m-%d")
