import pytest
from unittest.mock import patch, Mock
import requests as requests_module
from src.primary.utils.tmdb_client import (
    find_tmdb_id_by_tvdb_id,
    require_user_tmdb_api_key,
    TmdbApiKeyNotConfigured,
    get_episode_groups_for_show,
    get_episode_group_detail,
)


def requests_module_http_error():
    return requests_module.exceptions.HTTPError("404 Client Error")


@patch("src.primary.utils.tmdb_client.get_setting", return_value="user-own-key")
def test_require_user_tmdb_api_key_present(mock_get_setting):
    assert require_user_tmdb_api_key() == "user-own-key"
    mock_get_setting.assert_called_once_with("general", "tmdb_api_key", "")


@patch("src.primary.utils.tmdb_client.get_setting", return_value="")
def test_require_user_tmdb_api_key_missing_raises(mock_get_setting):
    with pytest.raises(TmdbApiKeyNotConfigured):
        require_user_tmdb_api_key()


@patch("src.primary.utils.tmdb_client.requests.get")
@patch("src.primary.utils.tmdb_client.require_user_tmdb_api_key", return_value="fake-key")
def test_find_tmdb_id_by_tvdb_id_found(mock_key, mock_get):
    mock_response = Mock()
    mock_response.raise_for_status = Mock()
    mock_response.json.return_value = {
        "tv_results": [{"id": 387, "name": "SpongeBob SquarePants"}]
    }
    mock_get.return_value = mock_response

    result = find_tmdb_id_by_tvdb_id(121361)

    assert result == 387
    mock_get.assert_called_once()
    call_args = mock_get.call_args
    assert "find/121361" in call_args[0][0]
    assert call_args[1]["params"]["external_source"] == "tvdb_id"
    assert call_args[1]["params"]["api_key"] == "fake-key"


@patch("src.primary.utils.tmdb_client.requests.get")
@patch("src.primary.utils.tmdb_client.require_user_tmdb_api_key", return_value="fake-key")
def test_find_tmdb_id_by_tvdb_id_not_found(mock_key, mock_get):
    mock_response = Mock()
    mock_response.raise_for_status = Mock()
    mock_response.json.return_value = {"tv_results": []}
    mock_get.return_value = mock_response

    result = find_tmdb_id_by_tvdb_id(999999999)

    assert result is None


@patch("src.primary.utils.tmdb_client.require_user_tmdb_api_key", side_effect=TmdbApiKeyNotConfigured())
def test_find_tmdb_id_by_tvdb_id_propagates_missing_key(mock_key):
    with pytest.raises(TmdbApiKeyNotConfigured):
        find_tmdb_id_by_tvdb_id(121361)


@patch("src.primary.utils.tmdb_client.requests.get")
@patch("src.primary.utils.tmdb_client.require_user_tmdb_api_key", return_value="fake-key")
def test_get_episode_groups_for_show(mock_key, mock_get):
    mock_response = Mock()
    mock_response.raise_for_status = Mock()
    mock_response.json.return_value = {
        "results": [
            {"id": "abc123", "name": "Paramount+", "episode_count": 613, "group_count": 15},
            {"id": "def456", "name": "Netflix", "episode_count": 273, "group_count": 6},
        ]
    }
    mock_get.return_value = mock_response

    result = get_episode_groups_for_show(387)

    assert len(result) == 2
    assert result[0]["name"] == "Paramount+"


@patch("src.primary.utils.tmdb_client.requests.get")
@patch("src.primary.utils.tmdb_client.require_user_tmdb_api_key", return_value="fake-key")
def test_get_episode_group_detail(mock_key, mock_get):
    mock_response = Mock()
    mock_response.raise_for_status = Mock()
    mock_response.json.return_value = {
        "id": "abc123",
        "name": "Paramount+",
        "groups": [
            {
                "order": 10,
                "name": "Season 10",
                "episodes": [
                    {"name": "Whirlybrains", "air_date": "2016-10-15", "order": 0}
                ],
            }
        ],
    }
    mock_get.return_value = mock_response

    result = get_episode_group_detail("abc123")

    assert result["groups"][0]["name"] == "Season 10"
    assert len(result["groups"][0]["episodes"]) == 1


@patch("src.primary.utils.tmdb_client.requests.get")
@patch("src.primary.utils.tmdb_client.require_user_tmdb_api_key", return_value="fake-key")
def test_get_episode_group_detail_not_found(mock_key, mock_get):
    mock_response = Mock()
    mock_response.raise_for_status.side_effect = requests_module_http_error()
    mock_get.return_value = mock_response

    result = get_episode_group_detail("nonexistent")

    assert result is None
