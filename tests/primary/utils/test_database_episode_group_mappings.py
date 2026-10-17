import json


def test_save_and_retrieve_single_mapping(tmp_sniparr_db):
    mapping = {"10|1": 100, "10|2": 101}
    row_id = tmp_sniparr_db.save_episode_group_mapping(
        series_id=2145,
        tmdb_id=387,
        scheme_name="Paramount+",
        is_primary=True,
        match_rate=98.9,
        mapping=mapping,
    )

    assert isinstance(row_id, int)

    rows = tmp_sniparr_db.get_episode_group_mappings_for_series(2145)
    assert len(rows) == 1
    assert rows[0]["scheme_name"] == "Paramount+"
    assert rows[0]["is_primary"] is True
    assert rows[0]["match_rate"] == 98.9
    assert json.loads(rows[0]["mapping_json"]) == mapping


def test_multiple_schemes_for_same_series(tmp_sniparr_db):
    tmp_sniparr_db.save_episode_group_mapping(
        series_id=2145, tmdb_id=387, scheme_name="Paramount+",
        is_primary=True, match_rate=98.9, mapping={"10|1": 100},
    )
    tmp_sniparr_db.save_episode_group_mapping(
        series_id=2145, tmdb_id=387, scheme_name="Netflix",
        is_primary=False, match_rate=99.3, mapping={"4|1": 100},
    )

    rows = tmp_sniparr_db.get_episode_group_mappings_for_series(2145)
    assert len(rows) == 2
    names = {r["scheme_name"] for r in rows}
    assert names == {"Paramount+", "Netflix"}


def test_get_merged_mapping_table_combines_all_schemes(tmp_sniparr_db):
    tmp_sniparr_db.save_episode_group_mapping(
        series_id=2145, tmdb_id=387, scheme_name="Paramount+",
        is_primary=True, match_rate=98.9, mapping={"10|1": 100},
    )
    tmp_sniparr_db.save_episode_group_mapping(
        series_id=2145, tmdb_id=387, scheme_name="Netflix",
        is_primary=False, match_rate=99.3, mapping={"4|1": 100},
    )

    merged = tmp_sniparr_db.get_merged_mapping_table(2145)

    assert merged["Paramount+|10|1"] == 100
    assert merged["Netflix|4|1"] == 100


def test_get_merged_mapping_table_empty_for_unknown_series(tmp_sniparr_db):
    assert tmp_sniparr_db.get_merged_mapping_table(999999) == {}


def test_resaving_same_scheme_replaces_not_duplicates(tmp_sniparr_db):
    tmp_sniparr_db.save_episode_group_mapping(
        series_id=2145, tmdb_id=387, scheme_name="Paramount+",
        is_primary=True, match_rate=90.0, mapping={"10|1": 100},
    )
    tmp_sniparr_db.save_episode_group_mapping(
        series_id=2145, tmdb_id=387, scheme_name="Paramount+",
        is_primary=True, match_rate=98.9, mapping={"10|1": 100, "10|2": 101},
    )

    rows = tmp_sniparr_db.get_episode_group_mappings_for_series(2145)
    assert len(rows) == 1
    assert rows[0]["match_rate"] == 98.9
