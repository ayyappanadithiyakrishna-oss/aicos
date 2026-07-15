"""
AICOS Web Dashboard — redesigned trading terminal.

Run from the aicos/ project root:
    python3 dashboard/app.py   →   http://localhost:5001

Data reads from local ledger + data/cache. No live API calls.
Approve/reject endpoints execute or discard pending committee recommendations.
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

_ROOT = Path(__file__).parent.parent.resolve()
os.chdir(_ROOT)
sys.path.insert(0, str(_ROOT))

try:
    import zoneinfo
    _ET = zoneinfo.ZoneInfo("America/New_York")
except Exception:
    _ET = None  # type: ignore[assignment]

from flask import Flask, Response, redirect, request, url_for

from benchmarks.metrics.performance import PerformanceTracker
from benchmarks.strategies.buy_and_hold import BuyAndHoldBenchmark
from config.settings import Settings
from ledger.alerts.store import AlertStore
from ledger.decisions.store import DecisionStore
from ledger.pending.store import PendingStore
from ledger.positions.store import Position, PositionStore
from ledger.transactions.store import Transaction, TransactionStore
from orchestrator.execution.alpaca_client import AlpacaPaperClient, AlpacaConfigError
from orchestrator.sizing.sizer import PositionSizer
from orchestrator.scheduling.market_hours import market_status
from orchestrator.workflows.alerts import AlertMonitor
from orchestrator.workflows.universe_scanner import UniverseScanner
from markupsafe import escape

app = Flask(__name__)

_SETTINGS    = Settings()
_DECISIONS   = DecisionStore()
_POSITIONS   = PositionStore()
_TXS         = TransactionStore()
_PENDING     = PendingStore()
_ALERTS      = AlertStore()
_SIZER       = PositionSizer()

_ALPACA: AlpacaPaperClient | None = None
try:
    _ALPACA = AlpacaPaperClient()
except AlpacaConfigError:
    pass


# ── Agent metadata ────────────────────────────────────────────────────────────

AGENT_NAMES: dict[str, str] = {
    "bear":           "Victoria Preservation",
    "bull":           "Maximilian Growth",
    "contrarian":     "Cassandra Cross",
    "devils_advocate":"Devlin Sharp",
    "future_looker":  "Aria Horizon",
}
AGENT_ROLES: dict[str, str] = {
    "bear": "Bear", "bull": "Bull", "contrarian": "Contrarian",
    "devils_advocate": "Devil's Advocate", "future_looker": "Future Looker",
}
AGENT_INIT: dict[str, str] = {
    "bear": "V", "bull": "M", "contrarian": "C",
    "devils_advocate": "D", "future_looker": "A",
}
AGENT_COLOR: dict[str, str] = {
    "bear":           "#EF4444",
    "bull":           "#22C55E",
    "contrarian":     "#8B5CF6",
    "devils_advocate":"#F59E0B",
    "future_looker":  "#3B82F6",
}

REJECT_REASONS = [
    "Data quality concern",
    "Market conditions changed since analysis",
    "Position concentration too high",
    "Manual conviction override — bearish",
    "Manual conviction override — bullish but wrong timing",
    "Other",
]

NAV_ITEMS = [
    ("/",           "Overview"),
    ("/history",    "History"),
    ("/benchmarks", "Benchmarks"),
    ("/sessions",   "Sessions"),
    ("/scanner",    "Scanner"),
    ("/graduation", "Graduation"),
    ("/approve",    "Approve"),
]


# ── Data helpers ──────────────────────────────────────────────────────────────

def _cached_price(ticker: str) -> float | None:
    p = _ROOT / "data" / "cache" / f"{ticker.upper()}.json"
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text())
        return data.get("key_ratios", {}).get("price")
    except Exception:
        return None


def _cached_info(ticker: str) -> dict:
    p = _ROOT / "data" / "cache" / f"{ticker.upper()}.json"
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text())
        return data.get("key_ratios", {})
    except Exception:
        return {}


def _portfolio_cash() -> tuple[float, float]:
    paper = _SETTINGS.portfolio.paper_balance
    cf = 0.0
    for tx in _TXS.load_all():
        n = tx.price * tx.shares
        cf -= n if tx.action == "buy" else -n
    cash = paper + cf
    open_cost = sum(p.avg_cost * p.shares for p in _POSITIONS.all_open())
    return cash + open_cost, cash


_RECON_TOLERANCE_ABS = 1.00   # $1
_RECON_TOLERANCE_PCT = 0.001  # 0.1%


def _alpaca_recon_warning(local_equity: float) -> str:
    """Return a warning banner HTML string if Alpaca equity diverges from local ledger."""
    if _ALPACA is None:
        return ""
    try:
        acct = _ALPACA.get_account()
    except Exception:
        return ""

    alpaca_eq = acct.equity
    diff = abs(alpaca_eq - local_equity)
    ref = max(abs(alpaca_eq), abs(local_equity), 1.0)
    pct_diff = diff / ref

    if diff <= _RECON_TOLERANCE_ABS and pct_diff <= _RECON_TOLERANCE_PCT:
        return ""

    return f"""
<div style="background:rgba(234,179,8,.12);border:1px solid rgba(234,179,8,.35);
            border-radius:8px;padding:12px 16px;margin-bottom:16px;
            font-size:13px;color:var(--txt1);display:flex;align-items:center;gap:10px">
  <span style="font-size:18px">⚠</span>
  <div>
    <strong>Ledger / Alpaca drift detected</strong><br>
    Local ledger equity: <span class="mono">${local_equity:,.2f}</span> &nbsp;·&nbsp;
    Alpaca paper equity: <span class="mono">${alpaca_eq:,.2f}</span> &nbsp;·&nbsp;
    Diff: <span class="mono">${diff:,.2f}</span> ({pct_diff:.2%})
  </div>
</div>"""


def _load_watchlist() -> list[str]:
    p = _ROOT / "config" / "watchlist.json"
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text()).get("tickers", [])
    except Exception:
        return []


def _promote_to_watchlist(symbol: str) -> bool:
    """Add a ticker to config/watchlist.json (dedup, preserving file shape).

    Returns True if the symbol was newly added, False if already present / invalid.
    """
    symbol = (symbol or "").strip().upper()
    if not symbol:
        return False
    p = _ROOT / "config" / "watchlist.json"
    try:
        data = json.loads(p.read_text()) if p.exists() else {}
    except Exception:
        data = {}
    tickers = data.get("tickers", [])
    if symbol in {t.upper() for t in tickers}:
        return False
    tickers.append(symbol)
    data["tickers"] = tickers
    p.write_text(json.dumps(data, indent=2) + "\n")
    return True


def _load_scanner_candidates() -> dict:
    p = _ROOT / "config" / "scanner_candidates.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())
    except Exception:
        return {}


def _market_status() -> tuple[str, str]:
    """Return (label, css_class). css_class is one of: open pre after closed.

    Delegates to orchestrator.scheduling.market_hours so the dashboard and the
    daily scheduler share one definition of market hours.
    """
    return market_status()


def _rel_time(ts_str: str) -> str:
    try:
        dt = datetime.fromisoformat(ts_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        secs = int((datetime.now(tz=timezone.utc) - dt).total_seconds())
        if secs < 60:   return f"{secs}s ago"
        if secs < 3600: return f"{secs // 60}m ago"
        if secs < 86400: return f"{secs // 3600}h ago"
        return f"{secs // 86400}d ago"
    except Exception:
        return "–"


def _build_equity_curve(pnl_pcts: list[float]) -> list[float]:
    eq, curve = 1.0, [1.0]
    for p in pnl_pcts:
        eq *= 1.0 + p
        curve.append(eq)
    return curve


# ── Formatting ────────────────────────────────────────────────────────────────

def _h(v: object) -> str:
    return str(escape(str(v)))


def _money(v: float | None, signed: bool = False) -> str:
    if v is None: return "–"
    if signed:
        return f"+${v:,.2f}" if v >= 0 else f"-${abs(v):,.2f}"
    return f"${v:,.2f}"


def _pct(v: float | None, signed: bool = False, d: int = 2) -> str:
    if v is None: return "–"
    fmt = f"+.{d}f" if (signed and v >= 0) else f".{d}f"
    return f"{v:{fmt}}%"


def _num(v: float | None, d: int = 2) -> str:
    if v is None: return "–"
    return f"{v:.{d}f}"


def _pnl_cls(v: float | None) -> str:
    if v is None: return "muted"
    return "gain" if v >= 0 else "loss"


def _conv_color(c: float) -> str:
    if c < 0.65: return "#475569"
    if c < 0.70: return "#F59E0B"
    if c < 0.80: return "#3B82F6"
    return "#22C55E"


def _signal_badge(sig: str, size: str = "sm") -> str:
    cls = f"sig-{sig.lower().replace(' ', '-')}"
    return f'<span class="badge {cls} badge-{size}">{_h(sig.upper())}</span>'


def _action_badge(action: str) -> str:
    cls = f"act-{action.lower()}"
    return f'<span class="badge {cls} badge-sm">{_h(action.upper())}</span>'


def _avatar(agent_id: str, size: str = "md") -> str:
    init = AGENT_INIT.get(agent_id, agent_id[0].upper())
    color = AGENT_COLOR.get(agent_id, "#475569")
    return (f'<span class="avatar avatar-{size}" '
            f'style="background:{color}22;color:{color};border-color:{color}40">'
            f'{init}</span>')


def _conv_bar(conviction: float | None, width: int = 80) -> str:
    if conviction is None:
        return '<span class="muted">–</span>'
    pct = int((conviction or 0) * 100)
    color = _conv_color(conviction or 0)
    return (f'<div class="conv-bar" style="width:{width}px">'
            f'<div class="conv-fill" style="width:{pct}%;background:{color}"></div>'
            f'</div>'
            f'<span class="conv-num" style="color:{color}">{pct}%</span>')


# ── CSS ───────────────────────────────────────────────────────────────────────

CSS = r"""
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600&family=Fira+Code:wght@400;500&display=swap');

:root {
  --bg:       #020617;
  --surface:  #0F172A;
  --card:     #1E293B;
  --hover:    #263148;
  --border:   #334155;
  --subtle:   #1E293B;
  --txt:      #F8FAFC;
  --txt2:     #94A3B8;
  --txt3:     #475569;
  --gain:     #22C55E;
  --loss:     #EF4444;
  --warn:     #F59E0B;
  --accent:   #3B82F6;
  --purple:   #8B5CF6;
  --gain-bg:  rgba(34,197,94,0.09);
  --loss-bg:  rgba(239,68,68,0.09);
  --warn-bg:  rgba(245,158,11,0.09);
  --accent-bg:rgba(59,130,246,0.09);
  --r:        4px;
  --sans:     'IBM Plex Sans', system-ui, sans-serif;
  --mono:     'Fira Code', ui-monospace, monospace;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; }

