"""
Centralised data pipeline for AICOS.

DataFetcher is the single source of truth for all market and fundamental data.
Every agent and the watchlist runner calls DataFetcher.fetch() instead of
making independent yfinance calls.

Cache layout
────────────
  data/cache/{TICKER}.json                 — full TickerData, 24-hour TTL
  data/cache/historical/{TICKER}_{DATE}.json  — point-in-time prices, no expiry
    (historical prices are immutable; never re-fetched once cached)

Seven data types per ticker
───────────────────────────
  1. price_history       — 12-month daily OHLCV
  2. income_statement    — annual, up to 4 years
  3. balance_sheet       — annual, up to 4 years
  4. cash_flow           — annual, up to 4 years
  5. key_ratios          — P/E, P/S, EV/EBITDA, debt-to-EBITDA, and ~25 others
  6. macro_snapshot      — treasury rates, CPI, GDP, market risk premium (FMP)
  7. technical_snapshot  — RSI, MACD, ADX, Bollinger Bands, ATR (FMP)

DataQualityValidator checks
────────────────────────────
  • Missing required fields (price, price history, income statement)
  • Stale filings — most recent earnings older than 6 months
  • Negative revenue
  • Debt-to-equity above 20× (extreme leverage)
  Any failure sets data_quality.is_data_limited = True and logs a warning.
  The flag is propagated to AgentContext so every agent can note it in its
  analysis and adjust its confidence accordingly.

FMP (Financial Modeling Prep) integration
──────────────────────────────────────────
  Set the FMP_API_KEY env var to enable macro and technical data.
  When the key is missing both snapshots are empty dicts (graceful degradation).
"""

from __future__ import annotations

import json
import logging
import math
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_CACHE_TTL_HOURS = 24
_STALENESS_DAYS = 182        # 6 months — threshold for stale-filing warning
_MAX_DEBT_TO_EQUITY = 20.0   # 20× ratio; yfinance returns as %, so we divide by 100
_FMP_BASE = "https://financialmodelingprep.com/api"

# Cross-check tolerances: field → max acceptable relative difference (fraction).
# Price uses a tighter tolerance than fundamentals because it should be near-real-time.
_CROSS_CHECK_TOLERANCES: dict[str, float] = {
    "price":             0.02,   # 2%
    "market_cap":        0.10,   # 10%
    "pe_ratio_trailing": 0.10,
    "revenue_ttm":       0.10,
    "ebitda":            0.10,
}


# ---------------------------------------------------------------------------
# Core data structures
# ---------------------------------------------------------------------------

@dataclass
class DataQuality:
    is_valid: bool           # False only when data is critically broken
    is_data_limited: bool    # True whenever any validation check fires a warning
    warnings: list[str]
    checks_run: list[str]


