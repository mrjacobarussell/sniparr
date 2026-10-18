"""
Fallback for stuck Sonarr import-queue items that scene numbering alone
didn't fix (e.g. multi-episode pack files whose internal structure doesn't
trigger Sonarr's own multi-episode detection). Checks the merged TMDB
episode-group mapping table (all kept schemes, not just the primary one)
for a season/episode match, then forces the import via Sonarr's
ManualImport command — same technique validated by hand against the
Muppet Babies pack during the design session.

See docs/superpowers/specs/2026-10-17-tmdb-episode-group-bridge-design.md
"""
import re
from typing import Optional, Tuple, Dict, Any, List

from src.primary.utils.logger import get_logger
from src.primary.utils.database import get_manager_database
from src.primary.apps.sonarr.api import arr_request

logger = get_logger("sonarr")

STUCK_STATES = {"importBlocked", "importPending"}

_SEASON_EPISODE_PATTERN = re.compile(r"[Ss](\d{1,2})[Ee](\d{1,3})")


def extract_season_episode_from_release_title(title: str) -> Optional[Tuple[int, int]]:
    """Parse the first SxxExx-style season/episode out of a release title.
    Returns None if no such pattern is found."""
    if not title:
        return None
    match = _SEASON_EPISODE_PATTERN.search(title)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def _get_queue_details_for_series(api_url: str, api_key: str, api_timeout: int, series_id: int) -> List[Dict[str, Any]]:
    """Fetch Sonarr's queue for one series via `queue/details?seriesId=...`.

    Deliberately does NOT use the shared get_queue() (src.primary.apps.sonarr.api) —
    that calls the plain, paginated `/queue` endpoint with no page/pageSize
    params, so on any install with more than one page of queue items, items
    past the first page would be invisible to this resolver (Finding 4).
    `queue/details` filtered by seriesId is unpaged and server-side filtered
    to just this series, which also avoids an unnecessary full-queue GET for
    series that aren't even stuck.

    get_queue() itself is left untouched since other code may depend on its
    current behavior/signature.
    """
    response = arr_request(
        api_url, api_key, api_timeout, f"queue/details?seriesId={series_id}", count_api=False
    )
    if not response:
        return []
    # Sonarr's queue/details returns a plain JSON array. Defensively also
    # accept a dict with a "records" key, in case that ever changes to match
    # the paginated /queue response shape.
    if isinstance(response, dict):
        return response.get("records", [])
    return response


def _find_sonarr_episode_id(merged_table: Dict[str, int], season: int, episode: int) -> Optional[int]:
    """Look up (season, episode) against every scheme in the merged mapping
    table, regardless of which scheme produced it — the resolver tries ANY
    scheme that resolves the stuck item, not just the primary one.

    merged_table is built from rows ordered primary-first, then by descending
    match_rate (see SniparrDatabase.get_episode_group_mappings_for_series), and
    Python dicts preserve insertion order, so the first match encountered
    while iterating is already the highest-priority scheme — no extra
    ranking logic needed here (Finding 2).

    If multiple schemes disagree on which Sonarr episode this (season,
    episode) resolves to, that's a genuine ambiguity — per the "never guess"
    rule, this returns None (unresolved) rather than picking any one of the
    conflicting candidates, even the highest-priority one. A wrong pick here
    would force-import onto the wrong episode, potentially overwriting a
    real existing file.

    Keys are "{scheme_name}|{season}|{episode}". A key that doesn't split
    into exactly 3 parts, or whose season/episode aren't integers, is simply
    skipped rather than raising — malformed or unexpected table entries must
    never crash the resolver.
    """
    matches: List[Tuple[str, int]] = []  # (scheme_name, sonarr_episode_id), in table order
    for scheme_season_episode_key, candidate_id in merged_table.items():
        parts = scheme_season_episode_key.split("|")
        if len(parts) != 3:
            continue
        scheme_name = parts[0]
        try:
            key_season = int(parts[1])
            key_episode = int(parts[2])
        except (TypeError, ValueError):
            continue
        if key_season == season and key_episode == episode:
            matches.append((scheme_name, candidate_id))

    if not matches:
        return None

    distinct_ids = {candidate_id for _, candidate_id in matches}
    if len(distinct_ids) > 1:
        conflict_detail = ", ".join(f"{name} -> episode {cid}" for name, cid in matches)
        logger.warning(
            f"Conflicting TMDB schemes for S{season}E{episode}: {conflict_detail}. "
            f"Treating as unresolved — never guessing between conflicting candidates."
        )
        return None

    return matches[0][1]


def resolve_stuck_queue_items(api_url: str, api_key: str, api_timeout: int, series_id: int,
                               sonarr_instance_id: str) -> Dict[str, Any]:
    """Scan Sonarr's queue for stuck import items belonging to this series,
    try to resolve each one via the merged TMDB mapping table, and force
    a ManualImport for any that resolve. Never guesses — items with no
    mapping-table match are left alone and counted as unresolved.

    sonarr_instance_id scopes the merged-mapping-table lookup to one
    configured Sonarr instance — series IDs are only unique within a single
    instance, so without this, resolving against the wrong instance's
    mapping table could force-import against the wrong episode IDs
    entirely (Finding 1).
    """
    queue_items = _get_queue_details_for_series(api_url, api_key, api_timeout, series_id)
    stuck_items = [
        item for item in queue_items
        if item.get("seriesId") == series_id
        and item.get("trackedDownloadState") in STUCK_STATES
    ]

    if not stuck_items:
        return {"resolved": 0, "unresolved": 0}

    merged_table = get_manager_database().get_merged_mapping_table(sonarr_instance_id, series_id)

    resolved = 0
    unresolved = 0

    for item in stuck_items:
        season_episode = extract_season_episode_from_release_title(item.get("title", ""))
        if season_episode is None:
            unresolved += 1
            continue

        season, episode = season_episode
        sonarr_episode_id = _find_sonarr_episode_id(merged_table, season, episode)

        if sonarr_episode_id is None:
            logger.info(f"No mapping found for stuck item '{item.get('title')}' "
                        f"(parsed S{season}E{episode}) in series {series_id}")
            unresolved += 1
            continue

        command_response = arr_request(
            api_url, api_key, api_timeout, "command", method="POST", data={
                "name": "ManualImport",
                "importMode": "move",
                "files": [{
                    "path": item.get("outputPath", ""),
                    "seriesId": series_id,
                    "episodeIds": [sonarr_episode_id],
                }],
            },
            count_api=False,
        )

        if command_response:
            logger.info(f"Forced ManualImport for stuck item '{item.get('title')}' -> episode {sonarr_episode_id}")
            resolved += 1
        else:
            unresolved += 1

    return {"resolved": resolved, "unresolved": unresolved}