body {
  display: grid;
  grid-template-rows: 56px 40px 1fr;
  background: var(--bg);
  color: var(--txt);
  font-family: var(--sans);
  font-size: 13px;
  line-height: 1.5;
}

/* ── Header ── */
header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 1.25rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  z-index: 50;
}
.wordmark {
  font-family: var(--mono);
  font-size: 15px;
  font-weight: 500;
  letter-spacing: .12em;
  color: var(--txt);
}
.wordmark em { color: var(--accent); font-style: normal; }
.market-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: .08em;
  padding: 4px 12px;
  border-radius: 20px;
  border: 1px solid var(--border);
}
.market-pill .dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.market-pill.open   { border-color: rgba(34,197,94,.3); }
.market-pill.open   .dot { background: var(--gain); }
.market-pill.pre    { border-color: rgba(245,158,11,.3); }
.market-pill.pre    .dot { background: var(--warn); }
.market-pill.after  { border-color: rgba(245,158,11,.3); }
.market-pill.after  .dot { background: var(--warn); }
.market-pill.closed { border-color: var(--border); }
.market-pill.closed .dot { background: var(--txt3); }
.header-right {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}
.portfolio-val {
  font-family: var(--mono);
  font-size: 14px;
  font-weight: 500;
  color: var(--txt);
  font-variant-numeric: tabular-nums;
}

/* ── Nav tabs ── */
nav {
  display: flex;
  align-items: stretch;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 0 1.25rem;
  gap: 0;
}
nav a {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--txt3);
  text-decoration: none;
  border-bottom: 2px solid transparent;
  transition: color .15s, border-color .15s;
  position: relative;
}
nav a:hover { color: var(--txt2); }
nav a.active { color: var(--accent); border-bottom-color: var(--accent); }
.nav-badge {
  background: var(--loss);
  color: #fff;
  font-size: 9px;
  font-family: var(--mono);
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 10px;
  min-width: 16px;
  text-align: center;
}

/* ── 3-panel chrome ── */
.chrome {
  display: grid;
  grid-template-columns: 220px 1fr 280px;
  overflow: hidden;
  min-height: 0;
}

/* ── Sidebar ── */
.sidebar {
  overflow-y: auto;
  border-right: 1px solid var(--border);
  background: var(--surface);
  padding-bottom: 1rem;
}
.sb-section { border-bottom: 1px solid var(--border); padding: 10px 0; }
.sb-section:last-child { border-bottom: none; }
.sb-title {
  font-size: 9.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .1em;
  color: var(--txt3);
  padding: 4px 14px 6px;
}
.sb-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 14px;
  font-size: 12px;
}
.sb-key { color: var(--txt2); }
.sb-val { font-family: var(--mono); font-size: 11.5px; color: var(--txt); font-variant-numeric: tabular-nums; }
.sb-val.gain { color: var(--gain); }
.sb-val.loss { color: var(--loss); }
.sb-val.warn { color: var(--warn); }
.sb-val.dim  { color: var(--txt3); }
.wl-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 14px;
  cursor: default;
  transition: background .12s;
}
.wl-row:hover { background: var(--hover); }
.wl-ticker { font-family: var(--mono); font-size: 12px; font-weight: 500; letter-spacing: .04em; }
.wl-price  { font-family: var(--mono); font-size: 11.5px; color: var(--txt2); font-variant-numeric: tabular-nums; }

/* ── Main content ── */
main {
  overflow-y: auto;
  padding: 1.25rem;
  background: var(--bg);
}

/* ── Activity feed ── */
.feed {
  overflow-y: auto;
  border-left: 1px solid var(--border);
  background: var(--surface);
  padding-bottom: 1rem;
}
.feed-title {
  font-size: 9.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .1em;
  color: var(--txt3);
  padding: 10px 14px 6px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--surface);
  z-index: 10;
}
.feed-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 6px 8px;
  align-items: start;
  padding: 8px 14px;
  border-bottom: 1px solid var(--subtle);
  transition: background .12s;
}
.feed-item:hover { background: var(--hover); }
.feed-item:last-child { border-bottom: none; }
.feed-ticker { font-family: var(--mono); font-size: 12px; font-weight: 600; letter-spacing: .04em; }
.feed-meta   { font-size: 10.5px; color: var(--txt3); font-family: var(--mono); font-variant-numeric: tabular-nums; }
.feed-time   { font-size: 10px; color: var(--txt3); white-space: nowrap; grid-column: 3; grid-row: 1 / 3; align-self: center; }
.feed-badges { display: flex; gap: 4px; flex-wrap: wrap; grid-column: 1 / 3; }

/* ── Stat bar ── */
.stat-bar {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: var(--r);
  overflow: hidden;
  margin-bottom: 1.25rem;
}
.stat-cell {
  background: var(--surface);
  padding: 14px 18px;
}
.stat-lbl {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .09em;
  color: var(--txt3);
  margin-bottom: 5px;
}
.stat-num {
  font-family: var(--mono);
  font-size: 20px;
  font-weight: 500;
  color: var(--txt);
  font-variant-numeric: tabular-nums;
  letter-spacing: -.01em;
}
.stat-num.gain { color: var(--gain); }
.stat-num.loss { color: var(--loss); }
.stat-sub { font-size: 11px; color: var(--txt3); margin-top: 4px; font-family: var(--mono); font-variant-numeric: tabular-nums; }
.progress-wrap { margin-top: 6px; }
.progress-track { height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; }
.progress-fill  { height: 100%; border-radius: 2px; background: var(--accent); }

/* ── Tables ── */
.tbl-wrap {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r);
  overflow: auto;
  margin-bottom: 1.25rem;
}
.tbl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 14px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--surface);
  z-index: 5;
}
.tbl-lbl {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--txt3);
}
.tbl-count { font-family: var(--mono); font-size: 11px; color: var(--txt3); }

table { width: 100%; border-collapse: collapse; }
th {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--txt3);
  text-transform: uppercase;
  letter-spacing: .07em;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  text-align: left;
  background: var(--surface);
}
th.r, td.r { text-align: right; }
td {
  padding: 6px 12px;
  border-bottom: 1px solid var(--subtle);
  color: var(--txt);
  white-space: nowrap;
  vertical-align: middle;
}
tr:nth-child(4n+1) td, tr:nth-child(4n+2) td { background: var(--card); }
tr:nth-child(4n+3) td, tr:nth-child(4n+4) td { background: var(--surface); }
tr:hover td { background: var(--hover) !important; border-left: 2px solid var(--warn); padding-left: 10px; }
tr:last-child td { border-bottom: none; }
td.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
td.dim  { color: var(--txt3); font-family: var(--mono); font-variant-numeric: tabular-nums; }
td.muted { color: var(--txt2); font-family: var(--mono); font-variant-numeric: tabular-nums; }
td.gain { background: var(--gain-bg) !important; color: var(--gain); font-family: var(--mono); font-variant-numeric: tabular-nums; }
td.loss { background: var(--loss-bg) !important; color: var(--loss); font-family: var(--mono); font-variant-numeric: tabular-nums; }
.ticker { font-family: var(--mono); font-size: 12.5px; font-weight: 600; letter-spacing: .04em; }

/* ── Conviction bar ── */
.conv-wrap { display: flex; align-items: center; gap: 7px; }
.conv-bar { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
.conv-fill { height: 100%; border-radius: 2px; transition: width .3s; }
.conv-num  { font-family: var(--mono); font-size: 11.5px; font-variant-numeric: tabular-nums; }

/* ── Badges ── */
.badge {
  display: inline-flex;
  align-items: center;
  font-family: var(--mono);
  font-weight: 600;
  letter-spacing: .06em;
  border-radius: 3px;
  text-transform: uppercase;
  white-space: nowrap;
}
.badge-sm { font-size: 9.5px; padding: 2px 6px; }
.badge-md { font-size: 11px;  padding: 3px 8px; }
.badge-lg { font-size: 13px;  padding: 5px 12px; }

.sig-buy     { background: rgba(34,197,94,.15);   color: var(--gain); }
.sig-sell    { background: rgba(239,68,68,.15);   color: var(--loss); }
.sig-hold    { background: rgba(71,85,105,.2);    color: var(--txt2); }
.sig-reduce  { background: rgba(245,158,11,.15);  color: var(--warn); }
.sig-avoid   { background: rgba(239,68,68,.12);   color: #f87171; }
.sig-pass    { background: rgba(71,85,105,.12);   color: var(--txt3); }
.act-opened  { background: rgba(34,197,94,.12);   color: var(--gain); }
.act-closed  { background: rgba(239,68,68,.12);   color: var(--loss); }
.act-hold    { background: rgba(71,85,105,.15);   color: var(--txt2); }
.act-passed  { background: rgba(71,85,105,.1);    color: var(--txt3); }
.act-pending { background: rgba(245,158,11,.12);  color: var(--warn); }
.act-approved{ background: rgba(34,197,94,.12);   color: var(--gain); }
.act-rejected{ background: rgba(239,68,68,.12);   color: var(--loss); }

/* ── Avatar ── */
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-family: var(--mono);
  font-weight: 600;
  border: 1px solid transparent;
  flex-shrink: 0;
}
.avatar-sm { width: 22px; height: 22px; font-size: 10px; }
.avatar-md { width: 28px; height: 28px; font-size: 12px; }
.avatar-lg { width: 36px; height: 36px; font-size: 14px; }

/* ── Dissent banner ── */
.dissent-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  background: rgba(239,68,68,.08);
  border-left: 3px solid var(--loss);
  font-size: 11.5px;
  color: var(--loss);
  font-weight: 500;
  margin: 8px 0;
  border-radius: 0 var(--r) var(--r) 0;
}

/* ── Session cards ── */
.session-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r);
  margin-bottom: 10px;
  overflow: hidden;
  transition: border-color .15s;
}
.session-card:hover { border-color: var(--txt3); }
.card-top {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  flex-wrap: wrap;
}
.card-ticker {
  font-family: var(--mono);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: .04em;
  color: var(--txt);
  min-width: 70px;
}
.card-conf {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--txt2);
}
.card-conf .conf-bar { width: 60px; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
.card-conf .conf-fill { height: 100%; border-radius: 2px; }
.card-spacer { flex: 1; }
.card-time { font-size: 11px; color: var(--txt3); font-family: var(--mono); white-space: nowrap; }

.vote-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 0 16px 12px;
}
.vote-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 20px;
  font-size: 11px;
  border: 1px solid var(--border);
  background: var(--card);
}
.vote-chip.maj { border-color: rgba(34,197,94,.3);  background: rgba(34,197,94,.06); }
.vote-chip.dis { border-color: rgba(239,68,68,.3);  background: rgba(239,68,68,.06); }

