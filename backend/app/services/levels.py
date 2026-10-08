"""Level and gap-band rules (source of truth: DESIGN_SYSTEM.md, seeded into `competency_levels`)."""

from __future__ import annotations

from app.models.enums import GapBand

# rank, name, min, max, description
LEVEL_BANDS: list[tuple[int, str, int, int, str]] = [
    (1, "Foundation", 0, 39, "Recognises the competency and can apply it with guidance."),
    (2, "Developing", 40, 59, "Applies the competency in familiar situations with some support."),
    (3, "Intermediate", 60, 79, "Applies the competency independently in typical entrepreneurial tasks."),
    (4, "Advanced", 80, 89, "Applies the competency in complex situations and supports others."),
    (5, "Proficient", 90, 100, "Applies the competency strategically and develops it in others."),
]

DEFAULT_TARGET = 70


def clamp_score(score: float) -> int:
    return int(max(0, min(100, round(score))))


def level_name_for(score: float) -> str:
    s = clamp_score(score)
    for _, name, lo, hi, _ in LEVEL_BANDS:
        if lo <= s <= hi:
            return name
    return LEVEL_BANDS[0][1]


def level_rank_for(score: float) -> int:
    s = clamp_score(score)
    for rank, _, lo, hi, _ in LEVEL_BANDS:
        if lo <= s <= hi:
            return rank
    return 1


def gap_band(gap: int) -> GapBand:
    """High ≥ 20, Medium 10–19, Low < 10."""
    if gap >= 20:
        return GapBand.HIGH
    if gap >= 10:
        return GapBand.MEDIUM
    return GapBand.LOW
