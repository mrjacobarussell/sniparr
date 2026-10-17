"""
TMDB episode-group bridge for Sonarr.

Reconciles TheTVDB-based episode numbering (what Sonarr uses) against
TMDB's alternate episode-group numbering schemes, so Sonarr can find and
import releases packaged under a different convention than its own.

See docs/superpowers/specs/2026-10-17-tmdb-episode-group-bridge-design.md
"""
import re
from typing import Dict, Any, List, Optional

from src.primary.utils.logger import get_logger

logger = get_logger("sonarr")

MIN_GROUP_MATCH_RATE = 95.0


def normalize_title(title: Optional[str]) -> str:
    """Lowercase, strip all non-alphanumeric characters. Used so punctuation/
    spacing differences between TMDB and Sonarr titles don't break the join."""
    if not title:
        return ""
    return re.sub(r"[^a-z0-9]+", "", title.lower())


def join_group_episodes_to_sonarr(
    group_detail: Dict[str, Any],
    sonarr_episodes: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Join every episode in a TMDB episode-group's `groups[].episodes[]` to
    Sonarr's episode list by normalized title, using air_date as a tie-breaker
    when multiple Sonarr episodes share a normalized title.

    Returns:
        {
            "matched": [{"tmdb_season": int, "tmdb_episode": int, "sonarr_episode_id": int}, ...],
            "ambiguous": [<tmdb episode dict>, ...],   # title collision, air_date didn't disambiguate
            "unmapped": [<tmdb episode dict>, ...],     # no title match at all
            "match_rate": float,  # percent of total TMDB episodes that landed in "matched"
        }
    """
    sonarr_by_title: Dict[str, List[Dict[str, Any]]] = {}
    for ep in sonarr_episodes:
        key = normalize_title(ep.get("title"))
        if key:
            sonarr_by_title.setdefault(key, []).append(ep)

    matched = []
    ambiguous = []
    unmapped = []
    total = 0

    for season_group in group_detail.get("groups", []):
        tmdb_season = season_group.get("order")
        for i, tmdb_ep in enumerate(season_group.get("episodes", [])):
            total += 1
            key = normalize_title(tmdb_ep.get("name"))
            candidates = sonarr_by_title.get(key, [])

            if len(candidates) == 1:
                matched.append({
                    "tmdb_season": tmdb_season,
                    "tmdb_episode": i + 1,
                    "sonarr_episode_id": candidates[0]["id"],
                })
            elif len(candidates) > 1:
                air_date = tmdb_ep.get("air_date")
                exact = [c for c in candidates if c.get("airDate") == air_date]
                if len(exact) == 1:
                    matched.append({
                        "tmdb_season": tmdb_season,
                        "tmdb_episode": i + 1,
                        "sonarr_episode_id": exact[0]["id"],
                    })
                else:
                    ambiguous.append(tmdb_ep)
            else:
                unmapped.append(tmdb_ep)

    match_rate = (len(matched) / total * 100.0) if total else 0.0

    return {
        "matched": matched,
        "ambiguous": ambiguous,
        "unmapped": unmapped,
        "match_rate": match_rate,
    }