@dataclass
class TickerData:
    ticker: str
    fetched_at: datetime
    price_history: dict[str, dict]     # {date_str: {open, high, low, close, volume}}
    income_statement: dict[str, dict]  # {period_str: {field: value}}
    balance_sheet: dict[str, dict]     # {period_str: {field: value}}
    cash_flow: dict[str, dict]         # {period_str: {field: value}}
    key_ratios: dict[str, Any]         # flat dict of ratios + metadata
    macro_snapshot: dict[str, Any] = field(default_factory=dict)
    technical_snapshot: dict[str, Any] = field(default_factory=dict)
    data_quality: DataQuality = field(
        default_factory=lambda: DataQuality(True, False, [], [])
    )

    # ── Convenience accessors ────────────────────────────────────────────────

    def current_price(self) -> float | None:
        return self.key_ratios.get("price")

    # ── Agent-facing flat dict ───────────────────────────────────────────────

    def to_agent_dict(self) -> dict[str, Any]:
        """Return a readable flat key-value dict for AgentContext.data.

        Agents iterate this dict and format it as "  key: value" lines in their
        prompts.  Nones are excluded so the LLM sees only available data.
        """
        r = self.key_ratios
        d: dict[str, Any] = {}

        def _put(key: str, val: Any) -> None:
            if val is not None:
                d[key] = val

        def _bn(v: float | None) -> float | None:
            return round(v / 1e9, 2) if v is not None else None

        def _pct(v: float | None) -> float | None:
            return round(v * 100, 2) if v is not None else None

        # ── Price ──────────────────────────────────────────────────────────
        _put("price", r.get("price"))
        _put("52w_high", r.get("52w_high"))
        _put("52w_low", r.get("52w_low"))

        if self.price_history:
            dates = sorted(self.price_history)
            if len(dates) >= 2:
                first = self.price_history[dates[0]].get("close")
                last = self.price_history[dates[-1]].get("close")
                if first and last and first > 0:
                    _put("price_change_12mo_pct", round((last - first) / first * 100, 1))
                _put("price_12mo_ago", first)

        # ── Valuation ──────────────────────────────────────────────────────
        _put("market_cap_bn", _bn(r.get("market_cap")))
        for k in ("pe_ratio_trailing", "pe_ratio_forward", "ps_ratio",
                  "pb_ratio", "peg_ratio", "ev_ebitda", "ev_revenue"):
            _put(k, r.get(k))

        # ── Profitability (percent form) ───────────────────────────────────
        for src, dst in (
            ("gross_margin", "gross_margin_pct"),
            ("operating_margin", "operating_margin_pct"),
            ("net_margin", "net_margin_pct"),
            ("revenue_growth_yoy", "revenue_growth_yoy_pct"),
            ("earnings_growth_yoy", "earnings_growth_yoy_pct"),
            ("return_on_equity", "roe_pct"),
            ("return_on_assets", "roa_pct"),
            ("dividend_yield", "dividend_yield_pct"),
        ):
            _put(dst, _pct(r.get(src)))

        # ── Scale metrics (billions) ───────────────────────────────────────
        for src, dst in (
            ("revenue_ttm", "revenue_ttm_bn"),
            ("ebitda", "ebitda_bn"),
            ("free_cash_flow", "free_cash_flow_bn"),
            ("total_debt", "total_debt_bn"),
            ("total_cash", "cash_bn"),
        ):
            _put(dst, _bn(r.get(src)))

        # ── Leverage ───────────────────────────────────────────────────────
        for k in ("debt_to_equity", "debt_to_ebitda"):
            v = r.get(k)
            if v is not None:
                _put(k, round(v, 2) if isinstance(v, float) else v)

        # ── Analyst / market context ───────────────────────────────────────
        for k in ("analyst_target_price", "analyst_recommendation",
                  "beta", "short_ratio", "sector", "industry"):
            _put(k, r.get(k))

        _put("most_recent_quarter", r.get("most_recent_quarter_date"))
        _put("filing_age_days", r.get("filing_age_days"))

        # ── Latest annual income statement ─────────────────────────────────
        if self.income_statement:
            latest = sorted(self.income_statement.keys(), reverse=True)[0]
            stmt = self.income_statement[latest]
            _put("income_stmt_period", latest)
            for field_name, out_key in (
                ("Total Revenue",            "income_total_revenue_mn"),
                ("Gross Profit",             "income_gross_profit_mn"),
                ("Operating Income",         "income_operating_income_mn"),
                ("Net Income",               "income_net_income_mn"),
                ("EBITDA",                   "income_ebitda_mn"),
                ("Research And Development", "income_rd_mn"),
            ):
                v = stmt.get(field_name)
                if v is not None:
                    _put(out_key, round(v / 1e6, 1))

        # ── Latest annual balance sheet ────────────────────────────────────
        if self.balance_sheet:
            latest = sorted(self.balance_sheet.keys(), reverse=True)[0]
            sheet = self.balance_sheet[latest]
            _put("balance_sheet_period", latest)
            for field_name, out_key in (
                ("Total Assets",                         "bs_total_assets_mn"),
                ("Total Liabilities Net Minority Interest", "bs_total_liabilities_mn"),
                ("Total Equity Gross Minority Interest", "bs_total_equity_mn"),
                ("Long Term Debt",                       "bs_long_term_debt_mn"),
            ):
                v = sheet.get(field_name)
                if v is not None:
                    _put(out_key, round(v / 1e6, 1))

        # ── Latest annual cash flow ────────────────────────────────────────
        if self.cash_flow:
            latest = sorted(self.cash_flow.keys(), reverse=True)[0]
            cf = self.cash_flow[latest]
            _put("cashflow_period", latest)
            for field_name, out_key in (
                ("Free Cash Flow",      "cf_free_cash_flow_mn"),
                ("Operating Cash Flow", "cf_operating_mn"),
                ("Capital Expenditure", "cf_capex_mn"),
            ):
                v = cf.get(field_name)
                if v is not None:
                    _put(out_key, round(v / 1e6, 1))

        # ── Macro snapshot ──────────────────────────────────────────────
        if self.macro_snapshot:
            for k in ("us_10y_treasury", "us_2y_treasury", "us_3m_treasury",
                       "yield_curve_spread", "cpi_yoy_pct", "gdp_growth_pct",
                       "market_risk_premium_pct"):
                _put(k, self.macro_snapshot.get(k))

        # ── Technical snapshot ─────────────────────────────────────────────
        if self.technical_snapshot:
            for k in ("rsi_14", "macd", "macd_signal", "macd_histogram",
                       "adx_14", "bb_upper", "bb_middle", "bb_lower",
                       "atr_14"):
                _put(k, self.technical_snapshot.get(k))

        return d

    # ── Serialisation ────────────────────────────────────────────────────────

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "fetched_at": self.fetched_at.isoformat(),
            "price_history": self.price_history,
            "income_statement": self.income_statement,
            "balance_sheet": self.balance_sheet,
            "cash_flow": self.cash_flow,
            "key_ratios": self.key_ratios,
            "macro_snapshot": self.macro_snapshot,
            "technical_snapshot": self.technical_snapshot,
            "data_quality": {
                "is_valid": self.data_quality.is_valid,
                "is_data_limited": self.data_quality.is_data_limited,
                "warnings": self.data_quality.warnings,
                "checks_run": self.data_quality.checks_run,
            },
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TickerData":
        dq = d.get("data_quality", {})
        fetched_at = datetime.fromisoformat(d["fetched_at"])
        if fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        return cls(
            ticker=d["ticker"],
            fetched_at=fetched_at,
            price_history=d.get("price_history", {}),
            income_statement=d.get("income_statement", {}),
            balance_sheet=d.get("balance_sheet", {}),
            cash_flow=d.get("cash_flow", {}),
            key_ratios=d.get("key_ratios", {}),
            macro_snapshot=d.get("macro_snapshot", {}),
            technical_snapshot=d.get("technical_snapshot", {}),
            data_quality=DataQuality(
                is_valid=dq.get("is_valid", True),
                is_data_limited=dq.get("is_data_limited", False),
                warnings=dq.get("warnings", []),
                checks_run=dq.get("checks_run", []),
            ),
        )


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

