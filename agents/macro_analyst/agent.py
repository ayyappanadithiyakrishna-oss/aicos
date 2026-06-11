from agents.base import AgentContext, AgentOutput, BaseAgent


class MacroAnalystAgent(BaseAgent):
    def __init__(self):
        super().__init__("macro_analyst")

    def name(self) -> str:
        return "Macro Analyst"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        # TODO: implement macro regime analysis (rates, inflation, credit spreads, FX)
        raise NotImplementedError
