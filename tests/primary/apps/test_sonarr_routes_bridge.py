"""Route test for POST /api/sonarr/bridge-episode-groups.

This is the first Flask route test in this app. Two things had to be
investigated for real rather than assumed (see task-8-report.md for details):

1. Instance-config lookup pattern. The neighboring `/api/sonarr/missing` route
   does NOT do an instance_id-based lookup — it calls `get_app_url_and_key("sonarr")`
   (single-instance, no api_timeout) and even calls a `missing.run_missing_search()`
   that doesn't exist anywhere in the codebase, so it's dead/legacy code, not a
   real precedent to copy. The real, currently-used pattern for resolving a
   Sonarr instance's api_url/api_key/api_timeout by instance_id is
   `get_configured_instances()` in src/primary/apps/sonarr/__init__.py, which is
   exactly what src/primary/stateful_routes.py's `_resolve_instance_id()` helper
   uses elsewhere in the app for the same kind of per-instance lookup.

2. Auth bypass. There is no TESTING-mode flag anywhere in src/primary/auth.py or
   src/primary/web_server.py (no create_app() factory exists either - the Flask
   `app` is a module-level singleton). Auth is wired as a global
   `app.before_request(authenticate_request)` hook (web_server.py), not a
   per-route decorator, so there is nothing named like
   `require_login`/`login_required` to @patch on individual routes. Because
   Flask's before_request_funcs stores a direct reference to the function object
   captured at blueprint-registration time, patching the name
   `src.primary.auth.authenticate_request` after web_server has been imported
   has no effect on the already-registered hook. Instead we remove that specific
   hook function from `app.before_request_funcs[None]` for the duration of this
   test and restore it afterward. This only skips the global auth gate (which
   this task is not testing); it does not skip any decorator on the route itself,
   because no such decorator exists in this codebase.
"""
import os
import sys
import tempfile

# web_server.py imports via bare `primary.*` in places (e.g. `from primary.utils.logger
# import ...`), matching how main.py adds `src/` to sys.path at process startup. pytest's
# `pythonpath = .` (repo root) alone is not enough, so replicate that here.
_SRC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "src"))
if _SRC_DIR not in sys.path:
    sys.path.insert(0, _SRC_DIR)

# Importing web_server creates a real SniparrDatabase file, scheduled-backup thread, etc.
# as side effects of module import. Point SNIPARR_CONFIG_DIR at a throwaway temp dir so
# none of that touches the real app config.
os.environ.setdefault("SNIPARR_CONFIG_DIR", tempfile.mkdtemp(prefix="sniparr_test_config_"))

from unittest.mock import patch

from src.primary.auth import authenticate_request
from src.primary.web_server import app


def _client():
    app.config["TESTING"] = True
    # web_server.py's configure_base_url() sets APPLICATION_ROOT to None when no base
    # URL is configured, which breaks Flask/Werkzeug's test-client URL builder
    # (EnvironBuilder expects a string). Normalize it for the test client only.
    if app.config.get("APPLICATION_ROOT") is None:
        app.config["APPLICATION_ROOT"] = "/"
    return app.test_client()


@patch("src.primary.apps.sonarr_routes.sonarr_api.arr_request")
@patch("src.primary.apps.sonarr_routes.get_configured_instances")
@patch("src.primary.apps.sonarr_routes.bridge_series")
def test_bridge_episode_groups_route(mock_bridge, mock_get_instances, mock_arr_request):
    mock_get_instances.return_value = [
        {
            "instance_id": "sonarr-26052302516ly",
            "api_url": "http://localhost:8989",
            "api_key": "testkey",
            "api_timeout": 120,
        }
    ]
    mock_arr_request.return_value = [{"id": 1, "seasonNumber": 1, "episodeNumber": 1}]
    mock_bridge.return_value = {
        "tmdb_id": 387,
        "schemes_kept": ["Paramount+"],
        "primary_scheme": "Paramount+",
        "episodes_updated": 71,
        "error": None,
    }

    client = _client()

    # No TESTING-mode auth bypass exists in this app (see module docstring) --
    # remove the specific authenticate_request hook for this request only.
    original_hooks = list(app.before_request_funcs.get(None, []))
    app.before_request_funcs[None] = [f for f in original_hooks if f is not authenticate_request]
    try:
        response = client.post(
            "/api/sonarr/bridge-episode-groups",
            json={"instance_id": "sonarr-26052302516ly", "series_id": 2145, "tvdb_id": 121361},
        )
    finally:
        app.before_request_funcs[None] = original_hooks

    assert response.status_code == 200
    assert response.json["primary_scheme"] == "Paramount+"
    mock_bridge.assert_called_once_with(
        "http://localhost:8989", "testkey", 120, 2145, 121361, mock_arr_request.return_value,
        "sonarr-26052302516ly",
    )


def test_bridge_episode_groups_route_requires_auth():
    """Confirms the real production auth hook is wired for this route - i.e. that our
    test above is bypassing a hook that genuinely exists and genuinely blocks requests,
    not bypassing nothing."""
    client = _client()
    response = client.post(
        "/api/sonarr/bridge-episode-groups",
        json={"instance_id": "sonarr-26052302516ly", "series_id": 2145, "tvdb_id": 121361},
    )
    assert response.status_code in (401, 403, 503)


def test_bridge_episode_groups_route_unknown_instance():
    mock_get_instances_patch = patch(
        "src.primary.apps.sonarr_routes.get_configured_instances", return_value=[]
    )
    client = _client()
    original_hooks = list(app.before_request_funcs.get(None, []))
    app.before_request_funcs[None] = [f for f in original_hooks if f is not authenticate_request]
    try:
        with mock_get_instances_patch:
            response = client.post(
                "/api/sonarr/bridge-episode-groups",
                json={"instance_id": "does-not-exist", "series_id": 2145, "tvdb_id": 121361},
            )
    finally:
        app.before_request_funcs[None] = original_hooks

    assert response.status_code == 404
