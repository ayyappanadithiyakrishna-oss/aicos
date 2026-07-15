"""SEC EDGAR cross-check tests — mocked edgartools responses, no live SEC calls."""

from unittest.mock import patch, MagicMock
from datetime import datetime, timezone

from data.fetcher import (
    _fetch_edgar_data,
    sec_cross_check,
    EdgarData,
    _SEC_CROSS_CHECK_TOLERANCES,
    TickerData,
    DataQualityValidator,
)


# ---------------------------------------------------------------------------
# sec_cross_check unit tests
# ---------------------------------------------------------------------------

def test_no_warnings_when_financials_agree():
    yf_income = {
        "2024-09-30": {"Total Revenue": 400e9, "Net Income": 100e9, "EBITDA": 130e9}
    }
    yf_balance = {
        "2024-09-30": {"Total Assets": 350e9, "Total Equity Gross Minority Interest": 60e9}
    }
    edgar_financials = {
        "total_revenue": 400e9,
        "net_income": 100e9,
        "ebitda": 130e9,
        "total_assets": 350e9,
        "total_equity": 60e9,
    }
    warnings = sec_cross_check(yf_income, yf_balance, {}, edgar_financials, "AAPL")
    assert warnings == []


def test_revenue_disagreement():
    yf_income = {"2024-09-30": {"Total Revenue": 400e9, "Net Income": 100e9}}
    edgar = {"total_revenue": 350e9, "net_income": 100e9}
    warnings = sec_cross_check(yf_income, {}, {}, edgar, "AAPL")
    assert len(warnings) == 1
    assert "total_revenue" in warnings[0]
    assert "EDGAR" in warnings[0]


def test_net_income_disagreement():
    yf_income = {"2024-09-30": {"Total Revenue": 400e9, "Net Income": 100e9}}
    edgar = {"total_revenue": 400e9, "net_income": 80e9}
    warnings = sec_cross_check(yf_income, {}, {}, edgar, "AAPL")
    assert len(warnings) == 1
    assert "net_income" in warnings[0]


def test_total_assets_disagreement():
    yf_balance = {"2024-09-30": {"Total Assets": 350e9}}
    edgar = {"total_assets": 300e9}
    warnings = sec_cross_check({}, yf_balance, {}, edgar, "AAPL")
    assert len(warnings) == 1
    assert "total_assets" in warnings[0]


def test_total_equity_disagreement():
    yf_balance = {"2024-09-30": {"Stockholders Equity": 60e9}}
    edgar = {"total_equity": 45e9}
    warnings = sec_cross_check({}, yf_balance, {}, edgar, "AAPL")
    assert len(warnings) == 1
    assert "total_equity" in warnings[0]


def test_ebitda_within_tolerance():
    yf_income = {"2024-09-30": {"EBITDA": 130e9}}
    edgar = {"ebitda": 125e9}  # ~3.8% diff, within 15%
    warnings = sec_cross_check(yf_income, {}, {}, edgar, "AAPL")
    assert warnings == []


def test_ebitda_outside_tolerance():
    yf_income = {"2024-09-30": {"EBITDA": 130e9}}
    edgar = {"ebitda": 100e9}  # ~23% diff, outside 15%
    warnings = sec_cross_check(yf_income, {}, {}, edgar, "AAPL")
    assert len(warnings) == 1
    assert "ebitda" in warnings[0]


def test_multiple_disagreements():
    yf_income = {"2024-09-30": {"Total Revenue": 400e9, "Net Income": 100e9, "EBITDA": 130e9}}
    yf_balance = {"2024-09-30": {"Total Assets": 350e9, "Total Equity Gross Minority Interest": 60e9}}
    edgar = {
        "total_revenue": 300e9,  # 25% off
        "net_income": 100e9,     # agrees
        "ebitda": 130e9,         # agrees
        "total_assets": 200e9,   # 43% off
        "total_equity": 60e9,    # agrees
    }
    warnings = sec_cross_check(yf_income, yf_balance, {}, edgar, "AAPL")
    fields_warned = [w.split("on ")[1].split(":")[0] for w in warnings]
    assert "total_revenue" in fields_warned
    assert "total_assets" in fields_warned
    assert "net_income" not in fields_warned


def test_skips_when_edgar_field_is_none():
    yf_income = {"2024-09-30": {"Total Revenue": 400e9}}
    edgar = {"total_revenue": None}
    warnings = sec_cross_check(yf_income, {}, {}, edgar, "AAPL")
    assert warnings == []


def test_skips_when_yf_field_missing():
    yf_income = {"2024-09-30": {}}
    edgar = {"total_revenue": 400e9}
    warnings = sec_cross_check(yf_income, {}, {}, edgar, "AAPL")
    assert warnings == []


def test_both_zero_no_warning():
    yf_income = {"2024-09-30": {"Total Revenue": 0}}
    edgar = {"total_revenue": 0}
    warnings = sec_cross_check(yf_income, {}, {}, edgar, "AAPL")
    assert warnings == []


def test_ttm_revenue_preferred_when_available():
    yf_income = {"2024-09-30": {"Total Revenue": 400e9}}
    yf_ratios = {"revenue_ttm": 410e9}
    edgar = {"total_revenue": 400e9, "total_revenue_ttm": 412e9}
    warnings = sec_cross_check(yf_income, {}, yf_ratios, edgar, "AAPL")
    assert warnings == []


