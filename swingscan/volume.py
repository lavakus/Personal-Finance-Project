"""Volume behaviour (spec section 8).

Classifies the tape into accumulation / distribution / contraction /
expansion and provides the numbers setups need (breakout volume ratio,
pullback contraction). Volume confirmation itself is enforced INSIDE the
setup detectors; this module scores overall volume character.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd


@dataclass
class VolumeResult:
    score: float
    reasons: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    details: dict = field(default_factory=dict)


def evaluate_volume(df: pd.DataFrame, cfg) -> VolumeResult:
    row = df.iloc[-1]
    v = cfg.volume
    reasons, flags = [], []

    vol_ratio = float(row["vol_ratio"]) if np.isfinite(row["vol_ratio"]) else 1.0
    acc_dist = float(row["acc_dist"]) if np.isfinite(row["acc_dist"]) else 0.0
    trend_20_50 = float(row["vol_avg20"] / row["vol_avg50"]) if row["vol_avg50"] > 0 else 1.0

    # Character labels
    character = []
    if acc_dist > 0.15:
        character.append("accumulation")
        reasons.append(f"accumulation: up/down volume balance +{acc_dist:.2f}")
    elif acc_dist < -0.15:
        character.append("distribution")
        flags.append(f"distribution: up/down volume balance {acc_dist:.2f}")
    if trend_20_50 < 0.85:
        character.append("contraction")
    elif trend_20_50 > 1.25:
        character.append("expansion")
    if vol_ratio > 2.5:
        character.append("abnormal")
        reasons.append(f"abnormal volume today ({vol_ratio:.1f}x 20d avg)")
    elif vol_ratio >= v.breakout_vol_mult:
        reasons.append(f"volume expansion today ({vol_ratio:.1f}x 20d avg)")

    # Score: accumulation bias (0-50) + today's participation (0-50)
    score = 50.0 + np.clip(acc_dist * 150.0, -35.0, 35.0)
    score += np.clip((vol_ratio - 1.0) * 25.0, -15.0, 15.0)

    return VolumeResult(
        score=float(np.clip(score, 0, 100)),
        reasons=reasons, flags=flags,
        details={"vol_ratio": vol_ratio, "acc_dist": acc_dist,
                 "vol_trend_20_50": trend_20_50, "character": character},
    )
