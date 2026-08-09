"""Composite 0-100 trade-quality score and tiering (spec sections 15-16)."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class ScoreBreakdown:
    components: dict[str, float]       # component name -> 0-100 subscore
    weighted: dict[str, float]         # component name -> contribution
    total: float
    tier: str


def score_candidate(subscores: dict[str, float], cfg) -> ScoreBreakdown:
    weights = cfg.ranking.weights.as_dict()
    assert set(subscores) == set(weights), f"score components mismatch: {set(subscores) ^ set(weights)}"
    weighted = {k: subscores[k] * weights[k] / 100.0 for k in weights}
    total = float(np.clip(sum(weighted.values()), 0.0, 100.0))
    return ScoreBreakdown(subscores, weighted, total, tier_for(total, cfg))


def tier_for(total: float, cfg) -> str:
    tiers = sorted(cfg.ranking.tiers.items(), key=lambda kv: -kv[1])
    for name, floor in tiers:
        if total >= floor:
            return name
    return "REJECT"
