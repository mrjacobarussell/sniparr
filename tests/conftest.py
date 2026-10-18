import tempfile
import os
import pytest
from pathlib import Path
from unittest.mock import patch
from src.primary.utils.database import SniparrDatabase


@pytest.fixture
def tmp_sniparr_db():
    """A real SniparrDatabase backed by a temp file, cleaned up after the test."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    path_obj = Path(path)

    # Monkeypatch _get_database_path to return our temp file path as Path object
    with patch.object(SniparrDatabase, '_get_database_path', return_value=path_obj):
        db = SniparrDatabase()

    yield db

    try:
        os.remove(path)
    except OSError:
        pass
