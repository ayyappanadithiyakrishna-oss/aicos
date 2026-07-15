"""Cross-check tests — yfinance vs FMP disagreement detection, no API calls."""

from data.fetcher import (
    DataQualityValidator,
    TickerData,
    cross_check_sources,
    _CROSS_CHECK_TOLERANCES,
)
from datetime import datetime, timezone


def _make_ticker_data(**overrides) -> TickerData:
    defaults = dict(
        ticker="AAPL",
        fetched_at=datetime.now(tz=timezone.utc),
        price_history={},
        income_statement={},
        balance_sheet={},
        cash_flow={},
        key_ratios={"price": 200.0},
    )
    defaults.update(overrides)
    return TickerData(**defaults)


# ---------------------------------------------------------------------------
# cross_check_sources unit tests
# ---------------------------------------------------------------------------

def test_no_warnings_when_sources_agree():
    yf = {"price": 200.0, "market_cap": 3e12, "pe_ratio_trailing": 35.0}
    fmp = {"price": 201.0, "market_cap": 3.05e12, "pe_ratio_trailing": 35.5}
    warnings = cross_check_sources(yf, fmp, "AAPL")
    assert warnings == []


def test_price_disagreement_beyond_tolerance():
    yf = {"price": 200.0}
    fmp = {"price": 210.0}  # 5% diff, tolerance is 2%
    warnings = cross_check_sources(yf, fmp, "AAPL")
    assert len(warnings) == 1
    assert "price" in warnings[0]
    assert "yfinance=200" in warnings[0]
    assert "FMP=210" in warnings[0]


def test_price_within_tolerance_no_warning():
    yf = {"price": 200.0}
    fmp = {"price": 203.0}  # 1.5% diff, within 2%
    warnings = cross_check_sources(yf, fmp, "AAPL")
    assert warnings == []


def test_market_cap_disagreement():
    yf = {"market_cap": 3_000_000_000_000}
    fmp = {"market_cap": 3_400_000_000_000}  # ~12% diff, tolerance is 10%
    warnings = cross_check_sources(yf, fmp, "AAPL")
    assert len(warnings) == 1
    assert "market_cap" in warnings[0]


def test_pe_ratio_disagreement():
    yf = {"pe_ratio_trailing": 35.0}
    fmp = {"pe_ratio_trailing": 40.0}  # ~12.5% diff
    warnings = cross_check_sources(yf, fmp, "AAPL")
    assert len(warnings) == 1
    assert "pe_ratio_trailing" in warnings[0]


def test_revenue_disagreement():
    yf = {"revenue_ttm": 400_000_000_000}
    fmp = {"revenue_ttm": 350_000_000_000}  # ~12.5% diff
    warnings = cross_check_sources(yf, fmp, "AAPL")
    assert len(warnings) == 1
    assert "revenue_ttm" in warnings[0]


def test_ebitda_disagreement():
    yf = {"ebitda": 130_000_000_000}
    fmp = {"ebitda": 110_000_000_000}  # ~15% diff
    warnings = cross_check_sources(yf, fmp, "AAPL")
    assert len(warnings) == 1
    assert "ebitda" in warnings[0]


def test_multiple_disagreements():
    yf = {
        "price": 200.0,
        "market_cap": 3e12,
        "pe_ratio_trailing": 35.0,
        "revenue_ttm": 400e9,
        "ebitda": 130e9,
    }
    fmp = {
        "price": 220.0,        # 10% off
        "market_cap": 3.5e12,   # 15% off
        "pe_ratio_trailing": 35.5,  # within tolerance
        "revenue_ttm": 350e9,   # 12.5% off
        "ebitda": 135e9,        # within tolerance
    }
    warnings = cross_check_sources(yf, fmp, "AAPL")
    fields_warned = [w.split("on ")[1].split(":")[0] for w in warnings]
    assert "price" in fields_warned
    assert "market_cap" in fields_warned
    assert "revenue_ttm" in fields_warned
    assert "pe_ratio_trailing" not in fields_warned
    assert "ebitda" not in fields_warned


def test_skips_when_either_value_is_none():
    yf = {"price": 200.0, "market_cap": None}
    fmp = {"price": None, "market_cap": 3e12}
    warnings = cross_check_sources(yf, fmp, "AAPL")
    assert warnings == []


def test_skips_when_field_missing_from_source():
    yf = {"price": 200.0}
    fmp = {"market_cap": 3e12}  # price missing from FMP, market_cap missing from yf
    warnings = cross_check_sources(yf, fmp, "AAPL")
    assert warnings == []


def test_both_zero_no_warning():
    yf = {"price": 0, "ebitda": 0}
    fmp = {"price": 0, "ebitda": 0}
    warnings = cross_check_sources(yf, fmp, "AAPL")
    assert warnings == []


def test_custom_tolerances():
    yf = {"price": 200.0}
    fmp = {"price": 204.0}  # 2% diff — default tolerance would pass
    strict = {"price": 0.01}  # 1% tolerance
    warnings = cross_check_sources(yf, fmp, "AAPL", tolerances=strict)
    assert len(warnings) == 1
    assert "price" in warnings[0]


# ---------------------------------------------------------------------------
# Validator integration tests
# ---------------------------------------------------------------------------

def test_validator_incorporates_cross_check_warnings():
    data = _make_ticker_data(key_ratios={"price": 200.0})
    cross_warnings = [
        "Cross-check disagreement on price: yfinance=200 vs FMP=210 (5.0% diff, tolerance 2%)"
    ]
    validator = DataQualityValidator()
    result = validator.validate(data, cross_check_warnings=cross_warnings)
    assert result.data_quality.is_data_limited is True
    assert any("Cross-check" in w for w in result.data_quality.warnings)
    assert "cross_check_yf_fmp" in result.data_quality.checks_run


def test_validator_no_cross_check_when_none():
    data = _make_ticker_data(key_ratios={"price": 200.0})
    validator = DataQualityValidator()
    result = validator.validate(data, cross_check_warnings=None)
    assert "cross_check_yf_fmp" not in result.data_quality.checks_run


def test_validator_no_cross_check_when_empty():
    data = _make_ticker_data(key_ratios={"price": 200.0})
    validator = DataQualityValidator()
    result = validator.validate(data, cross_check_warnings=[])
    assert "cross_check_yf_fmp" not in result.data_quality.checks_run


def test_validator_data_limited_only_from_cross_check():
    """When only the cross-check fires (all other checks pass), data_limited should still be True."""
    data = _make_ticker_data(
        key_ratios={"price": 200.0},
        macro_snapshot={"us_10y_treasury": 4.5},
        technical_snapshot={"rsi_14": 55},
    )
    cross_warnings = [
        "Cross-check disagreement on price: yfinance=200 vs FMP=220 (10.0% diff, tolerance 2%)"
    ]
    validator = DataQualityValidator()
    result = validator.validate(data, cross_check_warnings=cross_warnings)
    assert result.data_quality.is_data_limited is True


def test_default_tolerances_match_constants():
    assert _CROSS_CHECK_TOLERANCES["price"] == 0.02
    assert _CROSS_CHECK_TOLERANCES["market_cap"] == 0.10
    assert _CROSS_CHECK_TOLERANCES["pe_ratio_trailing"] == 0.10
    assert _CROSS_CHECK_TOLERANCES["revenue_ttm"] == 0.10
    assert _CROSS_CHECK_TOLERANCES["ebitda"] == 0.10