/* ── Debate thread ── */
details.debate { border-top: 1px solid var(--border); }
details.debate summary {
  padding: 8px 16px;
  cursor: pointer;
  font-size: 11px;
  color: var(--txt3);
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
  user-select: none;
  transition: color .12s;
}
details.debate summary:hover { color: var(--txt2); }
details.debate summary::before { content: '▸'; font-size: 9px; transition: transform .15s; }
details.debate[open] summary::before { transform: rotate(90deg); }

.debate-body {
  padding: 14px 16px;
  background: var(--bg);
  border-top: 1px solid var(--border);
}
.round-sep {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .1em;
  color: var(--txt3);
  padding: 10px 0 6px;
  margin-top: 10px;
  border-bottom: 1px solid var(--border);
}
.round-sep:first-child { margin-top: 0; }
.bubble {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 0;
  border-bottom: 1px solid var(--subtle);
}
.bubble:last-child { border-bottom: none; }
.bubble-body { flex: 1; min-width: 0; }
.bubble-name { font-size: 12px; font-weight: 600; color: var(--txt); }
.bubble-role { font-size: 10.5px; color: var(--txt3); font-weight: 400; margin-left: 4px; }
.bubble-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
.bubble-vote { font-family: var(--mono); font-size: 10.5px; color: var(--txt3); }

.rationale-block {
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--card);
  border-radius: var(--r);
  border-left: 2px solid var(--border);
}
.rationale-lbl {
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .09em;
  color: var(--txt3);
  margin-bottom: 5px;
}
.rationale-txt {
  font-size: 12px;
  color: var(--txt2);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── Benchmarks ── */
.bm-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: var(--r);
  overflow: hidden;
  margin-bottom: 1.25rem;
}
.bm-col { background: var(--surface); padding: 16px 20px; }
.bm-hdr {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .08em;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}
.bm-col.aicos .bm-hdr { color: var(--accent); }
.bm-col.spy   .bm-hdr { color: var(--purple); }
.bm-col.qqq   .bm-hdr { color: #f97316; }
.bm-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid var(--subtle); font-size: 12px; }
.bm-row:last-child { border-bottom: none; }
.bm-key { color: var(--txt2); }
.bm-val { font-family: var(--mono); font-variant-numeric: tabular-nums; }

.delta-pos { color: var(--gain); font-family: var(--mono); font-variant-numeric: tabular-nums; }
.delta-neg { color: var(--loss); font-family: var(--mono); font-variant-numeric: tabular-nums; }
.delta-neu { color: var(--txt3); font-family: var(--mono); font-variant-numeric: tabular-nums; }

.edge-strip {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 18px;
  background: var(--accent-bg);
  border: 1px solid rgba(59,130,246,.2);
  border-radius: var(--r);
  margin-bottom: 1.25rem;
}
.edge-lbl { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; color: var(--accent); }
.edge-val { font-family: var(--mono); font-size: 16px; font-weight: 500; color: var(--txt); }
.edge-desc { font-size: 12px; color: var(--txt2); }

.chart-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); padding: 18px 20px; margin-bottom: 1.25rem; }
.chart-lbl { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--txt3); margin-bottom: 14px; }

/* ── Graduation ── */
.grad-status-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r);
  padding: 28px 20px;
  text-align: center;
  margin-bottom: 1.25rem;
}
.grad-lbl { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; color: var(--txt3); margin-bottom: 8px; }
.grad-val { font-family: var(--mono); font-size: 38px; font-weight: 600; letter-spacing: .06em; }
.grad-val.locked { color: var(--txt3); }
.grad-val.ready  { color: var(--gain); }
.grad-sub { font-size: 12px; color: var(--txt2); margin-top: 6px; }

.criteria-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: var(--r);
  overflow: hidden;
}
.criterion {
  background: var(--surface);
  padding: 14px 18px;
  display: grid;
  grid-template-columns: 36px 200px 1fr 160px 80px;
  gap: 14px;
  align-items: center;
}
.crit-icon { color: var(--txt3); display: flex; align-items: center; }
.crit-icon.met   { color: var(--gain); }
.crit-icon.unmet { color: var(--txt3); }
.crit-name { font-weight: 600; font-size: 12.5px; color: var(--txt); }
.crit-desc { font-size: 11.5px; color: var(--txt2); }
.crit-prog { display: flex; flex-direction: column; gap: 4px; }
.crit-track { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
.crit-fill { height: 100%; border-radius: 2px; }
.crit-fill.met   { background: var(--gain); }
.crit-fill.unmet { background: var(--txt3); }
.crit-nums { font-family: var(--mono); font-size: 11px; color: var(--txt2); font-variant-numeric: tabular-nums; }
.crit-badge { text-align: right; }
.badge-pass   { background: rgba(34,197,94,.15); color: var(--gain); }
.badge-locked { background: rgba(71,85,105,.15); color: var(--txt3); }

/* ── Approve page ── */
.approve-shell {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 680px;
  margin: 0 auto;
}
.pending-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  font-size: 11.5px;
  color: var(--txt3);
}
.pending-nav a {
  color: var(--txt2);
  text-decoration: none;
  font-family: var(--mono);
  font-size: 11px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r);
  transition: border-color .12s, color .12s;
}
.pending-nav a:hover { color: var(--txt); border-color: var(--txt3); }
.pending-nav a.disabled { pointer-events: none; opacity: .3; }

.approve-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r);
  overflow: hidden;
}
.ac-header { padding: 22px 24px 16px; border-bottom: 1px solid var(--border); }
.ac-ticker { font-family: var(--mono); font-size: 36px; font-weight: 600; letter-spacing: .06em; color: var(--txt); }
.ac-subtitle { font-size: 12px; color: var(--txt3); margin-top: 2px; font-family: var(--mono); }
.ac-conf-bar-wrap { margin-top: 12px; }
.ac-conf-track { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
.ac-conf-fill  { height: 100%; border-radius: 3px; }
.ac-conf-label { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; font-family: var(--mono); color: var(--txt3); }

.ac-votes { padding: 16px 24px; border-bottom: 1px solid var(--border); }
.ac-votes-title { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; color: var(--txt3); margin-bottom: 10px; }
.ac-vote-row {
  display: grid;
  grid-template-columns: 36px 1fr 80px auto 50px;
  gap: 10px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--subtle);
}
.ac-vote-row:last-child { border-bottom: none; }
.ac-agent-name { font-size: 12.5px; font-weight: 500; color: var(--txt); }
.ac-agent-role { font-size: 10.5px; color: var(--txt3); }
.ac-vote-num { font-family: var(--mono); font-size: 11px; color: var(--txt3); text-align: right; }

.ac-trade { padding: 16px 24px; border-bottom: 1px solid var(--border); background: var(--card); }
.ac-trade-title { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; color: var(--txt3); margin-bottom: 10px; }
.ac-trade-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ac-trade-row { display: flex; flex-direction: column; gap: 2px; }
.ac-trade-key { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--txt3); }
.ac-trade-val { font-family: var(--mono); font-size: 13px; font-variant-numeric: tabular-nums; color: var(--txt); }

.ac-actions { padding: 16px 24px; display: flex; align-items: flex-start; gap: 10px; }
.btn-approve {
  flex: 1;
  background: rgba(34,197,94,.15);
  color: var(--gain);
  border: 1px solid rgba(34,197,94,.4);
  border-radius: var(--r);
  padding: 12px 20px;
  font-size: 13px;
  font-weight: 600;
  font-family: var(--sans);
  cursor: pointer;
  letter-spacing: .04em;
  transition: background .15s, border-color .15s;
  text-align: center;
}
.btn-approve:hover { background: rgba(34,197,94,.25); border-color: rgba(34,197,94,.6); }

.reject-wrap { flex: 1; }
.btn-reject-toggle {
  width: 100%;
  background: rgba(239,68,68,.1);
  color: var(--loss);
  border: 1px solid rgba(239,68,68,.3);
  border-radius: var(--r);
  padding: 12px 20px;
  font-size: 13px;
  font-weight: 600;
  font-family: var(--sans);
  cursor: pointer;
  letter-spacing: .04em;
  transition: background .15s;
}
.btn-reject-toggle:hover { background: rgba(239,68,68,.18); }
.reject-form {
  display: none;
  margin-top: 8px;
  padding: 14px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--r);
}
.reject-form.open { display: block; }
.reject-form select {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r);
  color: var(--txt);
  font-family: var(--sans);
  font-size: 12.5px;
  padding: 7px 10px;
  margin-bottom: 10px;
  outline: none;
}
.reject-form select:focus { border-color: var(--accent); }
.reject-other { display: none; width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); color: var(--txt); font-family: var(--sans); font-size: 12.5px; padding: 7px 10px; margin-bottom: 10px; outline: none; resize: vertical; }
.reject-other.show { display: block; }
.btn-reject-confirm {
  width: 100%;
  background: var(--loss);
  color: #fff;
  border: none;
  border-radius: var(--r);
  padding: 9px;
  font-size: 13px;
  font-weight: 600;
  font-family: var(--sans);
  cursor: pointer;
  letter-spacing: .04em;
}

/* ── Empty / misc ── */
.empty { text-align: center; padding: 3rem 1rem; color: var(--txt3); font-size: 12px; }
.page-hdr { margin-bottom: 1rem; }
.page-title { font-size: 14px; font-weight: 600; letter-spacing: .01em; }
.page-sub { font-size: 11.5px; color: var(--txt3); margin-top: 2px; }
.search-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 1rem; }
.search-input {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--r);
  color: var(--txt);
  font-family: var(--mono);
  font-size: 12.5px;
  padding: 6px 10px;
  width: 130px;
  outline: none;
  text-transform: uppercase;
  transition: border-color .15s;
}
.search-input:focus { border-color: var(--accent); }
.btn-sm {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--r);
  color: var(--txt2);
  font-size: 11.5px;
  padding: 6px 12px;
  cursor: pointer;
  font-family: var(--sans);
  transition: color .12s;
}
.btn-sm:hover { color: var(--txt); }

