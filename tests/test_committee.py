"""Full committee debate tests — three rounds, mock agents, no API calls."""

from agents.base import AgentContext
from orchestrator.committee.session import CommitteeSession
from tests.mocks.agents import (
    MockBearAgent,
    MockBullAgent,
    MockContrarianAgent,
    MockDevilsAdvocateAgent,
    MockFutureLookerAgent,
)

AAPL_STUB = {
    "price": 295.63,
    "market_cap_bn": 4342.0,
    "pe_ratio_trailing": 35.83,
    "revenue_ttm_bn": 391.0,
    "free_cash_flow_bn": 101.1,
}


def _make_session():
    agents = [
        MockBearAgent(),
        MockBullAgent(),
        MockContrarianAgent(),
        MockDevilsAdvocateAgent(),
        MockFutureLookerAgent(),
    ]
    return CommitteeSession(agents=agents)


def _ctx() -> AgentContext:
    return AgentContext(ticker="AAPL", timeframe="12 months", data=AAPL_STUB)


def test_convene_returns_result():
    result = _make_session().convene(_ctx())
    assert result.ticker == "AAPL"
    assert result.final_signal in {"buy", "sell", "hold", "reduce", "avoid"}


def test_three_rounds_recorded():
    result = _make_session().convene(_ctx())
    assert len(result.rounds) == 3
    for i, r in enumerate(result.rounds, 1):
        assert r.round_number == i
        assert len(r.outputs) == 5


def test_confidence_is_fraction():
    result = _make_session().convene(_ctx())
    assert 0.0 < result.confidence <= 1.0


def test_majority_buy_with_mock_agents():
    result = _make_session().convene(_ctx())
    assert result.final_signal == "buy"
    assert len(result.votes) == 3
    assert len(result.dissents) == 2


def test_dissent_summary_not_empty():
    result = _make_session().convene(_ctx())
    assert len(result.dissent_summary) > 0


def test_all_round3_agents_present():
    result = _make_session().convene(_ctx())
    all_ids = {o.agent_id for o in result.votes + result.dissents}
    assert all_ids == {"bear", "bull", "contrarian", "devils_advocate", "future_looker"}


def test_round2_outputs_reference_opposition():
    result = _make_session().convene(_ctx())
    r2 = result.rounds[1].outputs
    for out in r2:
        assert "opposing_reference" in out.metadata
