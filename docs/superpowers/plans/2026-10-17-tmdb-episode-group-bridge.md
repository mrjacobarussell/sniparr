# TMDB Episode Group Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically reconcile TheTVDB-based episode numbering (what Sonarr uses) against TMDB's alternate "episode group" numbering schemes, so Sonarr can find and import releases packaged under a different numbering convention.

**Architecture:** A new `episode_group_bridge` module discovers all TMDB episode groups for a show, joins each one against Sonarr's episode list by `(title, air_date)`, keeps every group that matches ≥95%, merges them into one lookup table, writes the best-matching scheme into Sonarr's native scene-numbering fields, and falls back to a forced `ManualImport` when Sonarr's queue shows a stuck item that scene numbering alone didn't fix.

**Tech Stack:** Python 3, Flask (existing), SQLite (existing `SniparrDatabase`), `requests` (existing), `pytest` (new — this repo has no test framework yet, introduced as part of this work).

**Spec:** `docs/superpowers/specs/2026-10-17-tmdb-episode-group-bridge-design.md`

**Correction found during planning:** the spec's "new setting (tmdb_api_key) stored encrypted" is partially unnecessary — `get_tmdb_api_key()` already exists in `src/primary/settings_manager.py:431` with a working settings field (`general.tmdb_api_key`) *plus* an embedded fallback key shared by every install. This feature must not ride on that shared fallback key — each user's install should use their own TMDB key for bridge discovery, not the author's. Task 2 below adds a dedicated `require_user_tmdb_api_key()` guard in `tmdb_client.py` that reads the user-set key directly and returns `None` if absent, ignoring the shared fallback entirely; `bridge_series()` (Task 7) treats a `None` here as a clean "not configured" error surfaced to the UI, not a silent fallback. No changes are made to `settings_manager.py` itself or to its other existing callers (image proxy, trending) — this only affects the new bridge feature's own code path.

## Global Constraints