class DataQualityValidator:
    """Run a battery of quality checks on freshly-fetched TickerData.

    Mutates data.data_quality in-place and returns the same object so callers
    can chain: data = validator.validate(data).
    """

    def validate(
        self,
        data: TickerData,
        cross_check_warnings: list[str] | None = None,
    ) -> TickerData:
        warnings: list[str] = []
        checks: list[str] = []

        def check(name: str, condition: bool, message: str) -> None:
            checks.append(name)
            if condition:
                warnings.append(message)
                logger.warning("[DataQuality] %s: %s", data.ticker, message)

        # ── 1. Current price ───────────────────────────────────────────────
        check(
            "price_available",
            not data.key_ratios.get("price"),
            "No current price available",
        )

        # ── 2. Price history populated ─────────────────────────────────────
        check(
            "price_history_populated",
            not data.price_history,
            "Price history is empty — 12-month OHLCV unavailable",
        )

        # ── 3. Income statement populated ─────────────────────────────────
        check(
            "income_statement_populated",
            not data.income_statement,
            "Income statement is empty — fundamental analysis severely limited",
        )

        # ── 4. Stale filings (most recent earnings > 6 months old) ────────
        checks.append("filing_staleness")
        age_days = data.key_ratios.get("filing_age_days")
        if age_days is not None and age_days > _STALENESS_DAYS:
            msg = (
                f"Most recent earnings data is {age_days} days old "
                f"(>{_STALENESS_DAYS}-day threshold — may be stale)"
            )
            warnings.append(msg)
            logger.warning("[DataQuality] %s: %s", data.ticker, msg)

        # ── 5. Negative revenue ────────────────────────────────────────────
        checks.append("revenue_positive")
        rev = data.key_ratios.get("revenue_ttm")
        if rev is not None and rev < 0:
            msg = f"Negative TTM revenue reported: ${rev:,.0f}"
            warnings.append(msg)
            logger.warning("[DataQuality] %s: %s", data.ticker, msg)

        # ── 6. Extreme debt-to-equity (> 20×) ─────────────────────────────
        # key_ratios["debt_to_equity"] is stored as a ratio (already divided by 100)
        checks.append("debt_to_equity_reasonable")
        dte = data.key_ratios.get("debt_to_equity")
        if dte is not None and dte > _MAX_DEBT_TO_EQUITY:
            msg = f"Extreme debt-to-equity: {dte:.1f}× (threshold {_MAX_DEBT_TO_EQUITY:.0f}×)"
            warnings.append(msg)
            logger.warning("[DataQuality] %s: %s", data.ticker, msg)

        # ── 7. Macro snapshot available ────────────────────────────────────
        check(
            "macro_snapshot_available",
            not data.macro_snapshot,
            "Macro snapshot unavailable — treasury/CPI/GDP data missing (FMP_API_KEY set?)",
        )

        # ── 8. Technical snapshot available ───────────────────────────────
        check(
            "technical_snapshot_available",
            not data.technical_snapshot,
            "Technical snapshot unavailable — RSI/MACD/ADX/BB/ATR missing (FMP_API_KEY set?)",
        )

        # ── 9. Required income statement fields present ────────────────────
        checks.append("income_fields_present")
        if data.income_statement:
            latest = sorted(data.income_statement.keys(), reverse=True)[0]
            stmt = data.income_statement[latest]
            for required in ("Total Revenue", "Net Income"):
                if stmt.get(required) is None:
                    msg = f"Missing income statement field '{required}' in {latest}"
                    warnings.append(msg)
                    logger.warning("[DataQuality] %s: %s", data.ticker, msg)

        # ── 10. Cross-check: yfinance vs FMP ──────────────────────────────
        if cross_check_warnings:
            checks.append("cross_check_yf_fmp")
            for w in cross_check_warnings:
                warnings.append(w)
                logger.warning("[DataQuality] %s: %s", data.ticker, w)

        # Critical validity: no price AND no income statement is unfixable
        is_valid = not (
            not data.key_ratios.get("price")
            and not data.income_statement
        )

        data.data_quality = DataQuality(
            is_valid=is_valid,
            is_data_limited=len(warnings) > 0,
            warnings=warnings,
            checks_run=checks,
        )
        return data


