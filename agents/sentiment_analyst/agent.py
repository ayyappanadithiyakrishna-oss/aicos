from agents.base import AgentContext, AgentOutput, BaseAgent


class SentimentAnalystAgent(BaseAgent):
    def __init__(self):
        super().__init__("sentiment_analyst")

    def name(self) -> str:
        return "Sentiment Analyst"

    def analyze(self, ctx: AgentContext) -> AgentOutput:
        # TODO: implement news/social sentiment, insider flows, options skew
        raise NotImplementedError
