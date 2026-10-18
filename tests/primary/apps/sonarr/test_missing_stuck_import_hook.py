"""
Verifies that process_missing_seasons_packs_mode (the Sonarr season-pack
missing cycle) calls resolve_stuck_queue_items() once a season search has
actually been triggered for a series, and that the hook is wrapped so a
failure inside it can never break the surrounding missing-episode logic.

See docs/superpowers/plans/2026-10-17-tmdb-episode-group-bridge.md (Task 10).
"""
from unittest.mock import patch

from src.primary.apps.sonarr.missing import process_missing_seasons_packs_mode

SERIES_ID = 2145

MISSING_EPISODE = {
    "id": 1,
    "seriesId": SERIES_ID,
    "seasonNumber": 10,
    "monitored": True,
    "airDateUtc": None,
    "series": {"title": "SpongeBob SquarePants"},
}


def _call(stop_check=lambda: False):
    """Call process_missing_seasons_packs_mode with its real positional
    signature (read from src/primary/apps/sonarr/missing.py), tuned so the
    function reaches its success path (a season search gets triggered)
    without needing to mock out exempt-tag lookups or command-wait polling.
    """
    return process_missing_seasons_packs_mode(
        "http://sonarr:8989",      # api_url
        "key",                      # api_key
        "Default",                  # instance_name
        30,                          # api_timeout
        True,                        # monitored_only
        False,                       # skip_future_episodes (avoid air-date parsing)
        1,                           # hunt_missing_items
        0,                           # air_date_delay_days
        0,                           # command_wait_delay (skip wait_for_command)
        0,                           # command_wait_attempts
        stop_check,
        False,                       # tag_processed_items (skip tagging I/O)
        False,                       # tag_enable_missing
        False,                       # tag_enable_shows_missing
        None,                        # custom_tags
        exempt_tags=[],
        hunt_missing_mode="seasons_packs",
        instance_display_name="Default",
    )


@patch("src.primary.apps.sonarr.missing.resolve_stuck_queue_items")
@patch("src.primary.apps.sonarr.missing.increment_stat_only")
@patch("src.primary.apps.sonarr.missing.log_processed_media")
@patch("src.primary.apps.sonarr.missing.add_processed_id", return_value=True)
@patch("src.primary.apps.sonarr.missing.is_processed", return_value=False)
@patch("src.primary.apps.sonarr.missing.check_hourly_cap_exceeded", return_value=False)
@patch("src.primary.apps.sonarr.missing.sonarr_api.search_season", return_value="cmd-123")
@patch(
    "src.primary.apps.sonarr.missing.sonarr_api.get_missing_episodes_random_page",
    return_value=[MISSING_EPISODE],
)
def test_missing_seasons_packs_mode_calls_stuck_import_resolver(
    mock_get_missing,
    mock_search_season,
    mock_cap_exceeded,
    mock_is_processed,
    mock_add_processed_id,
    mock_log_history,
    mock_increment_stat,
    mock_resolve,
):
    mock_resolve.return_value = {"resolved": 0, "unresolved": 0}

    result = _call()

    assert result is True
    mock_resolve.assert_called_once_with("http://sonarr:8989", "key", 30, SERIES_ID)


@patch("src.primary.apps.sonarr.missing.resolve_stuck_queue_items", side_effect=RuntimeError("boom"))
@patch("src.primary.apps.sonarr.missing.increment_stat_only")
@patch("src.primary.apps.sonarr.missing.log_processed_media")
@patch("src.primary.apps.sonarr.missing.add_processed_id", return_value=True)
@patch("src.primary.apps.sonarr.missing.is_processed", return_value=False)
@patch("src.primary.apps.sonarr.missing.check_hourly_cap_exceeded", return_value=False)
@patch("src.primary.apps.sonarr.missing.sonarr_api.search_season", return_value="cmd-123")
@patch(
    "src.primary.apps.sonarr.missing.sonarr_api.get_missing_episodes_random_page",
    return_value=[MISSING_EPISODE],
)
def test_stuck_import_resolver_failure_does_not_break_missing_cycle(
    mock_get_missing,
    mock_search_season,
    mock_cap_exceeded,
    mock_is_processed,
    mock_add_processed_id,
    mock_log_history,
    mock_increment_stat,
    mock_resolve,
):
    """A raised exception inside resolve_stuck_queue_items must not
    propagate out of process_missing_seasons_packs_mode - the normal
    season-search happy path must still complete and return True."""
    result = _call()

    assert result is True
    mock_resolve.assert_called_once_with("http://sonarr:8989", "key", 30, SERIES_ID)
