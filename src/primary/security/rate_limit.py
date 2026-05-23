"""
Login rate limiter.

Tracks failed login attempts per client IP using an in-memory sliding window.
After MAX_ATTEMPTS failures within WINDOW_SECONDS the client is locked out
until the window rolls forward.

The counter resets on successful login and is wiped entirely on process restart
or factory reset — the goal is friction against credential stuffing, not
long-term bans.

X-Forwarded-For is honoured only when the direct connection comes from an IP
listed in the 'security' > 'trusted_proxies' setting, preventing header
spoofing from untrusted clients.
"""

import time
from flask import request as _request

_MAX_ATTEMPTS = 5
_WINDOW_SECONDS = 60

# { ip: [attempt_timestamp, ...] }
_buckets: dict[str, list[float]] = {}


def _real_ip() -> str:
    """Return the client IP, honouring X-Forwarded-For only from trusted proxies."""
    from src.primary import settings_manager

    direct = _request.remote_addr or "unknown"
    raw = settings_manager.get_setting("security", "trusted_proxies", "")
    trusted = {p.strip() for p in raw.split(",") if p.strip()} if raw else set()

    if direct in trusted:
        forwarded = _request.headers.get("X-Forwarded-For", "")
        if forwarded:
            return forwarded.split(",")[0].strip()

    return direct


def _prune(ip: str, now: float) -> list[float]:
    """Return only the attempts still within the rolling window."""
    return [t for t in _buckets.get(ip, []) if now - t < _WINDOW_SECONDS]


def is_allowed() -> bool:
    """Return True if the current client may attempt a login."""
    ip = _real_ip()
    now = time.time()
    attempts = _prune(ip, now)
    _buckets[ip] = attempts
    return len(attempts) < _MAX_ATTEMPTS


def record_failure() -> None:
    """Record a failed login attempt for the current client."""
    ip = _real_ip()
    now = time.time()
    attempts = _prune(ip, now)
    attempts.append(now)
    _buckets[ip] = attempts


def clear_for_client() -> None:
    """Clear attempts after a successful login."""
    _buckets.pop(_real_ip(), None)


def reset_all() -> None:
    """Wipe every bucket (factory reset path)."""
    _buckets.clear()


def attempts_remaining() -> int:
    """How many attempts the current client has left before lockout."""
    ip = _real_ip()
    used = len(_prune(ip, time.time()))
    return max(0, _MAX_ATTEMPTS - used)
