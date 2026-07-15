from agents.base import AgentContext, AgentOutput, BaseAgent


class ResearchAnalystAgent(BaseAgent):
    def __init__(self):
        super().__init__("research_analyst")

    def name(self) -> str:
        return "Research Analyst"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        # TODO: implement fundamental analysis (earnings, revenue, moat, valuation)
        raise NotImplementedError