/* ── Scanner ── */
.scan-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}
.filter-strip {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  flex: 1;
  padding: 10px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r);
}
.filter-item { display: flex; flex-direction: column; gap: 2px; }
.filter-key { font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .09em; color: var(--txt3); }
.filter-val { font-family: var(--mono); font-size: 12px; color: var(--txt); font-variant-numeric: tabular-nums; }
.btn-run {
  background: var(--accent-bg);
  color: var(--accent);
  border: 1px solid rgba(59,130,246,.4);
  border-radius: var(--r);
  padding: 10px 18px;
  font-size: 12.5px;
  font-weight: 600;
  font-family: var(--sans);
  cursor: pointer;
  letter-spacing: .03em;
  white-space: nowrap;
  transition: background .15s, border-color .15s;
}
.btn-run:hover { background: rgba(59,130,246,.18); border-color: rgba(59,130,246,.6); }
.btn-promote {
  background: rgba(34,197,94,.12);
  color: var(--gain);
  border: 1px solid rgba(34,197,94,.35);
  border-radius: var(--r);
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--sans);
  cursor: pointer;
  letter-spacing: .03em;
  transition: background .12s;
}
.btn-promote:hover { background: rgba(34,197,94,.22); }
.pill-on-wl {
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  color: var(--txt3);
  background: var(--card);
  border: 1px solid var(--border);
  padding: 3px 9px;
  border-radius: 10px;
  white-space: nowrap;
}
.cap-badge {
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 3px;
  background: rgba(139,92,246,.15);
  color: var(--purple);
}

/* ── Alerts panel ── */
.alerts-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r);
  overflow: hidden;
  margin-bottom: 1.25rem;
}
.alerts-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--border);
}
.alerts-lbl {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--warn);
}
.alerts-count {
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  background: var(--warn);
  padding: 1px 6px;
  border-radius: 10px;
}
.alert-row {
  display: grid;
  grid-template-columns: 4px 64px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 11px 14px;
  border-bottom: 1px solid var(--subtle);
}
.alert-row:last-child { border-bottom: none; }
.alert-accent { width: 4px; height: 100%; border-radius: 2px; align-self: stretch; }
.alert-accent.warning  { background: var(--warn); }
.alert-accent.critical { background: var(--loss); }
.alert-accent.info     { background: var(--accent); }
.alert-ticker { font-family: var(--mono); font-size: 13px; font-weight: 600; letter-spacing: .04em; }
.alert-body { min-width: 0; }
.alert-title { font-size: 12.5px; font-weight: 600; color: var(--txt); }
.alert-msg { font-size: 11.5px; color: var(--txt2); margin-top: 2px; }
.alert-time { font-size: 10.5px; color: var(--txt3); font-family: var(--mono); margin-top: 3px; }
.btn-ack {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--r);
  color: var(--txt2);
  font-size: 11px;
  font-weight: 600;
  font-family: var(--sans);
  padding: 6px 12px;
  cursor: pointer;
  letter-spacing: .03em;
  transition: color .12s, border-color .12s;
}
.btn-ack:hover { color: var(--txt); border-color: var(--txt3); }

::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--txt3); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
"""

# ── Count-up JS ───────────────────────────────────────────────────────────────

COUNTUP_JS = r"""
<script>
(function() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('[data-cu]').forEach(el => { el.textContent = el.dataset.final; });
    return;
  }
  document.querySelectorAll('[data-cu]').forEach(el => {
    const target = parseFloat(el.dataset.cu);
    const final  = el.dataset.final || '';
    const pre    = el.dataset.pre || '';
    const suf    = el.dataset.suf || '';
    const dec    = parseInt(el.dataset.dec || '2');
    const sign   = el.dataset.sign === '1';
    const dur    = 600;
    const start  = performance.now();
    function fmt(v) {
      const abs = Math.abs(v);
      const s = abs.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      if (sign) return (v >= 0 ? '+' + pre + s : '-' + pre + s) + suf;
      return pre + s + suf;
    }
    function tick(now) {
      const p = Math.min((now - start) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
      el.textContent = fmt(target * e);
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = final || fmt(target);
    }
    requestAnimationFrame(tick);
  });
})();
</script>"""

REJECT_JS = """
<script>
function toggleReject(id) {
  var f = document.getElementById('rf-' + id);
  f.classList.toggle('open');
}
function checkOther(sel) {
  var ta = sel.closest('form').querySelector('.reject-other');
  ta.classList.toggle('show', sel.value === 'Other');
  if (sel.value !== 'Other') ta.name = '';
  else ta.name = 'reason_other';
}
</script>"""


# ── Shared chrome renderers ───────────────────────────────────────────────────

def _render_header(portfolio_val: float) -> str:
    status_label, status_cls = _market_status()
    try:
        et = datetime.now(tz=_ET) if _ET else datetime.utcnow()
        time_str = et.strftime("%H:%M:%S ET")
    except Exception:
        time_str = ""
    return f"""
<header>
  <span class="wordmark">AI<em>COS</em></span>
  <div class="market-pill {status_cls}">
    <span class="dot"></span>
    {_h(status_label)}&nbsp;&nbsp;{_h(time_str)}
  </div>
  <div class="header-right">
    <span class="portfolio-val" data-cu="{portfolio_val:.2f}" data-final="{_money(portfolio_val)}" data-pre="$" data-dec="2">{_money(portfolio_val)}</span>
  </div>
</header>"""


def _render_nav(active: str) -> str:
    pending_count = len(_PENDING.get_all_pending())
    items = ""
    for path, label in NAV_ITEMS:
        cls = ' class="active"' if path == active else ""
        badge = ""
        if path == "/approve" and pending_count:
            badge = f'<span class="nav-badge">{pending_count}</span>'
        items += f'<a href="{path}"{cls}>{_h(label)}{badge}</a>'
    return f"<nav>{items}</nav>"


def _render_sidebar() -> str:
    open_pos = _POSITIONS.all_open()
    _, cash = _portfolio_cash()
    pending_count = len(_PENDING.get_all_pending())
    all_decisions = _DECISIONS.load_all()
    last_run = _rel_time(all_decisions[-1]["timestamp"]) if all_decisions else "never"
    api_ok = bool(os.environ.get("ANTHROPIC_API_KEY"))
    mode = "PAPER" if _SETTINGS.dry_run else "LIVE"

    # unrealized
    total_unr = 0.0
    for pos in open_pos:
        cur = _cached_price(pos.ticker)
        if cur:
            total_unr += (cur - pos.avg_cost) * pos.shares

    unr_cls = "gain" if total_unr >= 0 else "loss"

    wl_tickers = _load_watchlist()
    wl_rows = ""
    for tk in wl_tickers[:12]:
        price = _cached_price(tk)
        price_str = f"${price:,.2f}" if price else "–"
        wl_rows += f"""
<div class="wl-row">
  <span class="wl-ticker">{_h(tk)}</span>
  <span class="wl-price">{price_str}</span>
</div>"""

    return f"""
<aside class="sidebar">
  <div class="sb-section">
    <div class="sb-title">System</div>
    <div class="sb-row"><span class="sb-key">Mode</span><span class="sb-val {'warn' if mode == 'LIVE' else 'dim'}">{mode}</span></div>
    <div class="sb-row"><span class="sb-key">API Key</span><span class="sb-val {'gain' if api_ok else 'loss'}">{'OK' if api_ok else 'MISSING'}</span></div>
    <div class="sb-row"><span class="sb-key">Last run</span><span class="sb-val dim">{_h(last_run)}</span></div>
    <div class="sb-row"><span class="sb-key">Pending</span><span class="sb-val {'warn' if pending_count else 'dim'}">{pending_count}</span></div>
  </div>
  <div class="sb-section">
    <div class="sb-title">Quick Stats</div>
    <div class="sb-row"><span class="sb-key">Open positions</span><span class="sb-val">{len(open_pos)}</span></div>
    <div class="sb-row"><span class="sb-key">Cash</span><span class="sb-val">{_money(cash)}</span></div>
    <div class="sb-row"><span class="sb-key">Unrealized</span><span class="sb-val {unr_cls}">{_money(total_unr, signed=True)}</span></div>
    <div class="sb-row"><span class="sb-key">Decisions</span><span class="sb-val dim">{len(all_decisions)}</span></div>
  </div>
  <div class="sb-section">
    <div class="sb-title">Watchlist</div>
    {wl_rows if wl_rows else '<div class="sb-row"><span class="sb-key dim">No watchlist loaded</span></div>'}
  </div>
</aside>"""


def _render_feed() -> str:
    decisions = list(reversed(_DECISIONS.load_all()))[:15]
    items = ""
    for d in decisions:
        ticker = d.get("ticker", "")
        ts = d.get("timestamp", "")
        signal = d.get("signal", "hold")
        action = d.get("ledger_action", "")
        conf = d.get("confidence")
        pct = f"{int((conf or 0)*100)}%" if conf is not None else "–"
        items += f"""
<div class="feed-item">
  <span class="feed-ticker">{_h(ticker)}</span>
  <span class="feed-meta">{pct}</span>
  <span class="feed-time">{_rel_time(ts)}</span>
  <div class="feed-badges">{_signal_badge(signal)}{_action_badge(action)}</div>
</div>"""
    return f"""
<aside class="feed">
  <div class="feed-title">Committee Activity</div>
  {items if items else '<div class="empty">No decisions yet.</div>'}
</aside>"""


def _page(title: str, active: str, body: str, extra_js: str = "") -> Response:
    portfolio_val, _ = _portfolio_cash()
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AICOS · {_h(title)}</title>
<style>{CSS}</style>
</head>
<body>
{_render_header(portfolio_val)}
{_render_nav(active)}
<div class="chrome">
  {_render_sidebar()}
  <main>{body}</main>
  {_render_feed()}
</div>
{COUNTUP_JS}
{extra_js}
</body>
</html>"""
    return Response(html, mimetype="text/html")


# ── Shared: debate transcript ─────────────────────────────────────────────────

