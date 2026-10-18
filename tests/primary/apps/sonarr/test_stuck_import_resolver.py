from unittest.mock import patch, MagicMock
from src.primary.apps.sonarr.stuck_import_resolver import (
    extract_season_episode_from_release_title,
    resolve_stuck_queue_items,
)


def test_extract_season_episode_standard_format():
    assert extract_season_episode_from_release_title(
        "SpongeBob.SquarePants.S10E59.720p.HEVC-MeGusta"
    ) == (10, 59)


def test_extract_season_episode_no_match():
    assert extract_season_episode_from_release_title("No season episode here") is None


def test_extract_season_episode_case_insensitive():
    assert extract_season_episode_from_release_title("show.s05e12.1080p") == (5, 12)


@patch("src.primary.apps.sonarr.stuck_import_resolver.get_manager_database")
@patch("src.primary.apps.sonarr.stuck_import_resolver.arr_request")
def test_resolve_stuck_queue_items_resolves_via_merged_table(mock_arr_request, mock_get_db):
    # First arr_request call: GET queue/details?seriesId=... (unpaged, plain list).
    # Second arr_request call: POST ManualImport command.
    mock_arr_request.side_effect = [
        [
            {
                "title": "SpongeBob.SquarePants.S10E59.720p.HEVC-MeGusta",
                "seriesId": 2145,
                "trackedDownloadStatus": "warning",
                "trackedDownloadState": "importBlocked",
                "outputPath": "/data/incomplete/SpongeBob.S10E59",
            }
        ],
        {"id": 12345, "status": "started"},
    ]
    mock_db = MagicMock()
    mock_db.get_merged_mapping_table.return_value = {"Paramount+|10|59": 225088}
    mock_get_db.return_value = mock_db

    result = resolve_stuck_queue_items(
        "http://sonarr:8989", "key", 30, series_id=2145, sonarr_instance_id="sonarr-instance-a"
    )

    assert result["resolved"] == 1
    assert result["unresolved"] == 0
    assert mock_arr_request.call_count == 2

    # First call is the unpaged, series-filtered queue/details fetch.
    first_call = mock_arr_request.call_args_list[0]
    assert "queue/details" in first_call.args[3]
    assert "seriesId=2145" in first_call.args[3]

    # Second call is the forced ManualImport.
    second_call = mock_arr_request.call_args_list[1]
    assert second_call.kwargs["data"]["name"] == "ManualImport"

    mock_db.get_merged_mapping_table.assert_called_once_with("sonarr-instance-a", 2145)


@patch("src.primary.apps.sonarr.stuck_import_resolver.get_manager_database")
@patch("src.primary.apps.sonarr.stuck_import_resolver.arr_request")
def test_resolve_stuck_queue_items_no_mapping_found(mock_arr_request, mock_get_db):
    mock_arr_request.return_value = [
        {
            "title": "SpongeBob.SquarePants.S99E99.720p.HEVC-MeGusta",
            "seriesId": 2145,
            "trackedDownloadStatus": "warning",
            "trackedDownloadState": "importBlocked",
            "outputPath": "/data/incomplete/x",
        }
    ]
    mock_db = MagicMock()
    mock_db.get_merged_mapping_table.return_value = {"Paramount+|10|59": 225088}
    mock_get_db.return_value = mock_db

    result = resolve_stuck_queue_items(
        "http://sonarr:8989", "key", 30, series_id=2145, sonarr_instance_id="sonarr-instance-a"
    )

    assert result["resolved"] == 0
    assert result["unresolved"] == 1
    # No match found -> no ManualImport POST attempted, only the one GET.
    assert mock_arr_request.call_count == 1


