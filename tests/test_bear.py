"""MockBearAgent unit tests — no API calls."""

from agents.base import AgentContext
from tests.mocks.agents import MockBearAgent

AAPL_STUB = {
    "price": 295.63,
    "market_cap_bn": 4342.0,
    "pe_ratio_trailing": 35.83,
    "free_cash_flow_bn": 101.1,
}


def _ctx() -> AgentContext:
    return AgentContext(ticker="AAPL", timeframe="12 months", data=AAPL_STUB)


def test_analyze_returns_reduce():
    agent = MockBearAgent()
    out = agent.analyze(_ctx())
    assert out.signal == "reduce"
    assert 0.0 <= out.conviction <= 1.0


def test_analyze_has_failure_modes():
    out = MockBearAgent().analyze(_ctx())
    fm = out.metadata["failure_modes"]
    assert len(fm) >= 1
    for mode in fm:
        assert "mode" in mode
        assert "estimated_downside" in mode


def test_deliberate_references_opposing_view():
    agent = MockBearAgent()
    r1 = [agent.analyze(_ctx())]
    out = agent.deliberate(_ctx(), r1)
    assert out.signal == "reduce"
    assert "opposing_reference" in out.metadata


def test_final_vote_maintains_signal():
    agent = MockBearAgent()
    ctx = _ctx()
    r1 = [agent.analyze(ctx)]
    r2 = [agent.deliberate(ctx, r1)]
    out = agent.final_vote(ctx, r1 + r2)
    assert out.signal == "reduce"
    assert out.metadata["round"] == 3


def test_conviction_increases_after_deliberation():
    agent = MockBearAgent()
    ctx = _ctx()
    r1_out = agent.analyze(ctx)
    r2_out = agent.deliberate(ctx, [r1_out])
    assert r2_out.conviction >= r1_out.conviction
