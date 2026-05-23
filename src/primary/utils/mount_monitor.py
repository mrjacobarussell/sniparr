"""
Mount Monitor & Import Retry Queue

When imports fail because a mount point (NFS/SMB from a remote seedbox)
isn't available yet, this module queues them for automatic retry once the
path becomes accessible.
"""

import os
import time
import json
import threading
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

_RETRY_INTERVAL_SEC = 60
_MAX_RETRIES = 120  # ~2 hours of retrying at 60s intervals
_MAX_PENDING = 200

_retry_thread_started = False
_retry_lock = threading.Lock()


def _log():
    from src.primary.utils.logger import get_logger
    return get_logger('system')


def is_path_available(path: str) -> bool:
    """Check whether a filesystem path is currently accessible."""
    if not path:
        return False
    try:
        return os.path.exists(path)
    except OSError:
        return False


def queue_pending_import(import_type: str, params: Dict[str, Any], reason: str = '') -> bool:
    """
    Queue a failed import for retry.

    Args:
        import_type: 'movie' or 'tv'
        params: All arguments needed to re-call the import function
        reason: Why it failed (for logging)
    """
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config('pending_imports') or {}
        queue = config.get('queue', [])

        # Deduplicate by download_path
        dl_path = params.get('download_path', '')
        if any(item.get('params', {}).get('download_path') == dl_path for item in queue):
            _log().debug("Import retry: already queued: %s", dl_path)
            return False

        if len(queue) >= _MAX_PENDING:
            oldest = queue.pop(0)
            _log().warning("Import retry: queue full, dropping oldest: %s",
                           oldest.get('params', {}).get('download_path', '?'))

        entry = {
            'import_type': import_type,
            'params': params,
            'reason': reason,
            'retries': 0,
            'queued_at': datetime.now(timezone.utc).isoformat(),
        }
        queue.append(entry)
        config['queue'] = queue
        db.save_app_config('pending_imports', config)

        _log().info("Import retry: queued %s import for '%s' — %s",
                     import_type, params.get('title', '?'), reason)
        _ensure_retry_thread()
        return True
    except Exception as e:
        _log().error("Import retry: failed to queue: %s", e)
        return False


def get_pending_imports() -> List[Dict]:
    """Return the current pending import queue."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config('pending_imports') or {}
        return config.get('queue', [])
    except Exception:
        return []


def clear_pending_imports() -> int:
    """Clear all pending imports. Returns count cleared."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config('pending_imports') or {}
        count = len(config.get('queue', []))
        config['queue'] = []
        db.save_app_config('pending_imports', config)
        return count
    except Exception:
        return 0


def _retry_pending_imports():
    """Process the pending import queue, retrying any whose paths are now available."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config('pending_imports') or {}
        queue = config.get('queue', [])
        if not queue:
            return

        remaining = []
        for entry in queue:
            params = entry.get('params', {})
            import_type = entry.get('import_type', 'movie')
            retries = entry.get('retries', 0)
            title = params.get('title', params.get('series_title', '?'))

            if retries >= _MAX_RETRIES:
                _log().warning("Import retry: giving up on '%s' after %d retries", title, retries)
                continue

            # Check if the paths we need are available now
            paths_to_check = [p for p in [params.get('root_folder', ''), params.get('download_path', '')] if p]
            all_available = all(is_path_available(p) for p in paths_to_check)

            if not all_available:
                entry['retries'] = retries + 1
                remaining.append(entry)
                if retries % 10 == 0:
                    _log().debug("Import retry: paths still unavailable for '%s' (attempt %d)", title, retries + 1)
                continue

            # Paths available — attempt import
            _log().info("Import retry: paths available, retrying %s import for '%s'", import_type, title)
            success = _execute_import(import_type, params)
            if success:
                _log().info("Import retry: successfully imported '%s'", title)
            else:
                entry['retries'] = retries + 1
                remaining.append(entry)
                _log().warning("Import retry: import still failed for '%s' (attempt %d)", title, retries + 1)

        config['queue'] = remaining
        db.save_app_config('pending_imports', config)
    except Exception as e:
        _log().error("Import retry: error in retry loop: %s", e)


def _execute_import(import_type: str, params: Dict[str, Any]) -> bool:
    """Re-execute an import with the stored parameters."""
    try:
        if import_type == 'movie':
            from src.primary.apps.movie_snipe.importer import import_movie
            return import_movie(
                client=params.get('client', {}),
                title=params.get('title', ''),
                year=params.get('year', ''),
                download_path=params.get('download_path', ''),
                instance_id=params.get('instance_id'),
                release_name=params.get('release_name', ''),
            )
        elif import_type == 'tv':
            from src.primary.apps.tv_snipe.importer import import_episode
            return import_episode(
                client=params.get('client', {}),
                series_title=params.get('series_title', ''),
                year=params.get('year', ''),
                season=params.get('season', 0),
                episode=params.get('episode', 0),
                episode_title=params.get('episode_title', ''),
                download_path=params.get('download_path', ''),
                instance_id=params.get('instance_id'),
                release_name=params.get('release_name', ''),
                series_type=params.get('series_type', 'standard'),
            )
        else:
            _log().warning("Import retry: unknown import type: %s", import_type)
            return False
    except Exception as e:
        _log().error("Import retry: execution error for %s: %s", import_type, e)
        return False


def _ensure_retry_thread():
    """Start the background retry thread if not already running."""
    global _retry_thread_started
    if _retry_thread_started:
        return
    with _retry_lock:
        if _retry_thread_started:
            return
        _retry_thread_started = True

    def _run():
        while True:
            time.sleep(_RETRY_INTERVAL_SEC)
            try:
                _retry_pending_imports()
            except Exception:
                pass

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    _log().info("Import retry: background thread started (checking every %ds)", _RETRY_INTERVAL_SEC)


def start_mount_monitor():
    """Start the mount monitor on app boot. Starts retry thread if there are pending imports."""
    pending = get_pending_imports()
    if pending:
        _log().info("Import retry: %d pending import(s) from previous session, starting retry thread", len(pending))
        _ensure_retry_thread()
