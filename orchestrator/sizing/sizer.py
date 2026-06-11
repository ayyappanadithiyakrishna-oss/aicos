"""
Conviction-based position sizer.

Maps committee confidence to a dollar allocation (notional) and share count.
No I/O — pure calculation that can be tested without ledger or API access.

Tier table (fraction of current portfolio value):
    65% ≤ confidence < 70%  →  tier_low_pct   (default 2%)
    70% ≤ confidence < 80%  →  tier_mid_pct   (default 3%)
    confidence ≥ 80%        →  tier_high_pct  (default 4%)
                                or max_position_pct (5%) when allow_max_position=True

The hard cap (max_position_pct) is unconditionally enforced as an upper bound
even if the tier pct somehow exceeds it.
"""

from __future__ import annotations

from dataclasses import dataclass

from config.settings import PortfolioConfig


@dataclass
class SizeResult:
    notional: float          # $ amount to invest
    shares: float            # notional / price  (may be fractional for paper trading)
    pct_of_portfolio: float  # fraction of portfolio used  (0.03 = 3%)
    tier_label: str          # "2% tier" | "3% tier" | "4% tier" | "5% tier (manual override)"
    portfolio_value: float   # portfolio value used for the computation
    reasoning: str           # one-line explanation for the ledger


class PositionSizer:
    """Compute the correct position size given conviction and portfolio state."""

    def compute(
        self,
        confidence: float,
        price: float,
        portfolio_value: float,
        cfg: PortfolioConfig,
    ) -> SizeResult:
        """Return a SizeResult for this conviction/price/portfolio combination.

        Args:
            confidence:      Committee confidence as a float [0, 1].
            price:           Current price per share in USD.
            portfolio_value: Current total portfolio value in USD.
            cfg:             PortfolioConfig from Settings.

        The result respects the hard cap cfg.max_position_pct unconditionally.
        """
        tier_pct, tier_label = self._get_tier(confidence, cfg)

        # Hard cap: notional can never exceed max_position_pct of portfolio,
        # regardless of tier.  This is also the ceiling for the 5% override.
        notional = min(tier_pct * portfolio_value,
                       cfg.max_position_pct * portfolio_value)

        shares = notional / price if price > 0 else 0.0

        reasoning = (
            f"Conviction {confidence:.1%} → {tier_label}. "
            f"${notional:,.2f} ({tier_pct:.0%} of ${portfolio_value:,.0f}). "
            f"{shares:.4f} shares @ ${price:.2f}."
        )

        return SizeResult(
            notional=notional,
            shares=shares,
            pct_of_portfolio=tier_pct,
            tier_label=tier_label,
            portfolio_value=portfolio_value,
            reasoning=reasoning,
        )

    # ── Internal ─────────────────────────────────────────────────────────────

    def _get_tier(
        self, confidence: float, cfg: PortfolioConfig
    ) -> tuple[float, str]:
        """Map conviction to (tier_pct, tier_label)."""
        # Tier boundaries: [65%, 70%) | [70%, 80%) | [80%, ∞)
        if confidence < 0.70:
            return cfg.tier_low_pct, f"{cfg.tier_low_pct:.0%} tier"

        if confidence < 0.80:
            return cfg.tier_mid_pct, f"{cfg.tier_mid_pct:.0%} tier"

        # Top tier: use max_position_pct when override is enabled, otherwise tier_high_pct
        if cfg.allow_max_position:
            pct = cfg.max_position_pct
            return pct, f"{pct:.0%} tier (manual override)"

        return cfg.tier_high_pct, f"{cfg.tier_high_pct:.0%} tier"
