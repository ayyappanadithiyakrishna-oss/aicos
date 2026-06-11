"""
AICOS — AI Investment Committee OS

Usage:
    python main.py                      # interactive single-ticker mode
    python main.py --mode watchlist     # batch-run config/watchlist.json
    python main.py --mode watchlist --watchlist path/to/other.json
    python main.py --dry-run            # sets Settings.dry_run = True (default)
"""

import argparse
import sys
from pathlib import Path

from config.settings import Settings
from data.fetcher import DataFetcher
from ledger.decisions.store import DecisionStore
from ledger.positions.store import PositionStore
from ledger.transactions.store import TransactionStore
from orchestrator.committee.session import CommitteeSession
from orchestrator.workflows.investment_review import InvestmentReviewWorkflow
from orchestrator.workflows.watchlist_runner import WatchlistRunner, format_summary


# ---------------------------------------------------------------------------
# Committee factory
# ---------------------------------------------------------------------------

def build_committee() -> CommitteeSession:
    """Construct the five-agent committee using the real Anthropic-backed agents."""
    from agents.bear.agent import BearAgent
    from agents.bull.agent import BullAgent
    from agents.contrarian.agent import ContrarianAgent
    from agents.devils_advocate.agent import DevilsAdvocateAgent
    from agents.future_looker.agent import FutureLookerAgent

    return CommitteeSession(agents=[
        BearAgent(),
        BullAgent(),
        ContrarianAgent(),
        DevilsAdvocateAgent(),
        FutureLookerAgent(),
    ])


def build_workflow(settings: Settings) -> tuple[InvestmentReviewWorkflow, PositionStore, DataFetcher]:
    """Build InvestmentReviewWorkflow, PositionStore, and DataFetcher.

    All three are returned so the watchlist runner can share the same DataFetcher
    instance (and therefore its file cache) for open-position price lookups.
    """
    base = settings.ledger.base_path
    decision_store = DecisionStore(base / "decisions" / "history.jsonl")
    position_store = PositionStore(base / "positions" / "positions.json")
    transaction_store = TransactionStore(base / "transactions" / "transactions.jsonl")
    fetcher = DataFetcher()

    committee = build_committee()

    workflow = InvestmentReviewWorkflow(
        session=committee,
        decision_store=decision_store,
        position_store=position_store,
        transaction_store=transaction_store,
        settings=settings,
        fetcher=fetcher,
    )
    return workflow, position_store, fetcher


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

def run_interactive(workflow: InvestmentReviewWorkflow) -> None:
    """Prompt for a single ticker, run the full committee, and print the result.

    When the workflow has a DataFetcher wired in (the normal case), data is
    fetched automatically and the price prompt is skipped.
    """
    ticker = input("Enter ticker: ").strip().upper()
    if not ticker:
        print("No ticker entered.", file=sys.stderr)
        sys.exit(1)

    # Only ask for a price override when the pipeline fetcher is not available
    data: dict = {}
    if workflow._fetcher is None:
        price_raw = input("Enter current price (or press Enter to skip): ").strip()
        if price_raw:
            try:
                data["price"] = float(price_raw)
            except ValueError:
                print(f"Ignoring invalid price '{price_raw}'.", file=sys.stderr)

    print(f"\nConvening committee for {ticker}…")
    result = workflow.run(ticker=ticker, data=data or None)

    cr = result.committee_result
    print(f"\n{'─' * 60}")
    print(f"  {ticker}  |  {cr.final_signal.upper()}  |  {cr.confidence:.1%} confidence")
    print(f"  Action: {result.ledger_action.upper()}")
    print(f"  {result.ledger_reasoning}")
    if result.size_result:
        print(f"  Sizing: {result.size_result.reasoning}")
    print(f"{'─' * 60}\n")


def run_watchlist(
    workflow: InvestmentReviewWorkflow,
    position_store: PositionStore,
    fetcher: DataFetcher,
    settings: Settings,
    watchlist_path: Path,
) -> None:
    """Batch-run the watchlist and print the daily summary."""
    runner = WatchlistRunner(workflow=workflow, position_store=position_store, fetcher=fetcher)

    print(f"Running watchlist: {watchlist_path}")
    wl_run = runner.run(watchlist_path=watchlist_path)

    print(format_summary(
        wl_run,
        conviction_threshold=settings.committee.conviction_threshold,
    ))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="aicos",
        description="AI Investment Committee OS",
    )
    parser.add_argument(
        "--mode",
        choices=["interactive", "watchlist"],
        default="interactive",
        help="Run mode (default: interactive)",
    )
    parser.add_argument(
        "--watchlist",
        type=Path,
        default=Path("config/watchlist.json"),
        metavar="PATH",
        help="Path to watchlist JSON (default: config/watchlist.json)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Enable dry-run mode (no live orders; default behaviour)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = Settings(dry_run=args.dry_run or True)  # dry_run is always True for now

    workflow, position_store, fetcher = build_workflow(settings)

    if args.mode == "watchlist":
        run_watchlist(workflow, position_store, fetcher, settings, args.watchlist)
    else:
        run_interactive(workflow)


if __name__ == "__main__":
    main()
