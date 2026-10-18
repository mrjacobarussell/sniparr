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
@patch("src.primary.apps.sonarr.stuck_import_resolver.get_queue")
def test_resolve_stuck_queue_items_resolves_via_merged_table(mock_get_queue, mock_arr_request, mock_get_db):
    mock_get_queue.return_value = [
        {
            "title": "SpongeBob.SquarePants.S10E59.720p.HEVC-MeGusta",
            "seriesId": 2145,
            "trackedDownloadStatus": "warning",
            "trackedDownloadState": "importBlocked",
            "outputPath": "/data/incomplete/SpongeBob.S10E59",
        }
    ]
    mock_db = MagicMock()
    mock_db.get_merged_mapping_table.return_value = {"Paramount+|10|59": 225088}
    mock_get_db.return_value = mock_db
    mock_arr_request.return_value = {"id": 12345, "status": "started"}

    result = resolve_stuck_queue_items("http://sonarr:8989", "key", 30, series_id=2145)

    assert result["resolved"] == 1
    assert result["unresolved"] == 0
    mock_arr_request.assert_called_once()
    call_kwargs = mock_arr_request.call_args.kwargs
    assert call_kwargs["data"]["name"] == "ManualImport"


@patch("src.primary.apps.sonarr.stuck_import_resolver.get_manager_database")
@patch("src.primary.apps.sonarr.stuck_import_resolver.get_queue")
def test_resolve_stuck_queue_items_no_mapping_found(mock_get_queue, mock_get_db):
    mock_get_queue.return_value = [
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

    result = resolve_stuck_queue_items("http://sonarr:8989", "key", 30, series_id=2145)

    assert result["resolved"] == 0
    assert result["unresolved"] == 1


@patch("src.primary.apps.sonarr.stuck_import_resolver.get_manager_database")
@patch("src.primary.apps.sonarr.stuck_import_resolver.get_queue")
def test_resolve_stuck_queue_items_ignores_non_warning_items(mock_get_queue, mock_get_db):
    mock_get_queue.return_value = [
        {"title": "x", "seriesId": 2145, "trackedDownloadStatus": "ok",
         "trackedDownloadState": "downloading", "outputPath": "/x"}
    ]
    mock_db = MagicMock()
    mock_db.get_merged_mapping_table.return_value = {}
    mock_get_db.return_value = mock_db

    result = resolve_stuck_queue_items("http://sonarr:8989", "key", 30, series_id=2145)

    assert result["resolved"] == 0
    assert result["unresolved"] == 0
