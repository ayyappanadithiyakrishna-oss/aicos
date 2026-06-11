from config.settings import Settings
from orchestrator.committee.session import CommitteeSession
from orchestrator.workflows.investment_review import InvestmentReviewWorkflow
from ledger.decisions.store import DecisionStore
from agents.research_analyst.agent import ResearchAnalystAgent
from agents.risk_manager.agent import RiskManagerAgent
from agents.portfolio_manager.agent import PortfolioManagerAgent
from agents.macro_analyst.agent import MacroAnalystAgent
from agents.sentiment_analyst.agent import SentimentAnalystAgent


def build_committee(settings: Settings) -> CommitteeSession:
    agents = [
        ResearchAnalystAgent(),
        RiskManagerAgent(),
        PortfolioManagerAgent(),
        MacroAnalystAgent(),
        SentimentAnalystAgent(),
    ]
    return CommitteeSession(agents=agents)


def main():
    settings = Settings()
    committee = build_committee(settings)
    store = DecisionStore()
    workflow = InvestmentReviewWorkflow(session=committee, store=store)

    ticker = input("Enter ticker: ").strip().upper()
    decision = workflow.run(ticker=ticker)
    print(f"\nDecision for {ticker}: {decision.final_signal} (confidence: {decision.confidence:.0%})")


if __name__ == "__main__":
    main()