def _render_transcript(rounds: list[dict], rationale: str, dissent_summary: str) -> str:
    if not rounds and not rationale and not dissent_summary:
        return ""
    ROUND_LABELS = {1: "Round 1 — Independent Analysis",
                    2: "Round 2 — Cross-Examination",
                    3: "Round 3 — Final Vote"}
    inner = ""
    for rnd in rounds:
        rnum = rnd.get("round", "?")
        inner += f'<div class="round-sep">{_h(ROUND_LABELS.get(rnum, f"Round {rnum}"))}</div>'
        for out in rnd.get("outputs", []):
            aid    = out.get("agent_id", "")
            sig    = out.get("signal", "")
            conv   = out.get("conviction")
            vote   = out.get("vote")
            conf   = out.get("confidence")
            name   = AGENT_NAMES.get(aid, aid.replace("_"," ").title())
            role   = AGENT_ROLES.get(aid, "")
            vote_str = " · ".join(filter(None, [
                f"v{vote}" if vote is not None else "",
                f"{conf}% conf" if conf is not None else "",
            ]))
            conv_html = ""
            if conv is not None:
                conv_html = f'<div class="conv-wrap">{_conv_bar(conv, 60)}</div>'
            inner += f"""
<div class="bubble">
  {_avatar(aid, "md")}
  <div class="bubble-body">
    <div><span class="bubble-name">{_h(name)}</span><span class="bubble-role">{_h(role)}</span></div>
    <div class="bubble-meta">
      {_signal_badge(sig)}
      {conv_html}
      <span class="bubble-vote">{_h(vote_str)}</span>
    </div>
  </div>
</div>"""
    if rationale:
        inner += f"""
<div class="rationale-block">
  <div class="rationale-lbl">Majority Rationale</div>
  <div class="rationale-txt">{_h(rationale)}</div>
</div>"""
    if dissent_summary and dissent_summary != "Unanimous committee decision.":
        inner += f"""
<div class="rationale-block" style="border-left-color:rgba(239,68,68,.5);margin-top:8px">
  <div class="rationale-lbl" style="color:var(--loss)">Dissent Summary</div>
  <div class="rationale-txt">{_h(dissent_summary)}</div>
</div>"""
    return f"""
<details class="debate">
  <summary>View full 3-round debate</summary>
  <div class="debate-body">{inner}</div>
</details>"""


# ── Alerts ────────────────────────────────────────────────────────────────────

def _refresh_alerts() -> None:
    """Evaluate trigger conditions and record any new alerts (deduped)."""
    try:
        AlertMonitor(
            alert_store=_ALERTS,
            decision_store=_DECISIONS,
            position_store=_POSITIONS,
            pending_store=_PENDING,
            settings=_SETTINGS,
            price_fn=_cached_price,
            watchlist=_load_watchlist(),
        ).evaluate()
    except Exception:
        pass  # dashboard must render even if alert evaluation hiccups


def _render_alerts() -> str:
    alerts = list(reversed(_ALERTS.unacknowledged()))
    if not alerts:
        return ""
    rows = ""
    for a in alerts:
        sev = a.severity if a.severity in ("warning", "critical", "info") else "info"
        rows += f"""
<div class="alert-row">
  <span class="alert-accent {sev}"></span>
  <span class="alert-ticker">{_h(a.ticker or "—")}</span>
  <div class="alert-body">
    <div class="alert-title">{_h(a.title)}</div>
    <div class="alert-msg">{_h(a.message)}</div>
    <div class="alert-time">{_rel_time(a.created_at)}</div>
  </div>
  <form method="post" action="/alerts/ack/{_h(a.id)}" style="margin:0">
    <button type="submit" class="btn-ack">Acknowledge</button>
  </form>
</div>"""
    return f"""
<div class="alerts-panel">
  <div class="alerts-head">
    <span class="alerts-lbl">Alerts</span>
    <span class="alerts-count">{len(alerts)}</span>
  </div>
  {rows}
</div>"""


@app.route("/alerts/ack/<alert_id>", methods=["POST"])
def acknowledge_alert(alert_id: str) -> Response:
    _ALERTS.acknowledge(alert_id)
    return redirect(url_for("overview"))


# ── / — Portfolio Overview ────────────────────────────────────────────────────

@app.route("/")
def overview() -> Response:
    _refresh_alerts()
    alerts_panel = _render_alerts()
    open_pos = _POSITIONS.all_open()
    decisions_by_ts = {d["timestamp"]: d for d in _DECISIONS.load_all()}
    portfolio_val, cash = _portfolio_cash()
    paper = _SETTINGS.portfolio.paper_balance

    total_unr = 0.0
    rows_html = ""
    for pos in sorted(open_pos, key=lambda p: p.opened_at, reverse=True):
        cur = _cached_price(pos.ticker)
        decision = decisions_by_ts.get(pos.opened_at, {})
        victoria_dissent = "bear" in decision.get("dissents", [])
        upnl = ((cur - pos.avg_cost) * pos.shares) if cur is not None else None
        upnl_pct = ((cur / pos.avg_cost - 1) * 100) if cur is not None else None
        if upnl:
            total_unr += upnl
        conviction = decision.get("confidence")
        size_pct = (pos.size_pct * 100) if pos.size_pct else None

        cur_td = (f'<td class="r mono">{_money(cur)}</td>' if cur
                  else '<td class="r dim">N/A</td>')
        unr_td = (f'<td class="r {_pnl_cls(upnl)}">{_money(upnl, signed=True)}</td>'
                  if upnl is not None else '<td class="r dim">–</td>')
        unrp_td = (f'<td class="r {_pnl_cls(upnl_pct)}">{_pct(upnl_pct, signed=True)}</td>'
                   if upnl_pct is not None else '<td class="r dim">–</td>')
        conv_html = (f'<div class="conv-wrap">{_conv_bar(conviction)}</div>'
                     if conviction is not None else '<span class="dim">–</span>')
        diss_td = ('<td><div class="dissent-banner" style="padding:3px 8px;margin:0;font-size:10px">▼ Bear</div></td>'
                   if victoria_dissent else "<td></td>")

        rows_html += f"""
<tr>
  <td><span class="ticker">{_h(pos.ticker)}</span></td>
  <td class="dim">{pos.opened_at[:10]}</td>
  <td class="r mono">{_money(pos.avg_cost)}</td>
  {cur_td}{unr_td}{unrp_td}
  <td class="r mono">{_pct(size_pct) if size_pct else "–"}</td>
  <td>{conv_html}</td>
  {diss_td}
</tr>"""

    cash_pct = (cash / paper * 100) if paper else 0
    unr_cls  = _pnl_cls(total_unr)
    ret_pct  = ((portfolio_val - paper) / paper * 100) if paper else 0

    stat_bar = f"""
<div class="stat-bar">
  <div class="stat-cell">
    <div class="stat-lbl">Portfolio Value</div>
    <div class="stat-num" data-cu="{portfolio_val:.2f}" data-final="{_money(portfolio_val)}" data-pre="$" data-dec="2">{_money(portfolio_val)}</div>
    <div class="stat-sub">{_pct(ret_pct, signed=True)} vs paper</div>
  </div>
  <div class="stat-cell">
    <div class="stat-lbl">Cash Deployed</div>
    <div class="stat-num">{_pct(100 - cash_pct)}</div>
    <div class="progress-wrap">
      <div class="progress-track"><div class="progress-fill" style="width:{min(100-cash_pct,100):.1f}%"></div></div>
    </div>
    <div class="stat-sub">{_money(cash)} undeployed</div>
  </div>
  <div class="stat-cell">
    <div class="stat-lbl">Unrealized P&amp;L</div>
    <div class="stat-num {unr_cls}" data-cu="{total_unr:.2f}" data-final="{_money(total_unr, signed=True)}" data-pre="$" data-sign="1" data-dec="2">{_money(total_unr, signed=True)}</div>
    <div class="stat-sub">across {len(open_pos)} position{"s" if len(open_pos) != 1 else ""}</div>
  </div>
  <div class="stat-cell">
    <div class="stat-lbl">Open Positions</div>
    <div class="stat-num" data-cu="{len(open_pos)}" data-final="{len(open_pos)}" data-pre="" data-dec="0">{len(open_pos)}</div>
    <div class="stat-sub">paper: ${paper:,.0f}</div>
  </div>
</div>"""

    table = ""
    if open_pos:
        table = f"""
<div class="tbl-wrap">
  <div class="tbl-head">
    <span class="tbl-lbl">Open Positions</span>
    <span class="tbl-count">{len(open_pos)}</span>
  </div>
  <table><thead><tr>
    <th>Ticker</th><th>Opened</th>
    <th class="r">Entry $</th><th class="r">Current $</th>
    <th class="r">Unreal. $</th><th class="r">Unreal. %</th>
    <th class="r">Size %</th><th>Conviction</th><th>Dissent</th>
  </tr></thead><tbody>{rows_html}</tbody></table>
</div>"""
    else:
        table = '<div class="tbl-wrap"><div class="empty">No open positions.</div></div>'

    recon_banner = _alpaca_recon_warning(portfolio_val)

    body = f"""
<div class="page-hdr">
  <div class="page-title">Portfolio Overview</div>
  <div class="page-sub">Read-only · prices from local cache · no live API calls</div>
</div>
{recon_banner}{alerts_panel}{stat_bar}{table}"""
    return _page("Overview", "/", body)


# ── /history — Trade History ──────────────────────────────────────────────────

@app.route("/history")
def history() -> Response:
    tracker = PerformanceTracker.from_ledger(_TXS, _DECISIONS)
    m = tracker.compute()
    closed = tracker.trades
    decisions_by_ts = {d["timestamp"]: d for d in _DECISIONS.load_all()}

    wr_cls = "gain" if m.win_rate >= 0.45 else ("warn" if m.win_rate >= 0.30 else "loss")
    stat_bar = f"""
<div class="stat-bar">
  <div class="stat-cell">
    <div class="stat-lbl">Realized P&amp;L</div>
    <div class="stat-num {_pnl_cls(m.total_pnl)}">{_money(m.total_pnl, signed=True)}</div>
    <div class="stat-sub">{_pct(m.total_return_pct, signed=True)} total return</div>
  </div>
  <div class="stat-cell">
    <div class="stat-lbl">Win Rate</div>
    <div class="stat-num {wr_cls}">{_pct(m.win_rate * 100)}</div>
    <div class="stat-sub">{m.num_wins}W · {m.num_losses}L · {m.num_trades} total</div>
  </div>
  <div class="stat-cell">
    <div class="stat-lbl">Avg Hold</div>
    <div class="stat-num">{_num(m.avg_hold_days, 1)}<span style="font-size:13px;color:var(--txt2)"> d</span></div>
    <div class="stat-sub">per closed trade</div>
  </div>
  <div class="stat-cell">
    <div class="stat-lbl">Avg Conviction (W/L)</div>
    <div class="stat-num">{_pct((m.avg_conviction_wins or 0)*100) if m.avg_conviction_wins else "–"}</div>
    <div class="stat-sub">vs {_pct((m.avg_conviction_losses or 0)*100) if m.avg_conviction_losses else "–"} on losses</div>
  </div>
</div>"""

    rows_html = ""
    for trade in reversed(closed):
        d = decisions_by_ts.get(trade.entry_decision_ref, {})
        pnl_cls = _pnl_cls(trade.pnl)
        rows_html += f"""
<tr>
  <td><span class="ticker">{_h(trade.ticker)}</span></td>
  <td class="dim">{trade.entry_date.strftime("%Y-%m-%d")}</td>
  <td class="dim">{trade.exit_date.strftime("%Y-%m-%d")}</td>
  <td class="r mono">{trade.hold_days}</td>
  <td class="r {pnl_cls}">{_money(trade.pnl, signed=True)}</td>
  <td class="r {pnl_cls}">{_pct(trade.pnl_pct * 100, signed=True)}</td>
  <td class="r mono">{_pct(trade.entry_conviction * 100)}</td>
</tr>
<tr><td colspan="7" style="padding:0">{_render_transcript(d.get("rounds",[]), d.get("rationale",""), d.get("dissent_summary",""))}</td></tr>"""

    table = ""
    if closed:
        table = f"""
<div class="tbl-wrap">
  <div class="tbl-head"><span class="tbl-lbl">Closed Trades</span><span class="tbl-count">{len(closed)}</span></div>
  <table><thead><tr>
    <th>Ticker</th><th>Entry</th><th>Exit</th>
    <th class="r">Hold (d)</th><th class="r">P&amp;L $</th><th class="r">P&amp;L %</th><th class="r">Conviction</th>
  </tr></thead><tbody>{rows_html}</tbody></table>
</div>"""
    else:
        table = '<div class="tbl-wrap"><div class="empty">No closed trades yet.</div></div>'

    body = f"""
<div class="page-hdr">
  <div class="page-title">Trade History</div>
  <div class="page-sub">Closed trades · expand each row for full 3-round debate</div>
</div>
{stat_bar}{table}"""
    return _page("History", "/history", body)


