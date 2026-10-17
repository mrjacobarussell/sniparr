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
