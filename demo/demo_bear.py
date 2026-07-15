"""
Integration test: run BearAgent (Victoria Preservation) against AAPL
using data from the centralised DataFetcher pipeline.

All market data comes from DataFetcher — no independent yfinance calls.

Usage:
    python3 tests/test_bear.py   (from /Users/preeya/aicos)
"""

import os
import sys
import textwrap
from pathlib import Path

_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_ROOT))

# Load .env from project root if present
_env_file = _ROOT / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

from agents.base import AgentContext
from agents.bear.agent import BearAgent
from data.fetcher import DataFetcher


def print_output(output) -> None:
    sep = "─" * 72

    print(f"\n{'═' * 72}")
    print(f"  BEAR ANALYSIS — {output.agent_id.upper()}  |  Victoria Preservation")
    print(f"{'═' * 72}\n")

    print(f"SIGNAL      {output.signal.upper()}")
    print(f"CONVICTION  {output.conviction:.2f}  ({int(output.conviction * 100)}%)")

    meta = output.metadata
    print(f"VOTE        {meta['vote']} / 7")
    print(f"CONFIDENCE  {meta['confidence']} / 100")

    print(f"\n{sep}")
    print("WRITTEN ANALYSIS")
    print(sep)
    for ln in textwrap.wrap(output.rationale, width=72):
        print(ln)

    print(f"\n{sep}")
    print("FAILURE MODES")
    print(sep)
    for i, fm in enumerate(meta["failure_modes"], 1):
        print(f"\n[{i}] {fm['mode']}")
        print(f"    Estimated downside: {fm['estimated_downside']}")

    print(f"\n{'═' * 72}\n")


def main() -> None:
    print("Fetching AAPL data via DataFetcher pipeline…")
    fetcher = DataFetcher()
    ticker_data = fetcher.fetch("AAPL")

    dq = ticker_data.data_quality
    price = ticker_data.current_price()
    ratios = ticker_data.key_ratios

    print(
        f"  Price: ${price}  |  "
        f"Market cap: ${ratios.get('market_cap', 0) / 1e9:.1f}B  |  "
        f"P/E: {ratios.get('pe_ratio_trailing')}  |  "
        f"FCF: ${(ratios.get('free_cash_flow') or 0) / 1e9:.1f}B"
    )
    if dq.is_data_limited:
        print(f"\n  ⚠️  Data quality warnings:")
        for w in dq.warnings:
            print(f"     - {w}")

    data = ticker_data.to_agent_dict()
    ctx = AgentContext(
        ticker="AAPL",
        timeframe="12 months",
        data=data,
        data_limited=dq.is_data_limited,
        data_warnings=dq.warnings,
    )

    print("\nRunning BearAgent (Victoria Preservation) — calls Anthropic API…")
    agent = BearAgent()
    output = agent.analyze(ctx)

    print_output(output)


if __name__ == "__main__":
    main()