# ── /benchmarks ───────────────────────────────────────────────────────────────

@app.route("/benchmarks")
def benchmarks() -> Response:
    tracker = PerformanceTracker.from_ledger(_TXS, _DECISIONS)
    m = tracker.compute()
    closed = tracker.trades
    spy = BuyAndHoldBenchmark("SPY").run(closed)
    qqq = BuyAndHoldBenchmark("QQQ").run(closed)

    a_curve = _build_equity_curve([t.pnl_pct for t in closed])
    s_curve = _build_equity_curve([t.pnl_pct for t in spy.trades])
    q_curve = _build_equity_curve([t.pnl_pct for t in qqq.trades])
    n = max(len(a_curve), len(s_curve), len(q_curve))

    def _pad(c: list[float]) -> list[float]:
        return c + [c[-1]] * (n - len(c)) if c else [1.0] * n

    def _topct(c: list[float]) -> list[float]:
        return [round((v - 1) * 100, 4) for v in _pad(c)]

    a_pct = json.dumps(_topct(a_curve))
    s_pct = json.dumps(_topct(s_curve))
    q_pct = json.dumps(_topct(q_curve))
    labels = json.dumps(list(range(n)))

    edge_val, edge_desc = "–", "Insufficient data"
    if m.avg_conviction_wins and m.avg_conviction_losses:
        e = (m.avg_conviction_wins - m.avg_conviction_losses) * 100
        edge_val  = f"{'+' if e >= 0 else ''}{e:.1f}pp"
        edge_desc = (f"Avg conviction {m.avg_conviction_wins*100:.1f}% on wins vs "
                     f"{m.avg_conviction_losses*100:.1f}% on losses")

    def _bm_col(cls: str, name: str, tr: float | None, sh: float | None,
                dd: float | None, wr: float | None, n_trades: int,
                ann: float | None = None) -> str:
        ann_row = ""
        if ann is not None:
            ann_row = f'<div class="bm-row"><span class="bm-key">Ann. Return</span><span class="bm-val {_pnl_cls(ann)}">{_pct(ann, signed=True)}</span></div>'
        return f"""
<div class="bm-col {cls}">
  <div class="bm-hdr">{_h(name)}</div>
  <div class="bm-row"><span class="bm-key">Total Return</span><span class="bm-val {_pnl_cls(tr)}">{_pct(tr, signed=True)}</span></div>
  {ann_row}
  <div class="bm-row"><span class="bm-key">Sharpe Ratio</span><span class="bm-val">{_num(sh)}</span></div>
  <div class="bm-row"><span class="bm-key">Max Drawdown</span><span class="bm-val loss">{_pct(dd)}</span></div>
  <div class="bm-row"><span class="bm-key">Win Rate</span><span class="bm-val">{_pct(wr)}</span></div>
  <div class="bm-row"><span class="bm-key">Trades</span><span class="bm-val">{n_trades}</span></div>
</div>"""

    def _delta(a: float | None, b: float | None, higher_better: bool = True) -> str:
        if a is None or b is None: return '<span class="delta-neu">–</span>'
        d = a - b
        if abs(d) < 0.001: return '<span class="delta-neu">≈0</span>'
        better = (d > 0) == higher_better
        cls = "delta-pos" if better else "delta-neg"
        return f'<span class="{cls}">{d:+.2f}</span>'

    delta_rows = ""
    for label, av, sv, qv, hb in [
        ("Total Return %", m.total_return_pct, spy.total_return_pct, qqq.total_return_pct, True),
        ("Sharpe Ratio",   m.sharpe_ratio,     spy.sharpe_ratio,     qqq.sharpe_ratio,     True),
        ("Max Drawdown %", m.max_drawdown_pct, spy.max_drawdown_pct, qqq.max_drawdown_pct, False),
        ("Win Rate %",     m.win_rate*100 if m.win_rate else None,
                           spy.win_rate*100, qqq.win_rate*100,                            True),
    ]:
        delta_rows += f"""
<tr>
  <td>{_h(label)}</td>
  <td class="r mono">{_pct(av, signed=True) if isinstance(av, float) and "Rate" in label or "Return" in label else _num(av)}</td>
  <td class="r mono">{_pct(sv, signed=True) if isinstance(sv, float) and "Rate" in label or "Return" in label else _num(sv)}</td>
  <td class="r mono">{_pct(qv, signed=True) if isinstance(qv, float) and "Rate" in label or "Return" in label else _num(qv)}</td>
  <td class="r">{_delta(av, sv, hb)}</td>
  <td class="r">{_delta(av, qv, hb)}</td>
</tr>"""

    chart_js = f"""<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
(function(){{
  const ctx = document.getElementById('ec').getContext('2d');
  new Chart(ctx, {{
    type:'line',
    data:{{
      labels:{labels},
      datasets:[
        {{label:'AICOS',data:{a_pct},borderColor:'#3B82F6',backgroundColor:'rgba(59,130,246,.06)',borderWidth:2,pointRadius:0,tension:.2,fill:false}},
        {{label:'SPY',  data:{s_pct},borderColor:'#8B5CF6',backgroundColor:'transparent',borderWidth:1.5,borderDash:[4,3],pointRadius:0,tension:.2,fill:false}},
        {{label:'QQQ',  data:{q_pct},borderColor:'#f97316',backgroundColor:'transparent',borderWidth:1.5,borderDash:[2,3],pointRadius:0,tension:.2,fill:false}},
      ]
    }},
    options:{{
      responsive:true,maintainAspectRatio:true,
      interaction:{{mode:'index',intersect:false}},
      plugins:{{
        legend:{{labels:{{color:'#94A3B8',font:{{family:"'IBM Plex Sans',sans-serif",size:11}},boxWidth:20}}}},
        tooltip:{{backgroundColor:'#0F172A',borderColor:'#334155',borderWidth:1,titleColor:'#F8FAFC',bodyColor:'#94A3B8',
          callbacks:{{label:function(c){{return ' '+c.dataset.label+': '+(c.parsed.y>=0?'+':'')+c.parsed.y.toFixed(2)+'%'}}}}}}
      }},
      scales:{{
        x:{{ticks:{{color:'#475569',font:{{size:10}}}},grid:{{color:'#1E293B'}},title:{{display:true,text:'Trade #',color:'#475569',font:{{size:10}}}}}},
        y:{{ticks:{{color:'#94A3B8',font:{{family:"'IBM Plex Sans',sans-serif",size:10}},callback:function(v){{return (v>=0?'+':'')+v.toFixed(1)+'%'}}}},grid:{{color:'#1E293B'}}}}
      }}
    }}
  }});
}})();
</script>"""

    body = f"""
<div class="page-hdr">
  <div class="page-title">Benchmark Comparison</div>
  <div class="page-sub">AICOS vs SPY and QQQ buy-and-hold on identical capital deployments</div>
</div>
<div class="edge-strip">
  <span class="edge-lbl">Conviction Edge</span>
  <span class="edge-val">{_h(edge_val)}</span>
  <span class="edge-desc">{_h(edge_desc)}</span>
</div>
<div class="bm-grid">
  {_bm_col("aicos","AICOS",m.total_return_pct,m.sharpe_ratio,m.max_drawdown_pct,m.win_rate*100 if m.win_rate else None,m.num_trades,m.annualized_return_pct)}
  {_bm_col("spy","SPY Buy &amp; Hold",spy.total_return_pct,spy.sharpe_ratio,spy.max_drawdown_pct,spy.win_rate*100,spy.num_trades)}
  {_bm_col("qqq","QQQ Buy &amp; Hold",qqq.total_return_pct,qqq.sharpe_ratio,qqq.max_drawdown_pct,qqq.win_rate*100,qqq.num_trades)}
</div>
<div class="chart-wrap">
  <div class="chart-lbl">Cumulative Return — Equity Curve</div>
  <canvas id="ec" height="80"></canvas>
</div>
<div class="tbl-wrap">
  <div class="tbl-head"><span class="tbl-lbl">Head-to-Head Delta (AICOS − Benchmark)</span></div>
  <table><thead><tr>
    <th>Metric</th><th class="r">AICOS</th><th class="r">SPY</th><th class="r">QQQ</th>
    <th class="r">vs SPY Δ</th><th class="r">vs QQQ Δ</th>
  </tr></thead><tbody>{delta_rows}</tbody></table>
</div>"""
    return _page("Benchmarks", "/benchmarks", body, extra_js=chart_js)


# ── /sessions ─────────────────────────────────────────────────────────────────