# ---------------------------------------------------------------------------
# yfinance helpers
# ---------------------------------------------------------------------------

def _clean_value(v: Any) -> Any:
    """Normalise numpy/pandas types to plain Python for JSON serialisation."""
    if v is None:
        return None
    tn = type(v).__name__
    if tn in ("float64", "float32", "float16"):
        fv = float(v)
        return None if (math.isnan(fv) or math.isinf(fv)) else fv
    if tn in ("int64", "int32", "int16", "int8", "uint64", "uint32", "uint16", "uint8"):
        return int(v)
    if tn == "Timestamp":
        return v.date().isoformat()
    if tn == "bool_":
        return bool(v)
    if isinstance(v, float):
        return None if (math.isnan(v) or math.isinf(v)) else v
    return v


def _df_to_price_dict(df: Any) -> dict[str, dict]:
    """Convert a yfinance price history DataFrame to a JSON-serialisable dict."""
    if df is None or df.empty:
        return {}
    result: dict[str, dict] = {}
    for ts, row in df.iterrows():
        date_str = str(ts.date()) if hasattr(ts, "date") else str(ts)[:10]
        result[date_str] = {
            "open":   _clean_value(row.get("Open")),
            "high":   _clean_value(row.get("High")),
            "low":    _clean_value(row.get("Low")),
            "close":  _clean_value(row.get("Close")),
            "volume": _clean_value(row.get("Volume")),
        }
    return result


