class BuyAndHoldBenchmark:
    """Baseline: buy on first signal date, hold through entire period."""

    def run(self, prices: list[float]) -> list[float]:
        if not prices:
            return []
        initial = prices[0]
        return [p / initial for p in prices]
