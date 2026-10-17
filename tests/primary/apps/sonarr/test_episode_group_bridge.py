import pytest
from src.primary.apps.sonarr.episode_group_bridge import (
    normalize_title,
    join_group_episodes_to_sonarr,
)


def test_normalize_title_strips_punctuation_and_case():
    assert normalize_title("Glove World R.I.P.") == normalize_title("Glove World RIP")
    assert normalize_title("  Swimming  Fools  ") == normalize_title("Swimming Fools")
    assert normalize_title("") == ""
    assert normalize_title(None) == ""


def _sonarr_episode(ep_id, title, season, episode, air_date="2020-01-01"):
    return {
        "id": ep_id,
        "title": title,
        "seasonNumber": season,
        "episodeNumber": episode,
        "airDate": air_date,
    }


def _tmdb_group_detail(season_order, episodes):
    """episodes: list of (name, air_date) tuples"""
    return {
        "groups": [
            {
                "order": season_order,
                "name": f"Season {season_order}",
                "episodes": [
                    {"name": name, "air_date": air_date, "order": i}
                    for i, (name, air_date) in enumerate(episodes)
                ],
            }
        ]
    }


def test_join_clean_unique_match():
    sonarr_eps = [
        _sonarr_episode(1, "Whirlybrains", 9, 43, "2016-10-15"),
        _sonarr_episode(2, "Glove World R.I.P.", 9, 32, "2012-04-03"),
    ]
    group = _tmdb_group_detail(10, [("Whirlybrains", "2016-10-15")])

    result = join_group_episodes_to_sonarr(group, sonarr_eps)

    assert result["match_rate"] == 100.0
    assert len(result["matched"]) == 1
    assert result["matched"][0] == {
        "tmdb_season": 10,
        "tmdb_episode": 1,
        "sonarr_episode_id": 1,
    }
    assert result["unmapped"] == []
    assert result["ambiguous"] == []


def test_join_title_collision_resolved_by_air_date():
    sonarr_eps = [
        _sonarr_episode(1, "The Movie", 1, 1, "2004-01-01"),
        _sonarr_episode(2, "The Movie", 5, 1, "2015-06-01"),
    ]
    group = _tmdb_group_detail(1, [("The Movie", "2015-06-01")])

    result = join_group_episodes_to_sonarr(group, sonarr_eps)

    assert result["match_rate"] == 100.0
    assert result["matched"][0]["sonarr_episode_id"] == 2


def test_join_title_collision_unresolvable_without_air_date_match():
    sonarr_eps = [
        _sonarr_episode(1, "The Movie", 1, 1, "2004-01-01"),
        _sonarr_episode(2, "The Movie", 5, 1, "2015-06-01"),
    ]
    # Neither Sonarr episode's air_date matches the group's — can't disambiguate
    group = _tmdb_group_detail(1, [("The Movie", "1999-01-01")])

    result = join_group_episodes_to_sonarr(group, sonarr_eps)

    assert result["match_rate"] == 0.0
    assert len(result["ambiguous"]) == 1
    assert result["matched"] == []


def test_join_no_title_match_is_unmapped():
    sonarr_eps = [_sonarr_episode(1, "Whirlybrains", 9, 43, "2016-10-15")]
    group = _tmdb_group_detail(10, [("A Completely Different Title", "2016-10-15")])

    result = join_group_episodes_to_sonarr(group, sonarr_eps)

    assert result["match_rate"] == 0.0
    assert len(result["unmapped"]) == 1
    assert result["matched"] == []


def test_join_mixed_match_rate():
    sonarr_eps = [
        _sonarr_episode(1, "Whirlybrains", 9, 43, "2016-10-15"),
        _sonarr_episode(2, "Glove World R.I.P.", 9, 32, "2012-04-03"),
    ]
    group = _tmdb_group_detail(10, [
        ("Whirlybrains", "2016-10-15"),
        ("Glove World R.I.P.", "2012-04-03"),
        ("Nonexistent Episode", "2099-01-01"),
    ])

    result = join_group_episodes_to_sonarr(group, sonarr_eps)

    # 2 of 3 matched
    assert result["match_rate"] == pytest.approx(66.666, rel=0.01)
    assert len(result["matched"]) == 2
    assert len(result["unmapped"]) == 1