def _financial_df_to_dict(df: Any) -> dict[str, dict]:
    """Convert a yfinance financial statement DataFrame to a JSON-serialisable dict.

    yfinance orientation: index = line items (strings), columns = period Timestamps.
    """
    if df is None or df.empty:
        return {}
    result: dict[str, dict] = {}
    for col in df.columns:
        period_str = col.date().isoformat() if hasattr(col, "date") else str(col)[:10]
        result[period_str] = {
            str(idx): _clean_value(val)
            for idx, val in df[col].items()
        }
    return result


def _extract_key_ratios(info: dict) -> dict[str, Any]:
    """Pull the metrics agents care about from yfinance's .info dict."""

    def _g(key: str) -> Any:
        return _clean_value(info.get(key))

    ratios: dict[str, Any] = {
        # Price
        "price":           _g("currentPrice") or _g("regularMarketPrice"),
        "52w_high":        _g("fiftyTwoWeekHigh"),
        "52w_low":         _g("fiftyTwoWeekLow"),
        # Scale
        "market_cap":      _g("marketCap"),
        "enterprise_value": _g("enterpriseValue"),
        # Valuation multiples
        "pe_ratio_trailing": _g("trailingPE"),
        "pe_ratio_forward":  _g("forwardPE"),
        "ps_ratio":          _g("priceToSalesTrailing12Months"),
        "pb_ratio":          _g("priceToBook"),
        "peg_ratio":         _g("pegRatio"),
        "ev_ebitda":         _g("enterpriseToEbitda"),
        "ev_revenue":        _g("enterpriseToRevenue"),
        # Profitability (fractions — multiplied by 100 in to_agent_dict)
        "gross_margin":      _g("grossMargins"),
        "operating_margin":  _g("operatingMargins"),
        "net_margin":        _g("profitMargins"),
        "return_on_equity":  _g("returnOnEquity"),
        "return_on_assets":  _g("returnOnAssets"),
        # Growth
        "revenue_growth_yoy":  _g("revenueGrowth"),
        "earnings_growth_yoy": _g("earningsGrowth"),
        # Income / cash flow
        "revenue_ttm":    _g("totalRevenue"),
        "ebitda":         _g("ebitda"),
        "free_cash_flow": _g("freeCashflow"),
        # Balance sheet
        "total_debt":  _g("totalDebt"),
        "total_cash":  _g("totalCash"),
        # Analyst / market
        "analyst_target_price":   _g("targetMeanPrice"),
        "analyst_recommendation": info.get("recommendationKey"),
        "beta":        _g("beta"),
        "short_ratio": _g("shortRatio"),
        "dividend_yield": _g("dividendYield"),
        "sector":   info.get("sector"),
        "industry": info.get("industry"),
        "employees": info.get("fullTimeEmployees"),
    }

    # debt_to_equity — yfinance returns as percentage (e.g. 171.66 = 1.7166×);
    # normalise to ratio for the validator's 20× threshold check.
    dte_raw = _g("debtToEquity")
    ratios["debt_to_equity"] = round(dte_raw / 100.0, 4) if dte_raw is not None else None

    # debt_to_ebitda — computed from balance sheet / income data
    total_debt = ratios.get("total_debt")
    ebitda = ratios.get("ebitda")
    if total_debt is not None and ebitda is not None and ebitda != 0:
        ratios["debt_to_ebitda"] = round(total_debt / ebitda, 4)
    else:
        ratios["debt_to_ebitda"] = None

    # Staleness: yfinance mostRecentQuarter is a Unix timestamp
    mrq = info.get("mostRecentQuarter")
    if mrq:
        try:
            filing_dt = datetime.fromtimestamp(float(mrq), tz=timezone.utc)
            ratios["most_recent_quarter_date"] = filing_dt.date().isoformat()
            ratios["filing_age_days"] = (datetime.now(tz=timezone.utc) - filing_dt).days
        except (TypeError, ValueError, OSError):
            pass

    return ratios


# ---------------------------------------------------------------------------
# FMP helpers
# ---------------------------------------------------------------------------