@patch("src.primary.apps.sonarr.stuck_import_resolver.get_manager_database")
@patch("src.primary.apps.sonarr.stuck_import_resolver.arr_request")
def test_resolve_stuck_queue_items_ignores_non_warning_items(mock_arr_request, mock_get_db):
    mock_arr_request.return_value = [
        {"title": "x", "seriesId": 2145, "trackedDownloadStatus": "ok",
         "trackedDownloadState": "downloading", "outputPath": "/x"}
    ]
    mock_db = MagicMock()
    mock_db.get_merged_mapping_table.return_value = {}
    mock_get_db.return_value = mock_db

    result = resolve_stuck_queue_items(
        "http://sonarr:8989", "key", 30, series_id=2145, sonarr_instance_id="sonarr-instance-a"
    )

    assert result["resolved"] == 0
    assert result["unresolved"] == 0


@patch("src.primary.apps.sonarr.stuck_import_resolver.get_manager_database")
@patch("src.primary.apps.sonarr.stuck_import_resolver.arr_request")
def test_resolve_stuck_queue_items_empty_queue_response(mock_arr_request, mock_get_db):
    """arr_request() returns None/falsy on request failure — must not crash,
    just treat it as an empty queue."""
    mock_arr_request.return_value = None
    mock_db = MagicMock()
    mock_get_db.return_value = mock_db

    result = resolve_stuck_queue_items(
        "http://sonarr:8989", "key", 30, series_id=2145, sonarr_instance_id="sonarr-instance-a"
    )

    assert result == {"resolved": 0, "unresolved": 0}
    mock_db.get_merged_mapping_table.assert_not_called()


@patch("src.primary.apps.sonarr.stuck_import_resolver.get_manager_database")
@patch("src.primary.apps.sonarr.stuck_import_resolver.arr_request")
def test_resolve_stuck_queue_items_different_instance_scopes_lookup(mock_arr_request, mock_get_db):
    """Regression for Finding 1: the merged mapping table lookup must be
    scoped to the Sonarr instance the stuck item actually belongs to."""
    mock_arr_request.side_effect = [
        [
            {
                "title": "Show.S10E59.720p-GRP",
                "seriesId": 2145,
                "trackedDownloadStatus": "warning",
                "trackedDownloadState": "importBlocked",
                "outputPath": "/data/incomplete/x",
            }
        ],
        {"id": 1, "status": "started"},
    ]
    mock_db = MagicMock()
    mock_db.get_merged_mapping_table.return_value = {"Paramount+|10|59": 999}
    mock_get_db.return_value = mock_db

    resolve_stuck_queue_items(
        "http://sonarr:8989", "key", 30, series_id=2145, sonarr_instance_id="sonarr-instance-b"
    )

    mock_db.get_merged_mapping_table.assert_called_once_with("sonarr-instance-b", 2145)


@patch("src.primary.apps.sonarr.stuck_import_resolver.get_manager_database")
@patch("src.primary.apps.sonarr.stuck_import_resolver.arr_request")
def test_resolve_stuck_queue_items_conflicting_schemes_logs_and_treats_as_unresolved(mock_arr_request, mock_get_db, caplog):
    """When two schemes disagree on the same (season, episode), the resolver
    must log the conflict and treat it as unresolved — never guess between
    conflicting candidates, even the highest-priority one. A wrong pick here
    would force-import onto the wrong episode."""
    mock_arr_request.return_value = [
        {
            "title": "Show.S10E59.720p-GRP",
            "seriesId": 2145,
            "trackedDownloadStatus": "warning",
            "trackedDownloadState": "importBlocked",
            "outputPath": "/data/incomplete/x",
        }
    ]
    mock_db = MagicMock()
    mock_db.get_merged_mapping_table.return_value = {
        "Primary|10|59": 111,
        "Secondary|10|59": 222,
    }
    mock_get_db.return_value = mock_db

    import logging
    with caplog.at_level(logging.WARNING, logger="sniparr.sonarr"):
        result = resolve_stuck_queue_items(
            "http://sonarr:8989", "key", 30, series_id=2145, sonarr_instance_id="sonarr-instance-a"
        )

    assert result["resolved"] == 0
    assert result["unresolved"] == 1
    mock_arr_request.assert_called_once()  # only the queue fetch, no ManualImport POST
    assert any("Conflicting" in record.message for record in caplog.records)