from unittest.mock import patch, MagicMock
from src.primary.apps.sonarr.episode_group_bridge import bridge_series
from src.primary.utils.tmdb_client import TmdbApiKeyNotConfigured


@patch("src.primary.apps.sonarr.episode_group_bridge.get_manager_database")
@patch("src.primary.apps.sonarr.episode_group_bridge.enable_scene_numbering", return_value=True)
@patch("src.primary.apps.sonarr.episode_group_bridge.update_episode_scene_numbers", return_value=True)
@patch("src.primary.apps.sonarr.episode_group_bridge.get_episode_group_detail")
@patch("src.primary.apps.sonarr.episode_group_bridge.get_episode_groups_for_show")
@patch("src.primary.apps.sonarr.episode_group_bridge.find_tmdb_id_by_tvdb_id", return_value=387)
def test_bridge_series_happy_path(mock_find, mock_list_groups, mock_group_detail,
                                    mock_update_scene, mock_enable_scene, mock_get_db):
    mock_list_groups.return_value = [
        {"id": "good1", "name": "Paramount+"},
        {"id": "bad1", "name": "Skyshowtime"},
    ]

    def group_detail_side_effect(group_id):
        if group_id == "good1":
            return {
                "groups": [{
                    "order": 10, "name": "Season 10",
                    "episodes": [{"name": "Whirlybrains", "air_date": "2016-10-15", "order": 0}],
                }]
            }
        return {
            "groups": [{
                "order": 1, "name": "Season 1",
                "episodes": [{"name": "Totally Unmatched Title", "air_date": "2016-10-15", "order": 0}],
            }]
        }

    mock_group_detail.side_effect = group_detail_side_effect

    sonarr_episodes = [
        {"id": 1, "title": "Whirlybrains", "seasonNumber": 9, "episodeNumber": 43, "airDate": "2016-10-15"},
    ]

    mock_db = MagicMock()
    mock_get_db.return_value = mock_db

    result = bridge_series("http://sonarr:8989", "key", 30, series_id=2145, tvdb_id=121361,
                             sonarr_episodes=sonarr_episodes)

    assert result["tmdb_id"] == 387
    assert "Paramount+" in result["schemes_kept"]
    assert "Skyshowtime" not in result["schemes_kept"]  # 0% match, below threshold
    assert result["primary_scheme"] == "Paramount+"
    assert result["episodes_updated"] == 1
    assert result["error"] is None
    mock_db.save_episode_group_mapping.assert_called_once()
    mock_enable_scene.assert_called_once_with("http://sonarr:8989", "key", 30, 2145)


@patch("src.primary.apps.sonarr.episode_group_bridge.find_tmdb_id_by_tvdb_id", return_value=None)
def test_bridge_series_no_tmdb_match(mock_find):
    result = bridge_series("http://sonarr:8989", "key", 30, series_id=2145, tvdb_id=999999999,
                             sonarr_episodes=[])

    assert result["tmdb_id"] is None
    assert result["schemes_kept"] == []
    assert result["error"] == "No matching TMDB show found"


@patch("src.primary.apps.sonarr.episode_group_bridge.find_tmdb_id_by_tvdb_id",
       side_effect=TmdbApiKeyNotConfigured("no key"))
def test_bridge_series_no_tmdb_key_configured(mock_find):
    result = bridge_series("http://sonarr:8989", "key", 30, series_id=2145, tvdb_id=121361,
                             sonarr_episodes=[])

    assert result["tmdb_id"] is None
    assert result["schemes_kept"] == []
    assert result["error"] == "No TMDB API key configured. Set your own key in Settings > General."