def _fmp_get(path: str, api_key: str, params: dict | None = None) -> Any:
    """GET a JSON endpoint from FMP. Returns parsed JSON or None on failure."""
    import urllib.request
    import urllib.parse

    all_params = {"apikey": api_key}
    if params:
        all_params.update(params)
    qs = urllib.parse.urlencode(all_params)
    url = f"{_FMP_BASE}{path}?{qs}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AICOS/0.1"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as exc:
        logger.warning("FMP request failed: %s — %s", path, exc)
        return None


def _fetch_macro_snapshot(api_key: str) -> dict[str, Any]:
    """Fetch treasury rates, CPI, GDP, and derive market risk premium."""
    snap: dict[str, Any] = {}

    # Treasury rates
    treasury = _fmp_get("/v4/treasury", api_key, {"from": "", "to": ""})
    if isinstance(treasury, list) and treasury:
        latest = treasury[0]
        snap["us_10y_treasury"] = latest.get("year10")
        snap["us_2y_treasury"] = latest.get("year2")
        snap["us_3m_treasury"] = latest.get("month3")
        y10 = latest.get("year10")
        y2 = latest.get("year2")
        if y10 is not None and y2 is not None:
            snap["yield_curve_spread"] = round(y10 - y2, 4)

    # CPI (year-over-year)
    cpi = _fmp_get("/v4/economic", api_key, {"name": "CPI"})
    if isinstance(cpi, list) and cpi:
        snap["cpi_yoy_pct"] = cpi[0].get("value")

    # GDP growth
    gdp = _fmp_get("/v4/economic", api_key, {"name": "realGDP"})
    if isinstance(gdp, list) and len(gdp) >= 2:
        curr = gdp[0].get("value")
        prev = gdp[1].get("value")
        if curr is not None and prev is not None and prev != 0:
            snap["gdp_growth_pct"] = round((curr - prev) / prev * 100, 2)

    # Market risk premium (equity risk premium endpoint)
    mrp = _fmp_get("/v4/market_risk_premium", api_key)
    if isinstance(mrp, list):
        us_entry = next((e for e in mrp if e.get("country") == "United States"), None)
        if us_entry and us_entry.get("totalEquityRiskPremium") is not None:
            snap["market_risk_premium_pct"] = us_entry["totalEquityRiskPremium"]

    return snap


def _fetch_technical_snapshot(ticker: str, api_key: str) -> dict[str, Any]:
    """Fetch RSI, MACD, ADX, Bollinger Bands, ATR for a ticker from FMP."""
    snap: dict[str, Any] = {}

    indicators = {
        "rsi": {"period": "14"},
        "macd": {},
        "adx": {"period": "14"},
        "standardDeviation": {"period": "20"},
        "atr": {"period": "14"},
    }

    for indicator, extra_params in indicators.items():
        params = {"type": indicator, **extra_params}
        data = _fmp_get(f"/v3/technical_indicator/daily/{ticker}", api_key, params)

        if not isinstance(data, list) or not data:
            continue

        latest = data[0]

        if indicator == "rsi":
            snap["rsi_14"] = latest.get("rsi")
        elif indicator == "macd":
            snap["macd"] = latest.get("macd")
            snap["macd_signal"] = latest.get("macdSignal")
            snap["macd_histogram"] = latest.get("macdHist")
        elif indicator == "adx":
            snap["adx_14"] = latest.get("adx")
        elif indicator == "standardDeviation":
            close = latest.get("close")
            sd = latest.get("standardDeviation")
            if close is not None and sd is not None:
                snap["bb_middle"] = round(close, 4)
                snap["bb_upper"] = round(close + 2 * sd, 4)
                snap["bb_lower"] = round(close - 2 * sd, 4)
        elif indicator == "atr":
            snap["atr_14"] = latest.get("atr")

    return snap


# ---------------------------------------------------------------------------
# FMP cross-check
# ---------------------------------------------------------------------------

