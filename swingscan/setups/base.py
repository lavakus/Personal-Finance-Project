"""Shared setup result type."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SetupResult:
    valid: bool
    setup_type: str                    # "PULLBACK" | "BREAKOUT"
    score: float = 0.0                 # setup-quality subscore 0-100
    entry_low: float | None = None     # entry zone
    entry_high: float | None = None
    stop: float | None = None
    key_level: float | None = None     # breakout resistance / pullback trigger
    structure_low: float | None = None # the low the thesis leans on
    reasons: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    reject_reason: str | None = None
    do_not_chase_above: float | None = None
    details: dict = field(default_factory=dict)
