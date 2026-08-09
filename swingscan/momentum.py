"""Momentum confluence (spec section 7).

No single indicator decides anything. We count confluence across RSI, MACD,
ADX(+DI), and ROC — and penalize overheated RSI, because an already-vertical
stock is a worse ENTRY even if it is a strong stock.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd


@dataclass
class MomentumResult:
    score: float
    passed: bool                       # soft gate: at least 3 of 4 confluent
    reasons: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    details: dict = field(default_factory=dict)


def evaluate_momentum(df: pd.DataFrame, cfg) -> MomentumResult:
    row = df.iloc[-1]
    prev = df.iloc[-2]
    m = cfg.momentum
    reasons, flags = [], []

    rsi_ok = row["rsi"] > m.rsi_floor
    macd_ok = row["macd_hist"] > 0
    macd_rising = row["macd_hist"] >= prev["macd_hist"]
    adx_ok = row["adx"] > m.adx_min and row["plus_di"] > row["minus_di"]
    roc_ok = row["roc10"] > 0

    confluence = sum([rsi_ok, macd_ok, adx_ok, roc_ok])
    overheated = row["rsi"] > m.rsi_overheated

    if rsi_ok:
        reasons.append(f"RSI {row['rsi']:.0f} > {m.rsi_floor:.0f}")
    if macd_ok:
        reasons.append("MACD histogram positive" + (" and rising" if macd_rising else ""))
    if adx_ok:
        reasons.append(f"ADX {row['adx']:.0f} with +DI > -DI")
    if roc_ok:
        reasons.append(f"10d ROC +{row['roc10']:.1f}%")
    if overheated:
        flags.append(f"RSI {row['rsi']:.0f} overheated (> {m.rsi_overheated:.0f}) — entry quality reduced")

    score = confluence / 4.0 * 100.0
    if macd_rising and macd_ok:
        score = min(100.0, score + 5.0)
    if overheated:
        score *= 0.6

    return MomentumResult(
        score=float(score), passed=confluence >= 3,
        reasons=reasons, flags=flags,
        details={"rsi": float(row["rsi"]), "adx": float(row["adx"]),
                 "macd_hist": float(row["macd_hist"]), "roc10": float(row["roc10"]),
                 "confluence": int(confluence), "overheated": overheated},
    )
