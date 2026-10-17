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
from src.primary.utils.tmdb_client import (
    find_tmdb_id_by_tvdb_id,
    get_episode_groups_for_show,
    get_episode_group_detail,
    TmdbApiKeyNotConfigured,
)
from src.primary.apps.sonarr.api import update_episode_scene_numbers, enable_scene_numbering
from src.primary.utils.database import get_manager_database

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


def bridge_series(api_url: str, api_key: str, api_timeout: int, series_id: int,
                   tvdb_id: int, sonarr_episodes: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Discover TMDB episode groups for a series, keep every group matching
    >= MIN_GROUP_MATCH_RATE, merge them into the DB, write the best-matching
    scheme's numbers into Sonarr as scene numbering, and enable scene numbering
    on the series.

    Returns a summary dict; never raises — all failures are captured in
    result["error"] so callers (the route, the periodic refresh job) can log
    and move on without crashing a batch of other shows. This includes a
    missing TMDB key: every TMDB call in this module goes through
    require_user_tmdb_api_key() (no shared fallback key for this feature —
    see Task 2), so an unconfigured key surfaces here as a clean error
    rather than silently calling TMDB under a shared key.
    """
    try:
        tmdb_id = find_tmdb_id_by_tvdb_id(tvdb_id)

        if tmdb_id is None:
            logger.info(f"No TMDB show found for series {series_id} (tvdbId {tvdb_id}) — skipping bridge")
            return {"tmdb_id": None, "schemes_kept": [], "primary_scheme": None,
                    "episodes_updated": 0, "error": "No matching TMDB show found"}

        groups = get_episode_groups_for_show(tmdb_id)
        if not groups:
            logger.info(f"No TMDB episode groups found for show {tmdb_id} (series {series_id})")
            return {"tmdb_id": tmdb_id, "schemes_kept": [], "primary_scheme": None,
                    "episodes_updated": 0, "error": "No episode groups available"}

        kept_schemes = []  # list of (scheme_name, match_rate, matched_entries)
        for group_summary in groups:
            group_id = group_summary.get("id")
            group_name = group_summary.get("name")
            detail = get_episode_group_detail(group_id)
            if not detail:
                continue
            join_result = join_group_episodes_to_sonarr(detail, sonarr_episodes)
            if join_result["match_rate"] >= MIN_GROUP_MATCH_RATE:
                kept_schemes.append((group_name, join_result["match_rate"], join_result["matched"]))
            else:
                logger.debug(f"Discarding TMDB group '{group_name}' for series {series_id}: "
                             f"{join_result['match_rate']:.1f}% match rate (below {MIN_GROUP_MATCH_RATE}%)")
    except TmdbApiKeyNotConfigured as e:
        logger.info(f"Bridge skipped for series {series_id}: {e}")
        return {"tmdb_id": None, "schemes_kept": [], "primary_scheme": None,
                "episodes_updated": 0,
                "error": "No TMDB API key configured. Set your own key in Settings > General."}

    if not kept_schemes:
        logger.info(f"No TMDB episode groups cleared the match threshold for series {series_id}")
        return {"tmdb_id": tmdb_id, "schemes_kept": [], "primary_scheme": None,
                "episodes_updated": 0, "error": "No episode group matched well enough"}

    # Primary = highest match rate among kept schemes. Identify it by index
    # (object identity), not by scheme_name equality — two distinct TMDB
    # episode groups can share the same display name, and name-equality
    # comparison would flag every same-named kept scheme as primary.
    primary_index, (primary_scheme, primary_match_rate, primary_entries) = max(
        enumerate(kept_schemes), key=lambda pair: pair[1][1]
    )

    db = get_manager_database()
    for index, (scheme_name, match_rate, matched_entries) in enumerate(kept_schemes):
        mapping = {
            f"{entry['tmdb_season']}|{entry['tmdb_episode']}": entry["sonarr_episode_id"]
            for entry in matched_entries
        }
        db.save_episode_group_mapping(
            series_id=series_id, tmdb_id=tmdb_id, scheme_name=scheme_name,
            is_primary=(index == primary_index), match_rate=match_rate, mapping=mapping,
        )

    updated_count = 0
    for entry in primary_entries:
        success = update_episode_scene_numbers(
            api_url, api_key, api_timeout, entry["sonarr_episode_id"],
            entry["tmdb_season"], entry["tmdb_episode"],
        )
        if success:
            updated_count += 1

    enable_scene_numbering(api_url, api_key, api_timeout, series_id)

    return {
        "tmdb_id": tmdb_id,
        "schemes_kept": [s[0] for s in kept_schemes],
        "primary_scheme": primary_scheme,
        "episodes_updated": updated_count,
        "error": None,
    }