def test_custom_tolerances():
    yf_income = {"2024-09-30": {"Total Revenue": 400e9}}
    edgar = {"total_revenue": 395e9}  # ~1.25% diff
    strict = {"total_revenue": 0.01}  # 1% tolerance
    warnings = sec_cross_check(yf_income, {}, {}, edgar, "AAPL", tolerances=strict)
    assert len(warnings) == 1


def test_default_tolerances():
    assert _SEC_CROSS_CHECK_TOLERANCES["total_revenue"] == 0.10
    assert _SEC_CROSS_CHECK_TOLERANCES["net_income"] == 0.10
    assert _SEC_CROSS_CHECK_TOLERANCES["ebitda"] == 0.15
    assert _SEC_CROSS_CHECK_TOLERANCES["total_assets"] == 0.10
    assert _SEC_CROSS_CHECK_TOLERANCES["total_equity"] == 0.10


# ---------------------------------------------------------------------------
# _fetch_edgar_data with mocked edgartools
# ---------------------------------------------------------------------------

def _make_mock_company(
    income_df=None,
    balance_df=None,
    ttm_revenue=None,
    ttm_net_income=None,
    form4_filings=None,
):
    company = MagicMock()

    # Income statement
    if income_df is not None:
        income_stmt = MagicMock()
        income_stmt.to_dataframe.return_value = income_df
        income_stmt.filing = None
        company.income_statement.return_value = income_stmt
    else:
        company.income_statement.return_value = None

    # Balance sheet
    if balance_df is not None:
        balance_stmt = MagicMock()
        balance_stmt.to_dataframe.return_value = balance_df
        company.balance_sheet.return_value = balance_stmt
    else:
        company.balance_sheet.return_value = None

    # TTM
    if ttm_revenue is not None:
        rev = MagicMock()
        rev.value = ttm_revenue
        company.get_ttm_revenue.return_value = rev
    else:
        company.get_ttm_revenue.return_value = None

    if ttm_net_income is not None:
        ni = MagicMock()
        ni.value = ttm_net_income
        company.get_ttm_net_income.return_value = ni
    else:
        company.get_ttm_net_income.return_value = None

    # Form 4 filings
    if form4_filings is not None:
        company.get_filings.return_value = form4_filings
    else:
        company.get_filings.return_value = []

    return company


@patch("data.fetcher._get_edgar_company")
def test_fetch_edgar_returns_none_on_exception(mock_get_company):
    mock_get_company.side_effect = Exception("CIK not found")
    result = _fetch_edgar_data("FAKE")
    assert result is None


@patch("data.fetcher._get_edgar_company")
def test_fetch_edgar_returns_empty_on_no_data(mock_get_company):
    company = _make_mock_company()
    mock_get_company.return_value = company
    result = _fetch_edgar_data("AAPL")
    assert result is not None
    assert isinstance(result, EdgarData)
    assert result.insider_transactions == []


@patch("data.fetcher._get_edgar_company")
def test_fetch_edgar_extracts_income_statement(mock_get_company):
    import pandas as pd
    income_df = pd.DataFrame(
        {"2024-09-30": [400e9, 100e9]},
        index=["Total Revenue", "Net Income"],
    )
    company = _make_mock_company(income_df=income_df)
    mock_get_company.return_value = company
    result = _fetch_edgar_data("AAPL")
    assert result is not None
    assert result.financials.get("total_revenue") == 400e9
    assert result.financials.get("net_income") == 100e9


@patch("data.fetcher._get_edgar_company")
def test_fetch_edgar_extracts_balance_sheet(mock_get_company):
    import pandas as pd
    balance_df = pd.DataFrame(
        {"2024-09-30": [350e9, 60e9]},
        index=["Total Assets", "Total Equity"],
    )
    company = _make_mock_company(balance_df=balance_df)
    mock_get_company.return_value = company
    result = _fetch_edgar_data("AAPL")
    assert result is not None
    assert result.financials.get("total_assets") == 350e9
    assert result.financials.get("total_equity") == 60e9


@patch("data.fetcher._get_edgar_company")
def test_fetch_edgar_extracts_ttm_values(mock_get_company):
    company = _make_mock_company(ttm_revenue=410e9, ttm_net_income=105e9)
    mock_get_company.return_value = company
    result = _fetch_edgar_data("AAPL")
    assert result is not None
    assert result.financials.get("total_revenue_ttm") == 410e9
    assert result.financials.get("net_income_ttm") == 105e9


# ---------------------------------------------------------------------------
# Validator integration with SEC cross-check
# ---------------------------------------------------------------------------

def test_validator_includes_sec_warnings():
    data = TickerData(
        ticker="AAPL",
        fetched_at=datetime.now(tz=timezone.utc),
        price_history={},
        income_statement={},
        balance_sheet={},
        cash_flow={},
        key_ratios={"price": 200.0},
    )
    sec_warnings = [
        "SEC cross-check disagreement on total_revenue: yfinance=$400.00B vs EDGAR=$300.00B (25.0% diff, tolerance 10%)"
    ]
    validator = DataQualityValidator()
    result = validator.validate(data, cross_check_warnings=sec_warnings)
    assert result.data_quality.is_data_limited is True
    assert any("SEC cross-check" in w for w in result.data_quality.warnings)
