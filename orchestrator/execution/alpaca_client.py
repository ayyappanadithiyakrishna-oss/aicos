"""Paper-trading execution client backed by Alpaca.

This module is intentionally paper-only — ``paper=True`` is hardcoded.
Live trading will go through Robinhood when that path is built.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from alpaca.trading.client import TradingClient
from alpaca.trading.enums import OrderSide, TimeInForce
from alpaca.trading.requests import MarketOrderRequest, LimitOrderRequest


class AlpacaConfigError(RuntimeError):
    """Raised when required Alpaca environment variables are missing."""


@dataclass(frozen=True)
class AccountInfo:
    equity: float
    buying_power: float
    cash: float


@dataclass(frozen=True)
class PositionInfo:
    ticker: str
    qty: float
    market_value: float
    avg_entry: float
    unrealized_pl: float
    unrealized_pl_pct: float


@dataclass(frozen=True)
class OrderResult:
    order_id: str
    ticker: str
    side: str
    notional: float | None
    qty: float | None
    order_type: str
    status: str


def _load_client() -> TradingClient:
    api_key = os.environ.get("ALPACA_API_KEY", "")
    secret_key = os.environ.get("ALPACA_SECRET_KEY", "")

    if not api_key or not secret_key:
        raise AlpacaConfigError(
            "ALPACA_API_KEY and ALPACA_SECRET_KEY must be set in the environment "
            "(check your .env file)"
        )

    return TradingClient(api_key, secret_key, paper=True)


class AlpacaPaperClient:
    """Thin wrapper around Alpaca's TradingClient for paper-only execution."""

    def __init__(self, client: TradingClient | None = None):
        self._client = client or _load_client()

    def submit_order(
        self,
        ticker: str,
        side: str,
        notional: float | None = None,
        qty: float | None = None,
        order_type: str = "market",
        limit_price: float | None = None,
        time_in_force: str = "day",
    ) -> OrderResult:
        order_side = OrderSide.BUY if side.lower() == "buy" else OrderSide.SELL
        tif = TimeInForce.DAY if time_in_force.lower() == "day" else TimeInForce.GTC

        if order_type == "market":
            req = MarketOrderRequest(
                symbol=ticker.upper(),
                side=order_side,
                time_in_force=tif,
                **({"notional": notional} if notional is not None else {"qty": qty}),
            )
        elif order_type == "limit":
            if limit_price is None:
                raise ValueError("limit_price is required for limit orders")
            req = LimitOrderRequest(
                symbol=ticker.upper(),
                side=order_side,
                time_in_force=tif,
                limit_price=limit_price,
                **({"notional": notional} if notional is not None else {"qty": qty}),
            )
        else:
            raise ValueError(f"Unsupported order_type: {order_type!r}")

        order = self._client.submit_order(req)

        return OrderResult(
            order_id=str(order.id),
            ticker=ticker.upper(),
            side=side.lower(),
            notional=notional,
            qty=float(order.qty) if order.qty else None,
            order_type=order_type,
            status=str(order.status),
        )

    def get_position(self, ticker: str) -> PositionInfo | None:
        try:
            pos = self._client.get_open_position(ticker.upper())
        except Exception:
            return None

        return PositionInfo(
            ticker=ticker.upper(),
            qty=float(pos.qty),
            market_value=float(pos.market_value),
            avg_entry=float(pos.avg_entry_price),
            unrealized_pl=float(pos.unrealized_pl),
            unrealized_pl_pct=float(pos.unrealized_plpc),
        )

    def get_account(self) -> AccountInfo:
        acct = self._client.get_account()
        return AccountInfo(
            equity=float(acct.equity),
            buying_power=float(acct.buying_power),
            cash=float(acct.cash),
        )