@patch("src.primary.apps.sonarr.episode_group_bridge.get_episode_groups_for_show",
       side_effect=TmdbApiKeyNotConfigured("no key"))
@patch("src.primary.apps.sonarr.episode_group_bridge.find_tmdb_id_by_tvdb_id", return_value=387)
def test_bridge_series_key_revoked_before_list_groups_call(mock_find, mock_list_groups):
    """TmdbApiKeyNotConfigured can be raised by any TMDB call, not just the
    first one (find_tmdb_id_by_tvdb_id) — regression for Finding 1: the
    try/except must cover every TMDB call, not just the first."""
    result = bridge_series("http://sonarr:8989", "key", 30, series_id=2145, tvdb_id=121361,
                             sonarr_episodes=[])

    assert result["tmdb_id"] is None
    assert result["schemes_kept"] == []
    assert result["error"] == "No TMDB API key configured. Set your own key in Settings > General."


@patch("src.primary.apps.sonarr.episode_group_bridge.get_manager_database")
@patch("src.primary.apps.sonarr.episode_group_bridge.enable_scene_numbering", return_value=True)
@patch("src.primary.apps.sonarr.episode_group_bridge.update_episode_scene_numbers", return_value=True)
@patch("src.primary.apps.sonarr.episode_group_bridge.get_episode_group_detail")
@patch("src.primary.apps.sonarr.episode_group_bridge.get_episode_groups_for_show")
@patch("src.primary.apps.sonarr.episode_group_bridge.find_tmdb_id_by_tvdb_id", return_value=387)
def test_bridge_series_same_named_groups_only_one_primary(
        mock_find, mock_list_groups, mock_group_detail, mock_update_scene,
        mock_enable_scene, mock_get_db):
    """Two distinct TMDB episode groups (different group IDs) sharing the same
    display name must not both be flagged is_primary=True — regression for
    Finding 2: primary must be identified by identity/index, not name equality."""
    mock_list_groups.return_value = [
        {"id": "group-a", "name": "Same Name"},
        {"id": "group-b", "name": "Same Name"},
    ]

    def group_detail_side_effect(group_id):
        if group_id == "group-a":
            return {
                "groups": [{
                    "order": 1, "name": "Season 1",
                    "episodes": [{"name": "Whirlybrains", "air_date": "2016-10-15", "order": 0}],
                }]
            }
        return {
            "groups": [{
                "order": 1, "name": "Season 1",
                "episodes": [
                    {"name": "Whirlybrains", "air_date": "2016-10-15", "order": 0},
                    {"name": "Glove World R.I.P.", "air_date": "2012-04-03", "order": 1},
                ],
            }]
        }

    mock_group_detail.side_effect = group_detail_side_effect

    sonarr_episodes = [
        {"id": 1, "title": "Whirlybrains", "seasonNumber": 9, "episodeNumber": 43, "airDate": "2016-10-15"},
        {"id": 2, "title": "Glove World R.I.P.", "seasonNumber": 9, "episodeNumber": 32, "airDate": "2012-04-03"},
    ]

    mock_db = MagicMock()
    mock_get_db.return_value = mock_db

    result = bridge_series("http://sonarr:8989", "key", 30, series_id=2145, tvdb_id=121361,
                             sonarr_episodes=sonarr_episodes)

    assert result["schemes_kept"] == ["Same Name", "Same Name"]
    assert mock_db.save_episode_group_mapping.call_count == 2
    primary_flags = [
        call.kwargs["is_primary"] for call in mock_db.save_episode_group_mapping.call_args_list
    ]
    assert primary_flags.count(True) == 1
    assert primary_flags.count(False) == 1
    # Both groups match 100% of their own episodes, so this is a tie — which
    # one wins is an implementation detail; the only thing that matters here
    # is that exactly one of the two same-named schemes ends up primary.
