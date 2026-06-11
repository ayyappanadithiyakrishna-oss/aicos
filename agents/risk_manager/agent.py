from agents.base import AgentContext, AgentOutput, BaseAgent


class RiskManagerAgent(BaseAgent):
    def __init__(self):
        super().__init__("risk_manager")

    def name(self) -> str:
        return "Risk Manager"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        # TODO: implement risk scoring (VaR, drawdown, concentration, liquidity)
        raise NotImplementedError
