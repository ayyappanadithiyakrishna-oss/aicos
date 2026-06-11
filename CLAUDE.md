# AICOS — AI Investment Committee OS

Multi-agent system that runs an investment committee: each agent plays a specialist role, votes on a ticker, and the orchestrator produces a final decision logged to the ledger.

## Architecture

```
aicos/
├── agents/                  # One subpackage per specialist agent
│   ├── base.py              # BaseAgent, AgentContext, AgentOutput ABCs
│   ├── research_analyst/    # Fundamental / valuation analysis
│   ├── risk_manager/        # VaR, drawdown, concentration risk
│   ├── portfolio_manager/   # Sizing and allocation
│   ├── macro_analyst/       # Rates, inflation, regime
│   └── sentiment_analyst/   # News, social, options flow
├── orchestrator/
│   ├── committee/session.py # CommitteeSession — runs agents, deliberates
│   ├── workflows/           # End-to-end workflows (InvestmentReviewWorkflow)
│   └── memory/              # Cross-session agent memory (TBD)
├── ledger/
│   ├── decisions/store.py   # Append-only JSONL decision log
│   ├── positions/store.py   # JSON position book
│   ├── transactions/store.py# Append-only JSONL trade log
│   └── audit/               # Immutable audit trail (TBD)
├── benchmarks/
│   ├── metrics/performance.py  # Sharpe, drawdown, win-rate
│   └── strategies/             # Baseline comparisons (buy-and-hold, etc.)
├── config/settings.py       # Typed settings dataclasses
├── tools/                   # Shared utility functions
├── data/                    # raw / processed / cache (git-ignored)
└── main.py                  # CLI entry point
```

## Key conventions

- Every agent implements `BaseAgent` from `agents/base.py`.
- `AgentOutput.signal` must be one of: `"buy"`, `"sell"`, `"hold"`, `"reduce"`, `"avoid"`.
- `AgentOutput.conviction` is a float 0–1; the committee weights votes by conviction.
- The ledger is append-only; never delete or edit existing records.
- `Settings.dry_run = True` by default — no real orders until explicitly disabled.

## Running

```bash
python main.py
```

## Tests

```bash
pytest tests/
```