@app.route("/sessions")
def sessions() -> Response:
    ticker_filter = request.args.get("ticker", "").strip().upper()
    all_d = list(reversed(_DECISIONS.load_all()))
    filtered = [d for d in all_d if not ticker_filter or d.get("ticker") == ticker_filter]

    filter_tag = ""
    if ticker_filter:
        filter_tag = f'<span style="color:var(--accent);font-family:var(--mono);font-size:11.5px;padding:4px 8px;background:rgba(59,130,246,.08);border-radius:4px">{_h(ticker_filter)} <a href="/sessions" style="color:var(--txt3);text-decoration:none;margin-left:4px">✕</a></span>'

    cards_html = ""
    for d in filtered:
        ticker  = d.get("ticker", "")
        ts      = d.get("timestamp", "")
        signal  = d.get("signal", "hold")
        conf    = d.get("confidence")
        action  = d.get("ledger_action", "")
        votes   = d.get("votes", [])
        dissents= d.get("dissents", [])
        rounds  = d.get("rounds", [])
        rationale = d.get("rationale", "")
        dissent_sum = d.get("dissent_summary", "")
        has_victoria_dissent = "bear" in dissents

        pct = int((conf or 0) * 100)
        conf_color = _conv_color(conf or 0)
        conf_bar = (f'<div class="conf-bar"><div class="conf-fill" style="width:{pct}%;background:{conf_color}"></div></div>'
                    f'<span style="font-family:var(--mono);font-size:11px;color:{conf_color}">{pct}%</span>')

        chips = ""
        for aid in (votes + [a for a in dissents]):
            is_dis = aid in dissents
            cls = "dis" if is_dis else "maj"
            out = next((o for r in rounds for o in r.get("outputs", []) if o.get("agent_id") == aid and r.get("round") == 3), None)
            sig_str = out.get("signal", "?") if out else "?"
            conv_out = out.get("conviction") if out else None
            conv_pct = f"{int((conv_out or 0)*100)}%" if conv_out is not None else "?"
            chips += f"""
<span class="vote-chip {cls}">
  {_avatar(aid, "sm")}
  <span style="font-family:var(--mono);font-size:10.5px">{_h(AGENT_INIT.get(aid,"?"))}</span>
  {_signal_badge(sig_str)}
  <span style="color:var(--txt3);font-family:var(--mono);font-size:10px">{conv_pct}</span>
</span>"""

        dissent_banner = ""
        if has_victoria_dissent:
            dissent_banner = '<div class="dissent-banner" style="margin:0 16px 8px;border-radius:4px">⚠ Bear Agent (Victoria) Dissent</div>'

        date_str = ts[:10] if ts else "–"
        time_str = ts[11:16] if len(ts) > 16 else ""

        cards_html += f"""
<article class="session-card">
  <div class="card-top">
    <span class="card-ticker">{_h(ticker)}</span>
    {_signal_badge(signal, "md")}
    <div class="card-conf">{conf_bar}</div>
    {_action_badge(action)}
    <span class="card-spacer"></span>
    <span class="card-time">{_h(date_str)} {_h(time_str)}</span>
  </div>
  {dissent_banner}
  <div class="vote-row">{chips}</div>
  {_render_transcript(rounds, rationale, dissent_sum)}
</article>"""

    body = f"""
<div class="page-hdr">
  <div class="page-title">Committee Sessions</div>
  <div class="page-sub">All decisions including PASS · expand for full 3-round debate</div>
</div>
<form class="search-bar" method="get" action="/sessions">
  <input class="search-input" type="text" name="ticker" value="{_h(ticker_filter)}" placeholder="TICKER" autocomplete="off" spellcheck="false">
  <button class="btn-sm" type="submit">Filter</button>
  {filter_tag}
</form>
{cards_html if cards_html else '<div class="empty">No sessions recorded yet.</div>'}"""
    return _page("Sessions", "/sessions", body)


# ── /graduation ───────────────────────────────────────────────────────────────

SVG_ICONS = {
    "clock": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    "chart": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    "trend": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
    "shield": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    "target": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
}


@app.route("/graduation")
def graduation() -> Response:
    tracker = PerformanceTracker.from_ledger(_TXS, _DECISIONS)
    m = tracker.compute()
    closed = tracker.trades
    spy = BuyAndHoldBenchmark("SPY").run(closed)

    hist_months = 0.0
    if closed:
        first = min(t.entry_date for t in closed)
        last  = max(t.exit_date for t in closed)
        hist_months = (last - first).days / 30.44

    aicos_sharpe = m.sharpe_ratio or 0.0
    spy_sharpe   = spy.sharpe_ratio or 0.0

    criteria = [
        dict(icon="clock", name="Trade History",   desc="12 months of closed trade history",
             cur=hist_months,      req=12.0,  fmt_cur=f"{hist_months:.1f} mo",   fmt_req="12.0 mo",
             met=hist_months>=12,  prog=min(hist_months/12,1)),
        dict(icon="chart", name="Trade Volume",    desc="30 or more closed trades",
             cur=float(m.num_trades), req=30, fmt_cur=str(m.num_trades),         fmt_req="30",
             met=m.num_trades>=30, prog=min(m.num_trades/30,1)),
        dict(icon="trend", name="Sharpe vs SPY",   desc="Sharpe ratio must exceed SPY buy-and-hold",
             cur=aicos_sharpe,    req=spy_sharpe, fmt_cur=f"{aicos_sharpe:.2f}",
             fmt_req=f"{spy_sharpe:.2f} (SPY)",   met=aicos_sharpe>spy_sharpe,
             prog=min(aicos_sharpe/spy_sharpe,1) if spy_sharpe>0 else (1.0 if aicos_sharpe>0 else 0.0)),
        dict(icon="shield", name="Max Drawdown",   desc="Maximum drawdown below 15%",
             cur=m.max_drawdown_pct, req=15.0, fmt_cur=f"{m.max_drawdown_pct:.2f}%", fmt_req="< 15.00%",
             met=m.max_drawdown_pct<15, prog=max(0.0, 1-(m.max_drawdown_pct/15))),
        dict(icon="target", name="Win Rate",       desc="Win rate above 45%",
             cur=m.win_rate*100, req=45.0, fmt_cur=f"{m.win_rate*100:.1f}%",     fmt_req="> 45.0%",
             met=m.win_rate>0.45, prog=min(m.win_rate/0.45,1)),
    ]
    all_met = all(c["met"] for c in criteria)
    met_n   = sum(1 for c in criteria if c["met"])
    status_cls = "ready" if all_met else "locked"
    status_lbl = "READY" if all_met else "LOCKED"
    status_sub = ("All 5 criteria met. Live capital deployment may be enabled."
                  if all_met else f"{met_n} of {len(criteria)} criteria met. Continue paper trading.")

    items_html = ""
    for c in criteria:
        fill_cls = "met" if c["met"] else "unmet"
        icon_cls = "met" if c["met"] else "unmet"
        badge_cls = "badge-pass" if c["met"] else "badge-locked"
        badge_txt = "PASS" if c["met"] else "LOCKED"
        pct_fill = int(c["prog"] * 100)
        items_html += f"""
<div class="criterion">
  <div class="crit-icon {icon_cls}">{SVG_ICONS.get(c["icon"],"")}</div>
  <div>
    <div class="crit-name">{_h(c["name"])}</div>
  </div>
  <div class="crit-desc">{_h(c["desc"])}</div>
  <div class="crit-prog">
    <div class="crit-track"><div class="crit-fill {fill_cls}" style="width:{pct_fill}%"></div></div>
    <div class="crit-nums">{_h(c["fmt_cur"])} / {_h(c["fmt_req"])}</div>
  </div>
  <div class="crit-badge"><span class="badge badge-sm {badge_cls}">{badge_txt}</span></div>
</div>"""

    body = f"""
<div class="page-hdr">
  <div class="page-title">Graduation Status</div>
  <div class="page-sub">All 5 criteria must be met before live capital deployment is permitted</div>
</div>
<div class="grad-status-card">
  <div class="grad-lbl">Graduation Status</div>
  <div class="grad-val {status_cls}">{status_lbl}</div>
  <div class="grad-sub">{_h(status_sub)}</div>
</div>
<div class="criteria-list">{items_html}</div>"""
    return _page("Graduation", "/graduation", body)


# ── /approve — Pending Review Queue ──────────────────────────────────────────

