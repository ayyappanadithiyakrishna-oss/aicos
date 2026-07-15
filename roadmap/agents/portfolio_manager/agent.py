from agents.base import AgentContext, AgentOutput, BaseAgent


class PortfolioManagerAgent(BaseAgent):
    def __init__(self):
        super().__init__("portfolio_manager")

    def name(self) -> str:
        return "Portfolio Manager"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        # TODO: implement position sizing, allocation, rebalancing logic
        raise NotImplementedError