- Sonarr only — no Radarr/Lidarr/etc. in this pass (explicit scope decision in the spec)
- No independent Prowlarr/SABnzbd download pipeline (explicit scope decision in the spec)
- No manual per-show TMDB group entry — fully automatic discovery (explicit scope decision in the spec)
- Match-quality threshold for keeping a TMDB group: **95%** (from the spec's empirical validation)
- Never guess an unmapped episode — log and skip, surface in UI, don't silently assign
- No shared/embedded TMDB API key for this feature — each install must configure its own key in settings; the bridge must refuse to run (clean error, not a silent fallback) if no user key is set
- Follow existing codebase conventions found during planning: `arr_request()` GET-modify-PUT round-trip for Sonarr writes, `SniparrDatabase` class methods (not raw ad-hoc SQL) for all new persistence, `get_logger(app_type)` for logging

## Review Focus

- **Episode with no air_date** (common for very recent/unaired episodes, or old episodes with missing metadata) — title-only join must not silently produce a false match when multiple episodes share a similar title; test with a title collision to confirm it's correctly flagged ambiguous, not guessed.
- **TMDB show not found for a given tvdbId** (new/obscure show, or TMDB simply doesn't have it) — must skip gracefully and log, not crash the bridge or block other shows.
- **TMDB API returns a rate-limit (429) or timeout** — must not take down the whole discovery cycle for other series; log and retry next cycle.
- **A "kept" group (≥95%) still has a handful of genuinely unmapped episodes within it** — those specific episodes must be excluded from that group's contribution to the merged table, not silently dropped from the whole group or incorrectly mapped.
- **Two different TMDB groups disagree on where the same (season, episode) tuple maps** — the merge step must keep per-scheme entries distinguishable (keyed by scheme name, not a flat overwrite) so the stuck-import fallback can try each scheme in turn rather than only ever seeing the last-written one.
- **No TMDB API key configured for this install** — the bridge must never fall back to a shared/embedded key; it must fail cleanly with a message pointing the user at Settings > General, covered by Task 2's `require_user_tmdb_api_key()` and Task 7's `test_bridge_series_no_tmdb_key_configured`.

---

## File Structure

- Create: `requirements.txt` (modify — add `pytest`)
- Create: `pytest.ini` — pytest config (test discovery root)
- Create: `tests/__init__.py`, `tests/conftest.py` — shared fixtures (temp sqlite DB, mocked `requests`)
- Create: `src/primary/utils/tmdb_client.py` — thin TMDB API wrapper (find-by-tvdb, list groups, group detail)
- Create: `tests/primary/utils/test_tmdb_client.py`
- Modify: `src/primary/utils/database.py` — new `episode_group_mappings` table + `SniparrDatabase` methods
- Create: `tests/primary/utils/test_database_episode_group_mappings.py`
- Modify: `src/primary/apps/sonarr/api.py` — add `update_episode_scene_numbers()`, `enable_scene_numbering()`
- Create: `tests/primary/apps/sonarr/test_api_scene_numbering.py`
- Create: `src/primary/apps/sonarr/episode_group_bridge.py` — title normalization, join, merge, orchestration
- Create: `tests/primary/apps/sonarr/test_episode_group_bridge.py`
- Modify: `src/primary/apps/sonarr_routes.py` — new `/api/sonarr/bridge-episode-groups` route
- Create: `tests/primary/apps/test_sonarr_routes_bridge.py`
- Create: `src/primary/apps/sonarr/stuck_import_resolver.py` — queue scan + merged-table resolution + forced `ManualImport`
- Create: `tests/primary/apps/sonarr/test_stuck_import_resolver.py`
- Modify: `src/primary/apps/sonarr/missing.py` — call the resolver once per season-pack cycle

---

### Task 1: pytest infrastructure

**Files:**
- Modify: `requirements.txt`
- Create: `pytest.ini`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`
- Test: `tests/test_pytest_works.py`

**Interfaces:**
- Produces: a `tmp_sniparr_db` pytest fixture (temp-file `SniparrDatabase` instance, auto-cleaned) that every later DB test reuses.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pytest_works.py
def test_pytest_is_working():
    assert 1 + 1 == 2
```

- [ ] **Step 2: Run test to verify it fails (pytest not installed yet)**

Run: `pytest tests/test_pytest_works.py -v`
Expected: FAIL with "pytest: command not found" or similar

- [ ] **Step 3: Add pytest to requirements.txt and install**

Append to `requirements.txt`:
```
pytest>=8.0.0
```

Run: `pip install -r requirements.txt`

- [ ] **Step 4: Create pytest.ini**

```ini
# pytest.ini
[pytest]
testpaths = tests
python_files = test_*.py
pythonpath = .
```

- [ ] **Step 5: Create tests/__init__.py (empty) and run the test**

Run: `touch tests/__init__.py`
Run: `pytest tests/test_pytest_works.py -v`
Expected: PASS

- [ ] **Step 6: Write the conftest fixture**

```python
# tests/conftest.py
import tempfile
import os
import pytest
from src.primary.utils.database import SniparrDatabase


@pytest.fixture
def tmp_sniparr_db():
    """A real SniparrDatabase backed by a temp file, cleaned up after the test."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    db = SniparrDatabase(db_path=path)
    yield db
    try:
        os.remove(path)
    except OSError:
        pass
```

- [ ] **Step 7: Verify SniparrDatabase accepts a db_path override**

Run: `grep -n "def __init__" src/primary/utils/database.py | head -3`

If `SniparrDatabase.__init__` does not accept a `db_path` parameter, read its actual constructor and adjust the fixture above to match the real signature (e.g. it may read a module-level constant for the path instead — in that case, monkeypatch that constant in the fixture rather than passing a constructor argument).

- [ ] **Step 8: Run full test suite and commit**

Run: `pytest -v`
Expected: PASS (1 test)

```bash
git add requirements.txt pytest.ini tests/__init__.py tests/conftest.py tests/test_pytest_works.py
git commit -m "test: add pytest infrastructure"
```

---

### Task 2: TMDB client — resolve TMDB show ID from a TVDB ID

**Files:**
- Create: `src/primary/utils/tmdb_client.py`
- Test: `tests/primary/utils/test_tmdb_client.py`

**Interfaces:**
- Consumes: `get_setting("general", "tmdb_api_key", "")` from `src.primary.settings_manager` (existing — the same raw settings-read `get_tmdb_api_key()` itself calls before falling back to the shared embedded key; this task deliberately calls the raw getter directly instead of `get_tmdb_api_key()`, to skip that fallback)
- Produces: `class TmdbApiKeyNotConfigured(Exception)`
- Produces: `require_user_tmdb_api_key() -> str` — returns the user's own configured key, or raises `TmdbApiKeyNotConfigured` if none is set (never falls back to the shared embedded key)
- Produces: `find_tmdb_id_by_tvdb_id(tvdb_id: int) -> Optional[int]`

**Why not just use `get_tmdb_api_key()`:** that function exists for other features (trending/popular image proxy) and intentionally falls back to an embedded key shared by every Sniparr install when the user hasn't set their own. For this feature, every install making TMDB calls under one shared key is exactly what we don't want — each user should hit TMDB under their own key. `require_user_tmdb_api_key()` reads the same `general.tmdb_api_key` setting but has no fallback: unset means unset, and the bridge feature refuses to run with a clear error instead of silently riding the author's key.

- [ ] **Step 1: Write the failing test**

```python
# tests/primary/utils/test_tmdb_client.py
import pytest
from unittest.mock import patch, Mock
from src.primary.utils.tmdb_client import (
    find_tmdb_id_by_tvdb_id,
    require_user_tmdb_api_key,
    TmdbApiKeyNotConfigured,
)


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/primary/utils/test_tmdb_client.py -v`
Expected: FAIL with "No module named 'src.primary.utils.tmdb_client'"

- [ ] **Step 3: Write minimal implementation**

First confirm the exact raw-settings-read helper name used inside `get_tmdb_api_key()`:

Run: `sed -n '420,435p' src/primary/settings_manager.py`

Confirm it's `get_setting("general", "tmdb_api_key", "")` (per the design-session notes) and that `get_setting` is importable as `from src.primary.settings_manager import get_setting`. Adjust the import/call below if the real signature differs.

```python
# src/primary/utils/tmdb_client.py
"""
Thin wrapper around TMDB's API for the episode-group bridge feature.
No caching, no retries beyond what requests does by default — this is
called rarely (once per show, on-demand or on periodic refresh), not
in a hot path.

Deliberately does NOT use settings_manager.get_tmdb_api_key() — that
function falls back to a key embedded in the app and shared by every
install. This feature requires each install to use its own TMDB key
(see require_user_tmdb_api_key below) so TMDB usage isn't pooled onto
one shared key across every Sniparr user.
"""
from typing import Optional, List, Dict, Any
import requests
from src.primary.settings_manager import get_setting
from src.primary.utils.logger import get_logger

logger = get_logger("tmdb_client")

TMDB_BASE_URL = "https://api.themoviedb.org/3"
REQUEST_TIMEOUT = 15


class TmdbApiKeyNotConfigured(Exception):
    """Raised when the episode-group bridge needs a TMDB API key and the
    user hasn't configured their own in settings."""
    pass


def require_user_tmdb_api_key() -> str:
    """Return the user's own configured TMDB API key. Raises
    TmdbApiKeyNotConfigured if unset — never falls back to a shared key."""
    key = get_setting("general", "tmdb_api_key", "").strip()
    if not key:
        raise TmdbApiKeyNotConfigured(
            "No TMDB API key configured. Set your own key under Settings > General > TMDB API Key."
        )
    return key


def find_tmdb_id_by_tvdb_id(tvdb_id: int) -> Optional[int]:
    """Resolve a TMDB show ID from a TheTVDB show ID via TMDB's /find endpoint.
    Returns None if not found or on any request failure.
    Raises TmdbApiKeyNotConfigured if no user TMDB key is set."""
    api_key = require_user_tmdb_api_key()
    try:
        response = requests.get(
            f"{TMDB_BASE_URL}/find/{tvdb_id}",
            params={"api_key": api_key, "external_source": "tvdb_id"},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        results = response.json().get("tv_results", [])
        if not results:
            logger.info(f"No TMDB show found for TVDB ID {tvdb_id}")
            return None
        return results[0]["id"]
    except requests.exceptions.RequestException as e:
        logger.error(f"TMDB find-by-tvdb-id failed for {tvdb_id}: {e}")
        return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/primary/utils/test_tmdb_client.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/primary/utils/tmdb_client.py tests/primary/utils/test_tmdb_client.py tests/primary/utils/__init__.py tests/primary/__init__.py
git commit -m "feat: add TMDB find-by-tvdb-id lookup with per-user API key requirement"
```

(Create the empty `tests/primary/__init__.py` and `tests/primary/utils/__init__.py` package markers if they don't already exist, so pytest can import the test module.)

---

### Task 3: TMDB client — list and fetch episode groups

**Files:**
- Modify: `src/primary/utils/tmdb_client.py`
- Modify: `tests/primary/utils/test_tmdb_client.py`

**Interfaces:**
- Produces: `get_episode_groups_for_show(tmdb_show_id: int) -> List[Dict[str, Any]]`
- Produces: `get_episode_group_detail(group_id: str) -> Optional[Dict[str, Any]]`

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/primary/utils/test_tmdb_client.py
from src.primary.utils.tmdb_client import get_episode_groups_for_show, get_episode_group_detail


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
```

Add this helper near the top of the test file (TMDB 404s raise `requests.exceptions.HTTPError` from `raise_for_status()`):

```python
import requests as requests_module

def requests_module_http_error():
    return requests_module.exceptions.HTTPError("404 Client Error")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/primary/utils/test_tmdb_client.py -v`
Expected: FAIL — `get_episode_groups_for_show` and `get_episode_group_detail` not defined

- [ ] **Step 3: Write minimal implementation**

```python
# append to src/primary/utils/tmdb_client.py
def get_episode_groups_for_show(tmdb_show_id: int) -> List[Dict[str, Any]]:
    """List all TMDB episode groups for a show. Returns [] on failure or if none exist.
    Raises TmdbApiKeyNotConfigured if no user TMDB key is set."""
    api_key = require_user_tmdb_api_key()
    try:
        response = requests.get(
            f"{TMDB_BASE_URL}/tv/{tmdb_show_id}/episode_groups",
            params={"api_key": api_key},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        return response.json().get("results", [])
    except requests.exceptions.RequestException as e:
        logger.error(f"TMDB episode_groups list failed for show {tmdb_show_id}: {e}")
        return []


def get_episode_group_detail(group_id: str) -> Optional[Dict[str, Any]]:
    """Fetch full episode detail for one TMDB episode group. Returns None on failure.
    Raises TmdbApiKeyNotConfigured if no user TMDB key is set."""
    api_key = require_user_tmdb_api_key()
    try:
        response = requests.get(
            f"{TMDB_BASE_URL}/tv/episode_group/{group_id}",
            params={"api_key": api_key},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        logger.error(f"TMDB episode_group detail failed for group {group_id}: {e}")
        return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/primary/utils/test_tmdb_client.py -v`
Expected: PASS (5 tests total)

- [ ] **Step 5: Commit**

```bash
git add src/primary/utils/tmdb_client.py tests/primary/utils/test_tmdb_client.py
git commit -m "feat: add TMDB episode-groups list and detail fetch"
```

---

### Task 4: Title normalization and episode join logic

**Files:**
- Create: `src/primary/apps/sonarr/episode_group_bridge.py`
- Create: `tests/primary/apps/sonarr/test_episode_group_bridge.py`

**Interfaces:**
- Produces: `normalize_title(title: str) -> str`
- Produces: `join_group_episodes_to_sonarr(group_detail: Dict[str, Any], sonarr_episodes: List[Dict[str, Any]]) -> Dict[str, Any]` — returns `{"matched": [...], "ambiguous": [...], "unmapped": [...], "match_rate": float}`. Each matched entry is `{"tmdb_season": int, "tmdb_episode": int, "sonarr_episode_id": int}`.

This is the core algorithm from the spec's empirical validation — pure functions, no network/DB calls, easiest to test exhaustively in isolation.

- [ ] **Step 1: Write the failing tests**

```python
# tests/primary/apps/sonarr/test_episode_group_bridge.py
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
```

Add `import pytest` at the top of the test file (needed for `pytest.approx`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/primary/apps/sonarr/test_episode_group_bridge.py -v`
Expected: FAIL — module doesn't exist yet

- [ ] **Step 3: Write minimal implementation**

```python
# src/primary/apps/sonarr/episode_group_bridge.py
"""
TMDB episode-group bridge for Sonarr.

Reconciles TheTVDB-based episode numbering (what Sonarr uses) against
TMDB's alternate episode-group numbering schemes, so Sonarr can find and
import releases packaged under a different convention than its own.

See docs/superpowers/specs/2026-10-17-tmdb-episode-group-bridge-design.md
"""
import re
from typing import Dict, Any, List, Optional

from src.primary.utils.logger import get_logger

logger = get_logger("sonarr")

MIN_GROUP_MATCH_RATE = 95.0


def normalize_title(title: Optional[str]) -> str:
    """Lowercase, strip all non-alphanumeric characters. Used so punctuation/
    spacing differences between TMDB and Sonarr titles don't break the join."""
    if not title:
        return ""
    return re.sub(r"[^a-z0-9]+", "", title.lower())


def join_group_episodes_to_sonarr(
    group_detail: Dict[str, Any],
    sonarr_episodes: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Join every episode in a TMDB episode-group's `groups[].episodes[]` to
    Sonarr's episode list by normalized title, using air_date as a tie-breaker
    when multiple Sonarr episodes share a normalized title.

    Returns:
        {
            "matched": [{"tmdb_season": int, "tmdb_episode": int, "sonarr_episode_id": int}, ...],
            "ambiguous": [<tmdb episode dict>, ...],   # title collision, air_date didn't disambiguate
            "unmapped": [<tmdb episode dict>, ...],     # no title match at all
            "match_rate": float,  # percent of total TMDB episodes that landed in "matched"
        }
    """
    sonarr_by_title: Dict[str, List[Dict[str, Any]]] = {}
    for ep in sonarr_episodes:
        key = normalize_title(ep.get("title"))
        if key:
            sonarr_by_title.setdefault(key, []).append(ep)

    matched = []
    ambiguous = []
    unmapped = []
    total = 0

    for season_group in group_detail.get("groups", []):
        tmdb_season = season_group.get("order")
        for i, tmdb_ep in enumerate(season_group.get("episodes", [])):
            total += 1
            key = normalize_title(tmdb_ep.get("name"))
            candidates = sonarr_by_title.get(key, [])

            if len(candidates) == 1:
                matched.append({
                    "tmdb_season": tmdb_season,
                    "tmdb_episode": i + 1,
                    "sonarr_episode_id": candidates[0]["id"],
                })
            elif len(candidates) > 1:
                air_date = tmdb_ep.get("air_date")
                exact = [c for c in candidates if c.get("airDate") == air_date]
                if len(exact) == 1:
                    matched.append({
                        "tmdb_season": tmdb_season,
                        "tmdb_episode": i + 1,
                        "sonarr_episode_id": exact[0]["id"],
                    })
                else:
                    ambiguous.append(tmdb_ep)
            else:
                unmapped.append(tmdb_ep)

    match_rate = (len(matched) / total * 100.0) if total else 0.0

    return {
        "matched": matched,
        "ambiguous": ambiguous,
        "unmapped": unmapped,
        "match_rate": match_rate,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/primary/apps/sonarr/test_episode_group_bridge.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
mkdir -p tests/primary/apps/sonarr
touch tests/primary/apps/sonarr/__init__.py tests/primary/apps/__init__.py
git add src/primary/apps/sonarr/episode_group_bridge.py tests/primary/apps/sonarr/
git commit -m "feat: add title/air-date join logic for TMDB episode groups"
```

---

### Task 5: Database table and persistence methods

**Files:**
- Modify: `src/primary/utils/database.py`
- Create: `tests/primary/utils/test_database_episode_group_mappings.py`

**Interfaces:**
- Consumes: `tmp_sniparr_db` fixture (Task 1)
- Produces on `SniparrDatabase`:
  - `save_episode_group_mapping(series_id: int, tmdb_id: int, scheme_name: str, is_primary: bool, match_rate: float, mapping: Dict[str, int]) -> int` (returns row id)
  - `get_episode_group_mappings_for_series(series_id: int) -> List[Dict[str, Any]]`
  - `get_merged_mapping_table(series_id: int) -> Dict[str, int]` — flat `"{scheme_name}|{season}|{episode}" -> sonarr_episode_id` across every stored scheme for that series

- [ ] **Step 1: Write the failing tests**

```python
# tests/primary/utils/test_database_episode_group_mappings.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/primary/utils/test_database_episode_group_mappings.py -v`
Expected: FAIL — `save_episode_group_mapping` not defined on `SniparrDatabase`

- [ ] **Step 3: Add the table definition**

Find the end of the table-creation block in `src/primary/utils/database.py` (immediately after the `security_audit_log` table, before the ALTER TABLE migration blocks — search for `CREATE TABLE IF NOT EXISTS security_audit_log` around line 999 and insert after its closing `''')`):

```python
            conn.execute('''
                CREATE TABLE IF NOT EXISTS episode_group_mappings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    series_id INTEGER NOT NULL,
                    tmdb_id INTEGER NOT NULL,
                    scheme_name TEXT NOT NULL,
                    is_primary BOOLEAN DEFAULT FALSE,
                    match_rate REAL NOT NULL,
                    mapping_json TEXT NOT NULL,
                    built_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(series_id, scheme_name)
                )
            ''')
```

- [ ] **Step 4: Add the three methods to the `SniparrDatabase` class**

Add these methods near `add_hunt_history_entry` (same class, same file) — same `get_connection()`/`commit()` pattern:

```python
    def save_episode_group_mapping(self, series_id: int, tmdb_id: int, scheme_name: str,
                                     is_primary: bool, match_rate: float, mapping: Dict[str, int]) -> int:
        """Save (or replace, if the same series_id+scheme_name already exists) one
        TMDB episode-group's resolved mapping for a series."""
        import json
        with self.get_connection() as conn:
            cursor = conn.execute('''
                INSERT INTO episode_group_mappings
                (series_id, tmdb_id, scheme_name, is_primary, match_rate, mapping_json)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(series_id, scheme_name) DO UPDATE SET
                    tmdb_id = excluded.tmdb_id,
                    is_primary = excluded.is_primary,
                    match_rate = excluded.match_rate,
                    mapping_json = excluded.mapping_json,
                    built_at = CURRENT_TIMESTAMP
            ''', (series_id, tmdb_id, scheme_name, is_primary, match_rate, json.dumps(mapping)))
            conn.commit()
            row = conn.execute(
                'SELECT id FROM episode_group_mappings WHERE series_id = ? AND scheme_name = ?',
                (series_id, scheme_name)
            ).fetchone()
            return row[0]

    def get_episode_group_mappings_for_series(self, series_id: int) -> List[Dict[str, Any]]:
        """Return every stored TMDB scheme mapping for a series."""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                'SELECT * FROM episode_group_mappings WHERE series_id = ?',
                (series_id,)
            ).fetchall()
            return [dict(row) for row in rows]

    def get_merged_mapping_table(self, series_id: int) -> Dict[str, int]:
        """Flatten every stored scheme for a series into one lookup table keyed
        '{scheme_name}|{season}|{episode}' -> sonarr_episode_id."""
        import json
        merged = {}
        for row in self.get_episode_group_mappings_for_series(series_id):
            scheme = row["scheme_name"]
            mapping = json.loads(row["mapping_json"])
            for season_episode_key, sonarr_episode_id in mapping.items():
                merged[f"{scheme}|{season_episode_key}"] = sonarr_episode_id
        return merged
```

Check the top of `database.py` for existing `import sqlite3`, `import json`, `from typing import ...` — add any missing imports at module level instead of inline if the file already imports them elsewhere (inline imports above are a safe fallback if not).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/primary/utils/test_database_episode_group_mappings.py -v`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/primary/utils/database.py tests/primary/utils/test_database_episode_group_mappings.py
git commit -m "feat: add episode_group_mappings table and persistence methods"
```

---

### Task 6: Sonarr API — write scene numbers and enable scene numbering

**Files:**
- Modify: `src/primary/apps/sonarr/api.py`
- Create: `tests/primary/apps/sonarr/test_api_scene_numbering.py`

**Interfaces:**
- Consumes: `arr_request()` (existing, same file), `get_episode()` (existing, same file)
- Produces: `update_episode_scene_numbers(api_url: str, api_key: str, api_timeout: int, episode_id: int, scene_season: int, scene_episode: int) -> bool`
- Produces: `enable_scene_numbering(api_url: str, api_key: str, api_timeout: int, series_id: int) -> bool`

- [ ] **Step 1: Write the failing tests**

```python
# tests/primary/apps/sonarr/test_api_scene_numbering.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/primary/apps/sonarr/test_api_scene_numbering.py -v`
Expected: FAIL — functions not defined

- [ ] **Step 3: Write minimal implementation**

Append to `src/primary/apps/sonarr/api.py` (follows the exact GET-modify-PUT pattern already used by `add_tag_to_series`, same file):

```python
def update_episode_scene_numbers(api_url: str, api_key: str, api_timeout: int,
                                   episode_id: int, scene_season: int, scene_episode: int) -> bool:
    """Set sceneSeasonNumber/sceneEpisodeNumber on one Sonarr episode."""
    episode_data = arr_request(api_url, api_key, api_timeout, f"episode/{episode_id}", count_api=False)
    if not episode_data:
        sonarr_logger.error(f"Failed to get episode data for ID: {episode_id}")
        return False

    episode_data["sceneSeasonNumber"] = scene_season
    episode_data["sceneEpisodeNumber"] = scene_episode

    response = arr_request(api_url, api_key, api_timeout, f"episode/{episode_id}",
                            method="PUT", data=episode_data, count_api=False)
    if response:
        sonarr_logger.debug(f"Set scene numbering {scene_season}x{scene_episode} on episode {episode_id}")
        return True
    sonarr_logger.error(f"Failed to update episode {episode_id} with scene numbering")
    return False


def enable_scene_numbering(api_url: str, api_key: str, api_timeout: int, series_id: int) -> bool:
    """Set useSceneNumbering=True on a series."""
    series_data = arr_request(api_url, api_key, api_timeout, f"series/{series_id}", count_api=False)
    if not series_data:
        sonarr_logger.error(f"Failed to get series data for ID: {series_id}")
        return False

    series_data["useSceneNumbering"] = True

    response = arr_request(api_url, api_key, api_timeout, f"series/{series_id}",
                            method="PUT", data=series_data, count_api=False)
    if response:
        sonarr_logger.debug(f"Enabled scene numbering on series {series_id}")
        return True
    sonarr_logger.error(f"Failed to enable scene numbering on series {series_id}")
    return False
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/primary/apps/sonarr/test_api_scene_numbering.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/primary/apps/sonarr/api.py tests/primary/apps/sonarr/test_api_scene_numbering.py
git commit -m "feat: add Sonarr scene-numbering write functions"
```

---

### Task 7: Orchestration — discover, merge, and write scene numbers

**Files:**
- Modify: `src/primary/apps/sonarr/episode_group_bridge.py`
- Modify: `tests/primary/apps/sonarr/test_episode_group_bridge.py`

**Interfaces:**
- Consumes: `find_tmdb_id_by_tvdb_id`, `get_episode_groups_for_show`, `get_episode_group_detail` (Task 2/3); `join_group_episodes_to_sonarr`, `MIN_GROUP_MATCH_RATE` (Task 4, same file); `get_series_by_id`, `get_episode`, `update_episode_scene_numbers`, `enable_scene_numbering` (existing + Task 6, `src.primary.apps.sonarr.api`); `save_episode_group_mapping` (Task 5, via `get_manager_database()`)
- Produces: `bridge_series(api_url: str, api_key: str, api_timeout: int, series_id: int, tvdb_id: int, sonarr_episodes: List[Dict]) -> Dict[str, Any]` — returns a summary dict `{"tmdb_id": int|None, "schemes_kept": [str], "primary_scheme": str|None, "episodes_updated": int, "error": str|None}`

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/primary/apps/sonarr/test_episode_group_bridge.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/primary/apps/sonarr/test_episode_group_bridge.py -v`
Expected: FAIL — `bridge_series` not defined

- [ ] **Step 3: Write minimal implementation**

Append to `src/primary/apps/sonarr/episode_group_bridge.py` (add the new imports at the top of the file alongside the existing ones):

```python
from src.primary.utils.tmdb_client import (
    find_tmdb_id_by_tvdb_id,
    get_episode_groups_for_show,
    get_episode_group_detail,
    TmdbApiKeyNotConfigured,
)
from src.primary.apps.sonarr.api import update_episode_scene_numbers, enable_scene_numbering
from src.primary.utils.database import get_manager_database


def bridge_series(api_url: str, api_key: str, api_timeout: int, series_id: int,
                   tvdb_id: int, sonarr_episodes: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Discover TMDB episode groups for a series, keep every group matching
    >= MIN_GROUP_MATCH_RATE, merge them into the DB, write the best-matching
    scheme's numbers into Sonarr as scene numbering, and enable scene numbering
    on the series.

    Returns a summary dict; never raises — all failures are captured in
    result["error"] so callers (the route, the periodic refresh job) can log
    and move on without crashing a batch of other shows. This includes a
    missing TMDB key: every TMDB call in this module goes through
    require_user_tmdb_api_key() (no shared fallback key for this feature —
    see Task 2), so an unconfigured key surfaces here as a clean error
    rather than silently calling TMDB under a shared key.
    """
    try:
        tmdb_id = find_tmdb_id_by_tvdb_id(tvdb_id)
    except TmdbApiKeyNotConfigured as e:
        logger.info(f"Bridge skipped for series {series_id}: {e}")
        return {"tmdb_id": None, "schemes_kept": [], "primary_scheme": None,
                "episodes_updated": 0,
                "error": "No TMDB API key configured. Set your own key in Settings > General."}

    if tmdb_id is None:
        logger.info(f"No TMDB show found for series {series_id} (tvdbId {tvdb_id}) — skipping bridge")
        return {"tmdb_id": None, "schemes_kept": [], "primary_scheme": None,
                "episodes_updated": 0, "error": "No matching TMDB show found"}

    groups = get_episode_groups_for_show(tmdb_id)
    if not groups:
        logger.info(f"No TMDB episode groups found for show {tmdb_id} (series {series_id})")
        return {"tmdb_id": tmdb_id, "schemes_kept": [], "primary_scheme": None,
                "episodes_updated": 0, "error": "No episode groups available"}

    kept_schemes = []  # list of (scheme_name, match_rate, matched_entries)
    for group_summary in groups:
        group_id = group_summary.get("id")
        group_name = group_summary.get("name")
        detail = get_episode_group_detail(group_id)
        if not detail:
            continue
        join_result = join_group_episodes_to_sonarr(detail, sonarr_episodes)
        if join_result["match_rate"] >= MIN_GROUP_MATCH_RATE:
            kept_schemes.append((group_name, join_result["match_rate"], join_result["matched"]))
        else:
            logger.debug(f"Discarding TMDB group '{group_name}' for series {series_id}: "
                         f"{join_result['match_rate']:.1f}% match rate (below {MIN_GROUP_MATCH_RATE}%)")

    if not kept_schemes:
        logger.info(f"No TMDB episode groups cleared the match threshold for series {series_id}")
        return {"tmdb_id": tmdb_id, "schemes_kept": [], "primary_scheme": None,
                "episodes_updated": 0, "error": "No episode group matched well enough"}

    db = get_manager_database()
    for scheme_name, match_rate, matched_entries in kept_schemes:
        mapping = {
            f"{entry['tmdb_season']}|{entry['tmdb_episode']}": entry["sonarr_episode_id"]
            for entry in matched_entries
        }
        db.save_episode_group_mapping(
            series_id=series_id, tmdb_id=tmdb_id, scheme_name=scheme_name,
            is_primary=False, match_rate=match_rate, mapping=mapping,
        )

    # Primary = highest match rate among kept schemes
    primary_scheme, primary_match_rate, primary_entries = max(kept_schemes, key=lambda s: s[1])
    db.save_episode_group_mapping(
        series_id=series_id, tmdb_id=tmdb_id, scheme_name=primary_scheme,
        is_primary=True, match_rate=primary_match_rate,
        mapping={f"{e['tmdb_season']}|{e['tmdb_episode']}": e["sonarr_episode_id"] for e in primary_entries},
    )

    updated_count = 0
    for entry in primary_entries:
        success = update_episode_scene_numbers(
            api_url, api_key, api_timeout, entry["sonarr_episode_id"],
            entry["tmdb_season"], entry["tmdb_episode"],
        )
        if success:
            updated_count += 1

    enable_scene_numbering(api_url, api_key, api_timeout, series_id)

    return {
        "tmdb_id": tmdb_id,
        "schemes_kept": [s[0] for s in kept_schemes],
        "primary_scheme": primary_scheme,
        "episodes_updated": updated_count,
        "error": None,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/primary/apps/sonarr/test_episode_group_bridge.py -v`
Expected: PASS (9 tests total)

- [ ] **Step 5: Verify `get_manager_database` import path is correct**

Run: `grep -n "^def get_manager_database" src/primary/utils/database.py`
Confirm the import in episode_group_bridge.py (`from src.primary.utils.database import get_manager_database`) matches this location exactly.

- [ ] **Step 6: Commit**

```bash
git add src/primary/apps/sonarr/episode_group_bridge.py tests/primary/apps/sonarr/test_episode_group_bridge.py
git commit -m "feat: add bridge_series orchestration (discover, merge, write scene numbers)"
```

---

### Task 8: Route — trigger the bridge from the UI

**Files:**
- Modify: `src/primary/apps/sonarr_routes.py`
- Create: `tests/primary/apps/test_sonarr_routes_bridge.py`

**Interfaces:**
- Consumes: `bridge_series()` (Task 7), existing instance-config lookup pattern already used by the neighboring `/api/sonarr/missing` route in this same file
- Produces: `POST /api/sonarr/bridge-episode-groups` — body `{"instance_id": str, "series_id": int, "tvdb_id": int}`, returns the `bridge_series()` summary dict as JSON

- [ ] **Step 1: Read the existing `/api/sonarr/missing` route for the real instance-lookup pattern**

Run: `sed -n '31,56p' src/primary/apps/sonarr_routes.py`

Copy its exact pattern for pulling `api_url`/`api_key`/`api_timeout` out of the configured instance (likely via `load_settings("sonarr")` or similar — read the real code before writing Step 3, and use the same approach rather than guessing).

- [ ] **Step 2: Write the failing test**

```python
# tests/primary/apps/test_sonarr_routes_bridge.py
from unittest.mock import patch
from src.primary.web_server import create_app


def _client():
    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


@patch("src.primary.apps.sonarr_routes.bridge_series")
def test_bridge_episode_groups_route(mock_bridge, monkeypatch):
    mock_bridge.return_value = {
        "tmdb_id": 387, "schemes_kept": ["Paramount+"], "primary_scheme": "Paramount+",
        "episodes_updated": 71, "error": None,
    }
    # If the route requires auth/session in this app, check web_server.py's
    # TESTING-mode auth bypass (if one exists) before writing this test —
    # adjust login/session setup here to match however other route tests
    # in this app handle that, once a precedent exists.

    client = _client()
    response = client.post("/api/sonarr/bridge-episode-groups", json={
        "instance_id": "sonarr-26052302516ly", "series_id": 2145, "tvdb_id": 121361,
    })

    assert response.status_code == 200
    assert response.json["primary_scheme"] == "Paramount+"
```

**Note for the implementer:** this app has no existing route tests to copy an auth pattern from (this is the first one). Check `src/primary/auth.py` and `src/primary/web_server.py`'s `create_app()` for a `TESTING` config flag or local-bypass behavior before assuming the client needs a logged-in session. If one doesn't exist, the simplest fix is a `@patch("src.primary.auth.require_login", lambda f: f)`-style decorator bypass — find the actual decorator name used on neighboring routes first.

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/primary/apps/test_sonarr_routes_bridge.py -v`
Expected: FAIL — route doesn't exist (404) or auth blocks it (401/403); resolve whichever happens per the note above before moving on

- [ ] **Step 4: Write the route**

Add to `src/primary/apps/sonarr_routes.py`, following the exact decorator/instance-lookup pattern copied from Step 1 (the snippet below assumes that pattern exposes a function to resolve one instance's config by `instance_id` — adjust the two marked lines to match the real helper name found in Step 1):

```python
from src.primary.apps.sonarr.episode_group_bridge import bridge_series
from src.primary.apps.sonarr import api as sonarr_api


@sonarr_bp.route('/api/sonarr/bridge-episode-groups', methods=['POST'])
def bridge_episode_groups():
    data = request.get_json() or {}
    instance_id = data.get("instance_id")
    series_id = data.get("series_id")
    tvdb_id = data.get("tvdb_id")

    if not all([instance_id, series_id, tvdb_id]):
        return jsonify({"error": "instance_id, series_id, and tvdb_id are required"}), 400

    # --- replace with the real per-instance config lookup found in Step 1 ---
    instance = get_sonarr_instance_config(instance_id)  # placeholder name — fix per Step 1
    if not instance:
        return jsonify({"error": f"Unknown Sonarr instance: {instance_id}"}), 404
    api_url = instance["api_url"]
    api_key = instance["api_key"]
    api_timeout = instance.get("api_timeout", 120)
    # --- end replacement block ---

    sonarr_episodes = sonarr_api.arr_request(api_url, api_key, api_timeout, f"episode?seriesId={series_id}", count_api=False)
    if not sonarr_episodes:
        return jsonify({"error": "Could not fetch episodes from Sonarr"}), 502

    result = bridge_series(api_url, api_key, api_timeout, series_id, tvdb_id, sonarr_episodes)
    return jsonify(result), 200
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/primary/apps/test_sonarr_routes_bridge.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/primary/apps/sonarr_routes.py tests/primary/apps/test_sonarr_routes_bridge.py
git commit -m "feat: add route to trigger episode-group bridge for a series"
```

---

### Task 9: Stuck-import resolver — forced ManualImport fallback

**Files:**
- Create: `src/primary/apps/sonarr/stuck_import_resolver.py`
- Create: `tests/primary/apps/sonarr/test_stuck_import_resolver.py`

**Interfaces:**
- Consumes: `get_queue()` (existing, `src.primary.apps.sonarr.api`); `get_merged_mapping_table()` (Task 5, via `get_manager_database()`); `arr_request()` (existing, for the `ManualImport` command POST)
- Produces: `extract_season_episode_from_release_title(title: str) -> Optional[Tuple[int, int]]`
- Produces: `resolve_stuck_queue_items(api_url: str, api_key: str, api_timeout: int, series_id: int) -> Dict[str, Any]` — returns `{"resolved": int, "unresolved": int}`

- [ ] **Step 1: Write the failing tests**

```python
# tests/primary/apps/sonarr/test_stuck_import_resolver.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/primary/apps/sonarr/test_stuck_import_resolver.py -v`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write minimal implementation**

```python
# src/primary/apps/sonarr/stuck_import_resolver.py
"""
Fallback for stuck Sonarr import-queue items that scene numbering alone
didn't fix (e.g. multi-episode pack files whose internal structure doesn't
trigger Sonarr's own multi-episode detection). Checks the merged TMDB
episode-group mapping table (all kept schemes, not just the primary one)
for a season/episode match, then forces the import via Sonarr's
ManualImport command — same technique validated by hand against the
Muppet Babies pack during the design session.

See docs/superpowers/specs/2026-10-17-tmdb-episode-group-bridge-design.md
"""
import re
from typing import Optional, Tuple, Dict, Any

from src.primary.utils.logger import get_logger
from src.primary.utils.database import get_manager_database
from src.primary.apps.sonarr.api import get_queue, arr_request

logger = get_logger("sonarr")

STUCK_STATES = {"importBlocked", "importPending"}

_SEASON_EPISODE_PATTERN = re.compile(r"[Ss](\d{1,2})[Ee](\d{1,3})")


def extract_season_episode_from_release_title(title: str) -> Optional[Tuple[int, int]]:
    """Parse the first SxxExx-style season/episode out of a release title.
    Returns None if no such pattern is found."""
    if not title:
        return None
    match = _SEASON_EPISODE_PATTERN.search(title)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def resolve_stuck_queue_items(api_url: str, api_key: str, api_timeout: int, series_id: int) -> Dict[str, Any]:
    """Scan Sonarr's queue for stuck import items belonging to this series,
    try to resolve each one via the merged TMDB mapping table, and force
    a ManualImport for any that resolve. Never guesses — items with no
    mapping-table match are left alone and counted as unresolved."""
    queue_items = get_queue(api_url, api_key, api_timeout)
    stuck_items = [
        item for item in queue_items
        if item.get("seriesId") == series_id
        and item.get("trackedDownloadState") in STUCK_STATES
    ]

    if not stuck_items:
        return {"resolved": 0, "unresolved": 0}

    merged_table = get_manager_database().get_merged_mapping_table(series_id)

    resolved = 0
    unresolved = 0

    for item in stuck_items:
        season_episode = extract_season_episode_from_release_title(item.get("title", ""))
        if season_episode is None:
            unresolved += 1
            continue

        season, episode = season_episode
        sonarr_episode_id = None
        for scheme_season_episode_key, candidate_id in merged_table.items():
            # key format: "{scheme_name}|{season}|{episode}"
            parts = scheme_season_episode_key.split("|")
            if len(parts) == 3 and int(parts[1]) == season and int(parts[2]) == episode:
                sonarr_episode_id = candidate_id
                break

        if sonarr_episode_id is None:
            logger.info(f"No mapping found for stuck item '{item.get('title')}' "
                        f"(parsed S{season}E{episode}) in series {series_id}")
            unresolved += 1
            continue

        command_response = arr_request(
            api_url, api_key, api_timeout, "command", method="POST", data={
                "name": "ManualImport",
                "importMode": "move",
                "files": [{
                    "path": item.get("outputPath", ""),
                    "seriesId": series_id,
                    "episodeIds": [sonarr_episode_id],
                }],
            },
            count_api=False,
        )

        if command_response:
            logger.info(f"Forced ManualImport for stuck item '{item.get('title')}' -> episode {sonarr_episode_id}")
            resolved += 1
        else:
            unresolved += 1

    return {"resolved": resolved, "unresolved": unresolved}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/primary/apps/sonarr/test_stuck_import_resolver.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/primary/apps/sonarr/stuck_import_resolver.py tests/primary/apps/sonarr/test_stuck_import_resolver.py
git commit -m "feat: add stuck-import resolver with forced ManualImport fallback"
```

---

### Task 10: Wire the resolver into the season-pack missing cycle

**Files:**
- Modify: `src/primary/apps/sonarr/missing.py`
- Create: `tests/primary/apps/sonarr/test_missing_stuck_import_hook.py`

**Interfaces:**
- Consumes: `resolve_stuck_queue_items()` (Task 9)

This is the only integration point into the existing background cycle. It's added inside `missing.py` itself (Sonarr-specific file) rather than the generic multi-app `background.py` dispatch loop, so the blast radius of this change is contained to Sonarr and cannot affect Radarr/Lidarr/etc. processing.

- [ ] **Step 1: Read `process_missing_seasons_packs_mode` to find the right insertion point**

Run: `grep -n "def process_missing_seasons_packs_mode" -A 5 src/primary/apps/sonarr/missing.py`

Find where the function returns after a successful season-pack search trigger (the end of its normal happy-path, after any search commands have been issued for the cycle) — that's where the stuck-import check belongs, so it runs once per cycle after Sonarr has had a chance to grab something.

- [ ] **Step 2: Write the failing test**

```python
# tests/primary/apps/sonarr/test_missing_stuck_import_hook.py
from unittest.mock import patch
from src.primary.apps.sonarr.missing import process_missing_seasons_packs_mode


@patch("src.primary.apps.sonarr.missing.resolve_stuck_queue_items")
@patch("src.primary.apps.sonarr.missing.sonarr_api.get_series", return_value=[])
def test_missing_seasons_packs_mode_calls_stuck_import_resolver(mock_get_series, mock_resolve):
    mock_resolve.return_value = {"resolved": 0, "unresolved": 0}

    process_missing_seasons_packs_mode(
        "http://sonarr:8989", "key", "Default", 30, True, True, 1, 0,
        1, 600, lambda: False, False, False, False, {}, exempt_tags=[],
        hunt_missing_mode="seasons_packs", instance_display_name="Default",
    )

    mock_resolve.assert_called()
```

**Note for the implementer:** `process_missing_seasons_packs_mode`'s exact positional signature must be read from the real function definition before writing this test — copy its actual parameter list rather than guessing (the call above is illustrative; `grep -n "def process_missing_seasons_packs_mode" -A 15 src/primary/apps/sonarr/missing.py` gives the real one). Adjust the test's call arguments to match exactly.

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/primary/apps/sonarr/test_missing_stuck_import_hook.py -v`
Expected: FAIL — `resolve_stuck_queue_items` not called (the hook doesn't exist yet)

- [ ] **Step 4: Add the import and the call**

Add near the top of `src/primary/apps/sonarr/missing.py`, alongside the existing `from src.primary.apps.sonarr import api as sonarr_api` import:

```python
from src.primary.apps.sonarr.stuck_import_resolver import resolve_stuck_queue_items
```

Inside `process_missing_seasons_packs_mode`, at the insertion point found in Step 1 (end of the function, just before its final `return`), find the series_id being processed in that cycle and add:

```python
    try:
        stuck_result = resolve_stuck_queue_items(api_url, api_key, api_timeout, series_id)
        if stuck_result["resolved"] > 0:
            sonarr_logger.info(f"Resolved {stuck_result['resolved']} stuck import(s) via TMDB episode-group mapping for series {series_id}")
    except Exception as e:
        sonarr_logger.error(f"Stuck-import resolution failed for series {series_id}: {e}")
```

**Note for the implementer:** the exact variable name holding the current series' ID inside this function must be read from the real function body (Step 1) — it may be named `series_id`, `series.get("id")`, or something else depending on how the existing loop is structured. Use the real variable name found there, not a guess.

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/primary/apps/sonarr/test_missing_stuck_import_hook.py -v`
Expected: PASS

- [ ] **Step 6: Run the full test suite**

Run: `pytest -v`
Expected: PASS (all tests from every task)

- [ ] **Step 7: Commit**

```bash
git add src/primary/apps/sonarr/missing.py tests/primary/apps/sonarr/test_missing_stuck_import_hook.py
git commit -m "feat: wire stuck-import resolver into season-pack missing cycle"
```

---

## Post-implementation manual verification (not automated — real-world check)

After all 10 tasks are merged, manually verify against the live SpongeBob series (2145) on the real `binhex-sonarr` instance, per the spec's testing plan:

1. `POST /api/sonarr/bridge-episode-groups` with `{"instance_id": "sonarr-26052302516ly", "series_id": 2145, "tvdb_id": 121361}` — confirm the response lists `Paramount+` (or whichever scheme wins) as `primary_scheme` and a nonzero `episodes_updated`
2. Check Sonarr's UI directly: series → Edit → confirm "Use Scene Numbering" is now on, and spot-check one episode (e.g. the real Season 10/Episode 59 "Krusty Katering") for a populated scene number
3. Manually re-trigger a search for a currently-missing episode and confirm Sonarr's search log shows it querying with the scene number, not just the TVDB number
4. If a stuck-import case is available, confirm `resolve_stuck_queue_items` actually force-imports it via the Sonarr queue UI