def _fetch_fmp_quote(ticker: str, api_key: str) -> dict[str, Any]:
    """Fetch price and key fundamentals from FMP for cross-checking against yfinance."""
    result: dict[str, Any] = {}

    quote = _fmp_get(f"/v3/quote/{ticker}", api_key)
    if isinstance(quote, list) and quote:
        q = quote[0]
        result["price"] = q.get("price")
        result["market_cap"] = q.get("marketCap")
        result["pe_ratio_trailing"] = q.get("pe")

    profile = _fmp_get(f"/v3/profile/{ticker}", api_key)
    if isinstance(profile, list) and profile:
        p = profile[0]
        if "price" not in result or result["price"] is None:
            result["price"] = p.get("price")
        if "market_cap" not in result or result["market_cap"] is None:
            result["market_cap"] = p.get("mktCap")

    ratios = _fmp_get(f"/v3/ratios-ttm/{ticker}", api_key)
    if isinstance(ratios, list) and ratios:
        r = ratios[0]
        if result.get("pe_ratio_trailing") is None:
            result["pe_ratio_trailing"] = r.get("peRatioTTM")

    income = _fmp_get(f"/v3/income-statement/{ticker}", api_key, {"limit": "1"})
    if isinstance(income, list) and income:
        stmt = income[0]
        result["revenue_ttm"] = stmt.get("revenue")
        result["ebitda"] = stmt.get("ebitda")

    return result


def cross_check_sources(
    yf_ratios: dict[str, Any],
    fmp_ratios: dict[str, Any],
    ticker: str,
    tolerances: dict[str, float] | None = None,
) -> list[str]:
    """Compare yfinance and FMP values; return warning strings for disagreements."""
    tols = tolerances or _CROSS_CHECK_TOLERANCES
    warnings: list[str] = []

    for field_name, max_diff in tols.items():
        yf_val = yf_ratios.get(field_name)
        fmp_val = fmp_ratios.get(field_name)

        if yf_val is None or fmp_val is None:
            continue
        if not isinstance(yf_val, (int, float)) or not isinstance(fmp_val, (int, float)):
            continue

        if yf_val == 0 and fmp_val == 0:
            continue
        ref = max(abs(yf_val), abs(fmp_val))
        if ref == 0:
            continue

        rel_diff = abs(yf_val - fmp_val) / ref
        if rel_diff > max_diff:
            warnings.append(
                f"Cross-check disagreement on {field_name}: "
                f"yfinance={yf_val:,.4g} vs FMP={fmp_val:,.4g} "
                f"({rel_diff:.1%} diff, tolerance {max_diff:.0%})"
            )

    return warnings


# ---------------------------------------------------------------------------
# DataFetcher — public API
# ---------------------------------------------------------------------------

