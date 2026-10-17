from unittest.mock import patch
from src.primary.apps.sonarr.api import update_episode_scene_numbers, enable_scene_numbering


@patch("src.primary.apps.sonarr.api.arr_request")
def test_update_episode_scene_numbers_success(mock_arr_request):
    # First call: GET the episode. Second call: PUT the updated episode.
    mock_arr_request.side_effect = [
        {"id": 225019, "seasonNumber": 9, "episodeNumber": 32, "title": "Glove World R.I.P."},
        {"id": 225019, "sceneSeasonNumber": 10, "sceneEpisodeNumber": 59},
    ]

    result = update_episode_scene_numbers("http://sonarr:8989", "key", 30, 225019, 10, 59)

    assert result is True
    put_call = mock_arr_request.call_args_list[1]
    assert put_call.kwargs["method"] == "PUT"
    assert put_call.kwargs["data"]["sceneSeasonNumber"] == 10
    assert put_call.kwargs["data"]["sceneEpisodeNumber"] == 59


@patch("src.primary.apps.sonarr.api.arr_request")
def test_update_episode_scene_numbers_get_fails(mock_arr_request):
    mock_arr_request.return_value = None

    result = update_episode_scene_numbers("http://sonarr:8989", "key", 30, 225019, 10, 59)

    assert result is False


@patch("src.primary.apps.sonarr.api.arr_request")
def test_enable_scene_numbering_success(mock_arr_request):
    mock_arr_request.side_effect = [
        {"id": 2145, "title": "SpongeBob SquarePants", "useSceneNumbering": False},
        {"id": 2145, "useSceneNumbering": True},
    ]

    result = enable_scene_numbering("http://sonarr:8989", "key", 30, 2145)

    assert result is True
    put_call = mock_arr_request.call_args_list[1]
    assert put_call.kwargs["data"]["useSceneNumbering"] is True
