import json


def test_save_and_retrieve_single_mapping(tmp_sniparr_db):
    mapping = {"10|1": 100, "10|2": 101}
    row_id = tmp_sniparr_db.save_episode_group_mapping(
        sonarr_instance_id="sonarr-instance-a",
        series_id=2145,
        tmdb_id=387,
        scheme_name="Paramount+",
        is_primary=True,
        match_rate=98.9,
        mapping=mapping,
    )

    assert isinstance(row_id, int)

    rows = tmp_sniparr_db.get_episode_group_mappings_for_series("sonarr-instance-a", 2145)
    assert len(rows) == 1
    assert rows[0]["scheme_name"] == "Paramount+"
    assert rows[0]["sonarr_instance_id"] == "sonarr-instance-a"
    assert rows[0]["is_primary"] is True
    assert rows[0]["match_rate"] == 98.9
    assert json.loads(rows[0]["mapping_json"]) == mapping


def test_multiple_schemes_for_same_series(tmp_sniparr_db):
    tmp_sniparr_db.save_episode_group_mapping(
        sonarr_instance_id="sonarr-instance-a", series_id=2145, tmdb_id=387, scheme_name="Paramount+",
        is_primary=True, match_rate=98.9, mapping={"10|1": 100},
    )
    tmp_sniparr_db.save_episode_group_mapping(
        sonarr_instance_id="sonarr-instance-a", series_id=2145, tmdb_id=387, scheme_name="Netflix",
        is_primary=False, match_rate=99.3, mapping={"4|1": 100},
    )

    rows = tmp_sniparr_db.get_episode_group_mappings_for_series("sonarr-instance-a", 2145)
    assert len(rows) == 2
    names = {r["scheme_name"] for r in rows}
    assert names == {"Paramount+", "Netflix"}


def test_get_merged_mapping_table_combines_all_schemes(tmp_sniparr_db):
    tmp_sniparr_db.save_episode_group_mapping(
        sonarr_instance_id="sonarr-instance-a", series_id=2145, tmdb_id=387, scheme_name="Paramount+",
        is_primary=True, match_rate=98.9, mapping={"10|1": 100},
    )
    tmp_sniparr_db.save_episode_group_mapping(
        sonarr_instance_id="sonarr-instance-a", series_id=2145, tmdb_id=387, scheme_name="Netflix",
        is_primary=False, match_rate=99.3, mapping={"4|1": 100},
    )

    merged = tmp_sniparr_db.get_merged_mapping_table("sonarr-instance-a", 2145)

    assert merged["Paramount+|10|1"] == 100
    assert merged["Netflix|4|1"] == 100


def test_get_merged_mapping_table_empty_for_unknown_series(tmp_sniparr_db):
    assert tmp_sniparr_db.get_merged_mapping_table("sonarr-instance-a", 999999) == {}


def test_resaving_same_scheme_replaces_not_duplicates(tmp_sniparr_db):
    tmp_sniparr_db.save_episode_group_mapping(
        sonarr_instance_id="sonarr-instance-a", series_id=2145, tmdb_id=387, scheme_name="Paramount+",
        is_primary=True, match_rate=90.0, mapping={"10|1": 100},
    )
    tmp_sniparr_db.save_episode_group_mapping(
        sonarr_instance_id="sonarr-instance-a", series_id=2145, tmdb_id=387, scheme_name="Paramount+",
        is_primary=True, match_rate=98.9, mapping={"10|1": 100, "10|2": 101},
    )

    rows = tmp_sniparr_db.get_episode_group_mappings_for_series("sonarr-instance-a", 2145)
    assert len(rows) == 1
    assert rows[0]["match_rate"] == 98.9


def test_same_series_id_different_instances_do_not_collide(tmp_sniparr_db):
    """Regression for Finding 1: two different Sonarr instances can both have a
    series with the same numeric series_id. Saving a mapping for instance A's
    series 2145 must not overwrite or be visible from instance B's series 2145."""
    tmp_sniparr_db.save_episode_group_mapping(
        sonarr_instance_id="sonarr-instance-a", series_id=2145, tmdb_id=387, scheme_name="Paramount+",
        is_primary=True, match_rate=98.9, mapping={"10|1": 100},
    )
    tmp_sniparr_db.save_episode_group_mapping(
        sonarr_instance_id="sonarr-instance-b", series_id=2145, tmdb_id=999, scheme_name="Paramount+",
        is_primary=True, match_rate=97.0, mapping={"5|1": 500},
    )

    rows_a = tmp_sniparr_db.get_episode_group_mappings_for_series("sonarr-instance-a", 2145)
    rows_b = tmp_sniparr_db.get_episode_group_mappings_for_series("sonarr-instance-b", 2145)

    assert len(rows_a) == 1
    assert len(rows_b) == 1
    assert rows_a[0]["tmdb_id"] == 387
    assert rows_b[0]["tmdb_id"] == 999

    merged_a = tmp_sniparr_db.get_merged_mapping_table("sonarr-instance-a", 2145)
    merged_b = tmp_sniparr_db.get_merged_mapping_table("sonarr-instance-b", 2145)
    assert merged_a == {"Paramount+|10|1": 100}
    assert merged_b == {"Paramount+|5|1": 500}


def test_mappings_ordered_primary_first_then_by_match_rate_desc(tmp_sniparr_db):
    """Regression for Finding 2: rows come back primary-first, then by
    descending match_rate, so merging preserves scheme priority order."""
    tmp_sniparr_db.save_episode_group_mapping(
        sonarr_instance_id="sonarr-instance-a", series_id=2145, tmdb_id=387, scheme_name="Low",
        is_primary=False, match_rate=95.5, mapping={"1|1": 1},
    )
    tmp_sniparr_db.save_episode_group_mapping(
        sonarr_instance_id="sonarr-instance-a", series_id=2145, tmdb_id=387, scheme_name="Primary",
        is_primary=True, match_rate=96.0, mapping={"1|1": 2},
    )
    tmp_sniparr_db.save_episode_group_mapping(
        sonarr_instance_id="sonarr-instance-a", series_id=2145, tmdb_id=387, scheme_name="High",
        is_primary=False, match_rate=99.0, mapping={"1|1": 3},
    )

    rows = tmp_sniparr_db.get_episode_group_mappings_for_series("sonarr-instance-a", 2145)
    names_in_order = [r["scheme_name"] for r in rows]

    assert names_in_order == ["Primary", "High", "Low"]