class DataFetcher:
    """Fetch, cache, and validate market + fundamental data for any ticker.

    Usage::

        fetcher = DataFetcher()             # uses data/cache by default
        data = fetcher.fetch("AAPL")        # full TickerData, cached 24 h
        price = fetcher.fetch_historical_price("SPY", some_past_datetime)
    """

    def __init__(self, cache_dir: Path | str = Path("data/cache")):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        (self.cache_dir / "historical").mkdir(exist_ok=True)
        self._validator = DataQualityValidator()
        self._fmp_key = os.environ.get("FMP_API_KEY", "")

    # ── Main entry point ─────────────────────────────────────────────────────

    def fetch(self, ticker: str) -> TickerData:
        """Return TickerData for *ticker*, serving from cache when < 24 h old."""
        ticker = ticker.upper()
        cache_path = self.cache_dir / f"{ticker}.json"

        if cache_path.exists():
            cached = self._load_cache(cache_path)
            if cached is not None and self._is_cache_fresh(cached):
                logger.debug("Cache hit for %s", ticker)
                return cached

        logger.info("Fetching %s from yfinance", ticker)
        data = self._fetch_from_yfinance(ticker)

        if self._fmp_key:
            data.macro_snapshot = self._fetch_macro_cached()
            data.technical_snapshot = _fetch_technical_snapshot(ticker, self._fmp_key)

            fmp_quote = _fetch_fmp_quote(ticker, self._fmp_key)
            cross_warnings = cross_check_sources(data.key_ratios, fmp_quote, ticker)
        else:
            cross_warnings = []

        self._validator.validate(data, cross_check_warnings=cross_warnings)
        self._save_cache(cache_path, data)
        return data

    # ── Macro snapshot (market-wide, cached separately) ──────────────────────

    def _fetch_macro_cached(self) -> dict[str, Any]:
        cache_path = self.cache_dir / "macro_snapshot.json"
        if cache_path.exists():
            try:
                cached = json.loads(cache_path.read_text())
                fetched_at = datetime.fromisoformat(cached["fetched_at"])
                if fetched_at.tzinfo is None:
                    fetched_at = fetched_at.replace(tzinfo=timezone.utc)
                age = datetime.now(tz=timezone.utc) - fetched_at
                if age.total_seconds() < _CACHE_TTL_HOURS * 3600:
                    return cached.get("data", {})
            except Exception:
                pass

        snap = _fetch_macro_snapshot(self._fmp_key)
        try:
            cache_path.write_text(json.dumps({
                "fetched_at": datetime.now(tz=timezone.utc).isoformat(),
                "data": snap,
            }, indent=2))
        except Exception as exc:
            logger.warning("Macro cache write failed: %s", exc)
        return snap

    # ── Historical price lookup (used by benchmarks) ─────────────────────────

    def fetch_historical_price(
        self, ticker: str, target_date: datetime
    ) -> float | None:
        """Return the closing price on or before *target_date*.

        Cached indefinitely — historical prices never change.
        """
        ticker = ticker.upper()
        date_str = target_date.date().isoformat()
        cache_path = self.cache_dir / "historical" / f"{ticker}_{date_str}.json"

        if cache_path.exists():
            try:
                return json.loads(cache_path.read_text()).get("price")
            except Exception:
                pass

        price = self._fetch_price_on_date(ticker, target_date)
        try:
            cache_path.write_text(json.dumps({"ticker": ticker, "date": date_str, "price": price}))
        except Exception:
            pass
        return price

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _is_cache_fresh(self, data: TickerData) -> bool:
        age = datetime.now(tz=timezone.utc) - data.fetched_at
        return age.total_seconds() < _CACHE_TTL_HOURS * 3600

    def _load_cache(self, path: Path) -> TickerData | None:
        try:
            return TickerData.from_dict(json.loads(path.read_text()))
        except Exception as exc:
            logger.debug("Cache read failed for %s: %s", path.name, exc)
            return None

    def _save_cache(self, path: Path, data: TickerData) -> None:
        try:
            path.write_text(json.dumps(data.to_dict(), indent=2))
        except Exception as exc:
            logger.warning("Cache write failed for %s: %s", path.name, exc)

    def _fetch_from_yfinance(self, ticker: str) -> TickerData:
        import yfinance as yf  # lazy — avoid hard dep at import time

        t = yf.Ticker(ticker)

        price_history = _df_to_price_dict(t.history(period="12mo"))
        income_statement = _financial_df_to_dict(getattr(t, "income_stmt", None))
        balance_sheet = _financial_df_to_dict(getattr(t, "balance_sheet", None))
        cash_flow = _financial_df_to_dict(getattr(t, "cashflow", None))

        try:
            info = t.info or {}
        except Exception:
            info = {}

        key_ratios = _extract_key_ratios(info)

        return TickerData(
            ticker=ticker,
            fetched_at=datetime.now(tz=timezone.utc),
            price_history=price_history,
            income_statement=income_statement,
            balance_sheet=balance_sheet,
            cash_flow=cash_flow,
            key_ratios=key_ratios,
        )

    def _fetch_price_on_date(
        self, ticker: str, target_date: datetime
    ) -> float | None:
        """Fetch the closest trading-day close price on or before target_date."""
        from datetime import timedelta
        import yfinance as yf

        start = (target_date - timedelta(days=7)).strftime("%Y-%m-%d")
        end = (target_date + timedelta(days=3)).strftime("%Y-%m-%d")

        try:
            hist = yf.Ticker(ticker).history(start=start, end=end)
        except Exception:
            return None

        if hist.empty:
            return None

        hist.index = hist.index.tz_convert("UTC")
        target_utc = target_date.astimezone(timezone.utc)
        prior = hist[hist.index <= target_utc]
        row = prior.iloc[-1] if not prior.empty else hist.iloc[0]
        return float(row["Close"])
