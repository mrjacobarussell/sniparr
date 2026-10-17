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
