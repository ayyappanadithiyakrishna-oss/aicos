"""Universe scanner tests — stubbed financedatabase, temp output, no network."""

import json

import pandas as pd

from config.settings import ScannerConfig, Settings
from orchestrator.workflows.universe_scanner import (
    UniverseScanner,
    _caps_at_or_above,
)


class _StubEquities:
    """Stand-in for financedatabase.Equities().

    Records the kwargs passed to select() and returns a fixed frame so the
    scanner's client-side logic (denylist, sort, cap) can be exercised offline.
    """

    def __init__(self, frame: pd.DataFrame):
        self._frame = frame
        self.calls: list[dict] = []

    def select(self, **kwargs):
        self.calls.append(kwargs)
        return self._frame


def _frame(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows).set_index("symbol")
    return df


def _settings(**scanner_kwargs) -> Settings:
    s = Settings()
    s.scanner = ScannerConfig(**scanner_kwargs)
    return s


# ── Market-cap floor ──────────────────────────────────────────────────────────

def test_caps_at_or_above_inclusive():
    assert _caps_at_or_above("Mid Cap") == ["Mid Cap", "Large Cap", "Mega Cap"]
    assert _caps_at_or_above("Mega Cap") == ["Mega Cap"]


def test_caps_unknown_floor_returns_all():
    assert _caps_at_or_above("Bogus") == [
        "Nano Cap", "Micro Cap", "Small Cap", "Mid Cap", "Large Cap", "Mega Cap"
    ]


# ── Scan behavior ─────────────────────────────────────────────────────────────

def _sample_frame() -> pd.DataFrame:
    return _frame([
        dict(symbol="AAPL", name="Apple", sector="Information Technology",
             industry="Hardware", market_cap="Mega Cap", exchange="NMS", mic="XNAS"),
        dict(symbol="JPM", name="JPMorgan", sector="Financials",
             industry="Banks", market_cap="Large Cap", exchange="NYQ", mic="XNYS"),
        dict(symbol="SPG", name="Simon Property", sector="Real Estate",
             industry="REITs", market_cap="Mid Cap", exchange="NYQ", mic="XNYS"),
    ])


def test_scan_writes_file_and_filters_denylist(tmp_path):
    out = tmp_path / "scanner_candidates.json"
    settings = _settings(market_cap_floor="Mid Cap",
                         sector_denylist=["Real Estate"], output_path=out)
    scanner = UniverseScanner(settings=settings, equities=_StubEquities(_sample_frame()))

    res = scanner.scan()

    symbols = [c["symbol"] for c in res["candidates"]]
    assert "SPG" not in symbols            # denied sector removed
    assert set(symbols) == {"AAPL", "JPM"}
    # File written with the same content.
    on_disk = json.loads(out.read_text())
    assert on_disk["count"] == 2
    assert on_disk["filters"]["market_cap_tiers"] == ["Mid Cap", "Large Cap", "Mega Cap"]


def test_scan_sorts_by_cap_then_symbol(tmp_path):
    settings = _settings(output_path=tmp_path / "c.json")
    scanner = UniverseScanner(settings=settings, equities=_StubEquities(_sample_frame()))
    res = scanner.scan(write=False)
    # Mega before Large before Mid.
    assert [c["symbol"] for c in res["candidates"]] == ["AAPL", "JPM", "SPG"]


def test_allowlist_passed_to_select(tmp_path):
    stub = _StubEquities(_sample_frame())
    settings = _settings(sector_allowlist=["Financials"], output_path=tmp_path / "c.json")
    UniverseScanner(settings=settings, equities=stub).scan(write=False)
    assert stub.calls[0]["sector"] == ["Financials"]
    assert stub.calls[0]["mic"] == ["XNYS", "XNAS"]


def test_max_candidates_truncates(tmp_path):
    settings = _settings(max_candidates=1, output_path=tmp_path / "c.json")
    scanner = UniverseScanner(settings=settings, equities=_StubEquities(_sample_frame()))
    res = scanner.scan(write=False)
    assert res["count"] == 1
    assert res["truncated"] is True
