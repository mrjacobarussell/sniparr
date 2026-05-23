"""
Security audit log.

Events:
  login_success       successful authentication
  login_failure       wrong password or bad 2FA code
  login_rate_limited  blocked by IP rate limiter
  account_locked      account locked after consecutive failures
  account_unlocked    lockout cleared on successful login
  logout              explicit session logout
  password_changed    password updated
  settings_changed    app/general settings saved
  2fa_enabled         TOTP 2FA activated
  2fa_disabled        TOTP 2FA deactivated
"""

import time
from datetime import datetime, timezone

from src.primary.utils.logger import logger

LOGIN_SUCCESS      = "login_success"
LOGIN_FAILURE      = "login_failure"
LOGIN_RATE_LIMITED = "login_rate_limited"
ACCOUNT_LOCKED     = "account_locked"
ACCOUNT_UNLOCKED   = "account_unlocked"
LOGOUT             = "logout"
PASSWORD_CHANGED   = "password_changed"
SETTINGS_CHANGED   = "settings_changed"
TWO_FA_ENABLED     = "2fa_enabled"
TWO_FA_DISABLED    = "2fa_disabled"

RETENTION_DAYS = 90


def log(event: str, username: str | None = None, ip: str | None = None, detail: str = "") -> None:
    """Write a security event. Never raises — a log failure must not block auth."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        with db.get_connection() as conn:
            conn.execute(
                "INSERT INTO security_audit_log (event, username, ip_address, detail, ts) VALUES (?, ?, ?, ?, ?)",
                (event, username or "", ip or "", detail, int(time.time())),
            )
            conn.commit()
    except Exception as exc:
        logger.warning("Audit log write failed (%s): %s", event, exc)


def get_recent(limit: int = 500, event_filter: str | None = None) -> list[dict]:
    """Return the most recent entries, newest first. Adds a formatted ts_human field."""
    try:
        import sqlite3
        from src.primary.utils.database import get_database
        db = get_database()
        with db.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            if event_filter:
                rows = conn.execute(
                    "SELECT id, event, username, ip_address, detail, ts FROM security_audit_log "
                    "WHERE event = ? ORDER BY ts DESC LIMIT ?",
                    (event_filter, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, event, username, ip_address, detail, ts FROM security_audit_log "
                    "ORDER BY ts DESC LIMIT ?",
                    (limit,),
                ).fetchall()

        result = []
        for r in rows:
            entry = dict(r)
            try:
                entry["ts_human"] = datetime.fromtimestamp(entry["ts"], tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
            except Exception:
                entry["ts_human"] = str(entry["ts"])
            result.append(entry)
        return result
    except Exception as exc:
        logger.warning("Audit log read failed: %s", exc)
        return []


def purge_old() -> int:
    """Delete entries older than RETENTION_DAYS. Returns number of rows removed."""
    cutoff = int(time.time()) - (RETENTION_DAYS * 86400)
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        with db.get_connection() as conn:
            cur = conn.execute("DELETE FROM security_audit_log WHERE ts < ?", (cutoff,))
            conn.commit()
            return cur.rowcount
    except Exception as exc:
        logger.warning("Audit log purge failed: %s", exc)
        return 0
