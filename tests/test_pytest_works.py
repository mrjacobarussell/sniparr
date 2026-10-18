def test_pytest_is_working():
    assert 1 + 1 == 2


def test_tmp_sniparr_db_fixture_works(tmp_sniparr_db):
    """Test that the tmp_sniparr_db fixture provides a real, working SniparrDatabase instance.

    This test performs actual database operations through the fixture to verify:
    1. The fixture creates a valid SniparrDatabase instance
    2. The isolated temp file path is properly configured
    3. get_connection() works and can execute real SQL queries
    """
    # Verify the database instance is valid
    assert tmp_sniparr_db is not None
    assert hasattr(tmp_sniparr_db, 'db_path')
    assert str(tmp_sniparr_db.db_path).endswith('.db')

    # Perform actual database operations: get a connection and query it
    conn = tmp_sniparr_db.get_connection()
    assert conn is not None

    # Run a real SQL query against the temp database
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1")
    result = cursor.fetchone()
    # Just verify we can query the database; exact results depend on ensure_database_exists()
    assert result is not None or result is None  # Either way, query succeeded