@app.route("/approve")
def approve() -> Response:
    pending = _PENDING.get_all_pending()

    if not pending:
        body = '<div class="empty" style="padding:4rem">No pending recommendations. <a href="/sessions" style="color:var(--accent)">View all sessions →</a></div>'
        return _page("Approve", "/approve", body)

    try:
        idx = max(0, min(int(request.args.get("idx", 0)), len(pending) - 1))
    except (ValueError, TypeError):
        idx = 0

    rec = pending[idx]
    d   = {d["timestamp"]: d for d in _DECISIONS.load_all()}.get(rec.decision_ref, {})
    rounds   = d.get("rounds", [])
    votes_l  = d.get("votes", [])
    dissents = d.get("dissents", [])

    # Subtitle from cache
    info = _cached_info(rec.ticker)
    subtitle = " · ".join(filter(None, [info.get("sector"), info.get("industry")])) or rec.ticker

    # Approval-time price
    cur_price = _cached_price(rec.ticker)
    price_note = ""
    if cur_price and abs(cur_price - rec.proposed_price) > 0.005:
        price_note = f' <span style="color:var(--txt3);font-size:10.5px">(recommended at {_money(rec.proposed_price)})</span>'

    conf_pct = int(rec.confidence * 100)
    conf_color = _conv_color(rec.confidence)

    # Vote rows
    vote_rows_html = ""
    for aid in (votes_l + [a for a in dissents if a not in votes_l]):
        is_dis = aid in dissents
        out = next((o for r in rounds for o in r.get("outputs", [])
                    if o.get("agent_id") == aid and r.get("round") == 3), None)
        sig_str  = out.get("signal", "?") if out else "?"
        conv_out = out.get("conviction") if out else None
        vote_num = out.get("vote") if out else None
        name = AGENT_NAMES.get(aid, aid.replace("_"," ").title())
        role = AGENT_ROLES.get(aid, "")
        vote_rows_html += f"""
<div class="ac-vote-row">
  {_avatar(aid, "md")}
  <div><div class="ac-agent-name">{_h(name)}</div><div class="ac-agent-role">{_h(role)}</div></div>
  <div class="conv-wrap" style="gap:6px">{_conv_bar(conv_out, 70)}</div>
  {_signal_badge(sig_str, "sm")}
  <div class="ac-vote-num">{f"v{vote_num}" if vote_num is not None else "–"}</div>
</div>"""

    vic_banner = ""
    if "bear" in dissents:
        vic_banner = '<div class="dissent-banner" style="margin:12px 24px;border-radius:4px">⚠ Victoria Preservation (Bear) dissented — caution advised</div>'

    exec_price = cur_price if cur_price else rec.proposed_price
    exec_shares_approx = rec.proposed_notional / exec_price if exec_price else rec.proposed_shares

    # Reason options for rejection form
    reason_opts = "".join(f'<option value="{_h(r)}">{_h(r)}</option>' for r in REJECT_REASONS)

    prev_cls = "disabled" if idx <= 0 else ""
    next_cls = "disabled" if idx >= len(pending) - 1 else ""

    body = f"""
<div class="approve-shell">
  <div class="pending-nav">
    <a href="/approve?idx={idx-1}" class="{prev_cls}">← Prev</a>
    <span>{idx+1} of {len(pending)} pending</span>
    <a href="/approve?idx={idx+1}" class="{next_cls}">Next →</a>
  </div>
  <div class="approve-card">
    <div class="ac-header">
      <div class="ac-ticker">{_h(rec.ticker)}</div>
      <div class="ac-subtitle">{_h(subtitle)}</div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
        {_signal_badge(rec.signal, "md")}
        {_action_badge(rec.proposed_action)}
        <span style="font-size:11.5px;color:var(--txt3);font-family:var(--mono)">{_rel_time(rec.created_at)}</span>
      </div>
      <div class="ac-conf-bar-wrap">
        <div class="ac-conf-track">
          <div class="ac-conf-fill" style="width:{conf_pct}%;background:{conf_color}"></div>
        </div>
        <div class="ac-conf-label">
          <span>Committee Confidence</span>
          <span style="color:{conf_color}">{conf_pct}%</span>
        </div>
      </div>
    </div>

    {vic_banner}

    <div class="ac-votes">
      <div class="ac-votes-title">Agent Vote Breakdown</div>
      {vote_rows_html}
    </div>

    <div class="ac-trade">
      <div class="ac-trade-title">Proposed Trade</div>
      <div class="ac-trade-grid">
        <div class="ac-trade-row"><span class="ac-trade-key">Action</span><span class="ac-trade-val">{_h(rec.proposed_action.upper())}</span></div>
        <div class="ac-trade-row"><span class="ac-trade-key">Execution Price</span><span class="ac-trade-val">{_money(exec_price)}{price_note}</span></div>
        <div class="ac-trade-row"><span class="ac-trade-key">Shares</span><span class="ac-trade-val">{exec_shares_approx:.4f}</span></div>
        <div class="ac-trade-row"><span class="ac-trade-key">Notional</span><span class="ac-trade-val">{_money(rec.proposed_notional)}</span></div>
        <div class="ac-trade-row"><span class="ac-trade-key">Tier</span><span class="ac-trade-val">{_h(rec.size_tier)}</span></div>
        <div class="ac-trade-row"><span class="ac-trade-key">Confidence</span><span class="ac-trade-val" style="color:{conf_color}">{conf_pct}%</span></div>
      </div>
    </div>

    <div class="ac-actions">
      <div class="reject-wrap">
        <button class="btn-reject-toggle" type="button" onclick="toggleReject('{_h(rec.id)}')">Reject ▾</button>
        <div class="reject-form" id="rf-{_h(rec.id)}">
          <form method="post" action="/reject/{_h(rec.id)}">
            <select name="reason" onchange="checkOther(this)">{reason_opts}</select>
            <textarea class="reject-other" rows="2" placeholder="Describe your reason…"></textarea>
            <button class="btn-reject-confirm" type="submit">Confirm Rejection</button>
          </form>
        </div>
      </div>
      <form method="post" action="/approve/{_h(rec.id)}" style="flex:1">
        <button class="btn-approve" type="submit">Approve &amp; Execute ✓</button>
      </form>
    </div>
  </div>
</div>"""
    return _page("Approve", "/approve", body, extra_js=REJECT_JS)


# ── POST /approve/<id> ────────────────────────────────────────────────────────

@app.route("/approve/<item_id>", methods=["POST"])
def do_approve(item_id: str) -> Response:
    rec = _PENDING.get(item_id)
    if rec is None or rec.status != "pending":
        return redirect(url_for("approve"))

    cur_price = _cached_price(rec.ticker) or rec.proposed_price
    ts = datetime.now(tz=timezone.utc).isoformat()

    if rec.proposed_action == "buy":
        portfolio_val, _ = _portfolio_cash()
        size = _SIZER.compute(rec.confidence, cur_price, portfolio_val, _SETTINGS.portfolio)
        pos = Position(
            ticker=rec.ticker,
            shares=size.shares,
            avg_cost=cur_price,
            opened_at=ts,
            status="open",
            target_notional=size.notional,
            size_pct=size.pct_of_portfolio,
            size_tier=size.tier_label,
        )
        tx = Transaction(
            id=f"{rec.ticker}-buy-{uuid.uuid4().hex[:10]}",
            ticker=rec.ticker,
            action="buy",
            shares=size.shares,
            price=cur_price,
            timestamp=ts,
            decision_ref=rec.decision_ref,
            notes=f"Approved via dashboard. Confidence {rec.confidence:.1%}. {size.reasoning}",
        )
        _POSITIONS.upsert(pos)
        _TXS.record(tx)

    elif rec.proposed_action == "sell":
        existing = _POSITIONS.get(rec.ticker)
        if existing and existing.status == "open":
            closed = _POSITIONS.close(rec.ticker, ts)
            pnl = (cur_price - existing.avg_cost) * existing.shares if existing else 0
            tx = Transaction(
                id=f"{rec.ticker}-sell-{uuid.uuid4().hex[:10]}",
                ticker=rec.ticker,
                action="sell",
                shares=existing.shares,
                price=cur_price,
                timestamp=ts,
                decision_ref=rec.decision_ref,
                notes=f"Approved closure via dashboard. Est. P&L ${pnl:+.2f}.",
            )
            _TXS.record(tx)

    _PENDING.approve(item_id)
    return redirect(url_for("approve"))


# ── POST /reject/<id> ─────────────────────────────────────────────────────────

@app.route("/reject/<item_id>", methods=["POST"])
def do_reject(item_id: str) -> Response:
    rec = _PENDING.get(item_id)
    if rec is None or rec.status != "pending":
        return redirect(url_for("approve"))

    reason = request.form.get("reason", "No reason given")
    if reason == "Other":
        reason = request.form.get("reason_other", "Other").strip() or "Other"

    _PENDING.reject(item_id, reason)
    return redirect(url_for("approve"))


# ── /scanner — Universe Scanner Candidates ───────────────────────────────────

@app.route("/scanner")
def scanner() -> Response:
    doc = _load_scanner_candidates()
    candidates = doc.get("candidates", [])
    filters = doc.get("filters", {})
    on_wl = {t.upper() for t in _load_watchlist()}

    cfg = _SETTINGS.scanner
    floor = filters.get("market_cap_floor", cfg.market_cap_floor)
    allow = filters.get("sector_allowlist", cfg.sector_allowlist) or ["All"]
    deny = filters.get("sector_denylist", cfg.sector_denylist) or ["None"]
    exchanges = ", ".join(filters.get("mics", cfg.mics))
    generated = doc.get("generated_at", "")
    gen_str = _rel_time(generated) if generated else "never"

    filter_strip = f"""
<div class="filter-strip">
  <div class="filter-item"><span class="filter-key">Exchanges</span><span class="filter-val">{_h(exchanges)}</span></div>
  <div class="filter-item"><span class="filter-key">Cap Floor</span><span class="filter-val">{_h(floor)}</span></div>
  <div class="filter-item"><span class="filter-key">Sectors Allowed</span><span class="filter-val">{_h(", ".join(allow))}</span></div>
  <div class="filter-item"><span class="filter-key">Sectors Denied</span><span class="filter-val">{_h(", ".join(deny))}</span></div>
  <div class="filter-item"><span class="filter-key">Last Scan</span><span class="filter-val">{_h(gen_str)}</span></div>
</div>"""

    toolbar = f"""
<div class="scan-toolbar">
  {filter_strip}
  <form method="post" action="/scanner/run" style="margin:0">
    <button class="btn-run" type="submit">↻ Run Scan</button>
  </form>
</div>"""

    if not candidates:
        body = f"""
<div class="page-hdr">
  <div class="page-title">Universe Scanner</div>
  <div class="page-sub">NYSE/NASDAQ candidates · promote tickers into the watchlist · does not feed the committee</div>
</div>
{toolbar}
<div class="tbl-wrap"><div class="empty">No candidates yet. Run a scan to populate the list.</div></div>"""
        return _page("Scanner", "/scanner", body)

    rows_html = ""
    for c in candidates:
        sym = str(c.get("symbol", "")).upper()
        promoted = sym in on_wl
        action_cell = (
            '<span class="pill-on-wl">On watchlist</span>' if promoted else
            f'<form method="post" action="/scanner/promote/{_h(sym)}" style="margin:0">'
            f'<button class="btn-promote" type="submit">Promote →</button></form>'
        )
        rows_html += f"""
<tr>
  <td><span class="ticker">{_h(sym)}</span></td>
  <td class="muted" style="white-space:normal;max-width:280px">{_h(c.get("name",""))}</td>
  <td>{_h(c.get("sector",""))}</td>
  <td class="dim">{_h(c.get("industry",""))}</td>
  <td><span class="cap-badge">{_h(c.get("market_cap",""))}</span></td>
  <td class="dim">{_h(c.get("mic",""))}</td>
  <td class="r">{action_cell}</td>
</tr>"""

    trunc_note = ""
    if doc.get("truncated"):
        trunc_note = (f' · capped at {filters.get("max_candidates", len(candidates))}'
                      f' (more matched the filters)')

    table = f"""
<div class="tbl-wrap">
  <div class="tbl-head">
    <span class="tbl-lbl">Candidates</span>
    <span class="tbl-count">{len(candidates)}{trunc_note}</span>
  </div>
  <table><thead><tr>
    <th>Ticker</th><th>Name</th><th>Sector</th><th>Industry</th>
    <th>Cap</th><th>Exch</th><th class="r">Action</th>
  </tr></thead><tbody>{rows_html}</tbody></table>
</div>"""

    body = f"""
<div class="page-hdr">
  <div class="page-title">Universe Scanner</div>
  <div class="page-sub">NYSE/NASDAQ candidates · promote tickers into the watchlist · does not feed the committee</div>
</div>
{toolbar}{table}"""
    return _page("Scanner", "/scanner", body)


# ── POST /scanner/run ─────────────────────────────────────────────────────────

@app.route("/scanner/run", methods=["POST"])
def do_scanner_run() -> Response:
    try:
        UniverseScanner(settings=_SETTINGS).scan()
    except Exception as exc:  # financedatabase missing / network hiccup
        app.logger.warning("Universe scan failed: %s", exc)
    return redirect(url_for("scanner"))


# ── POST /scanner/promote/<symbol> ────────────────────────────────────────────

@app.route("/scanner/promote/<symbol>", methods=["POST"])
def do_scanner_promote(symbol: str) -> Response:
    _promote_to_watchlist(symbol)
    return redirect(url_for("scanner"))


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"AICOS Dashboard — http://localhost:5001")
    print(f"Project root: {_ROOT}")
    app.run(debug=True, port=5001, use_reloader=False)
