"""
Reverse-proxy / SSO authentication support.

When SNIPARR_AUTH_MODE=proxy, Sniparr trusts a reverse proxy (Authelia,
Authentik, oauth2-proxy, etc.) to handle authentication and inject the
authenticated username into a request header.

Security model
--------------
Reading an auth header from arbitrary clients would be trivially bypassable,
so this module only trusts the header when the direct TCP connection comes from
an IP listed in the 'security' > 'trusted_proxies' setting. Requests that do
not come from a trusted IP are rejected with 403, not redirected to login.

Configuration
-------------
SNIPARR_AUTH_MODE        Set to 'proxy' to enable this mode.
SNIPARR_AUTH_PROXY_HEADER  The header name your proxy injects (default: Remote-User).
security > trusted_proxies  Comma-separated list of proxy IPs allowed to supply the header.
"""

import os

from flask import Request

_AUTH_MODE_ENV = "SNIPARR_AUTH_MODE"
_PROXY_HEADER_ENV = "SNIPARR_AUTH_PROXY_HEADER"
_DEFAULT_PROXY_HEADER = "Remote-User"

# Paths that exist only for built-in login and have no meaning in proxy mode.
PROXY_IRRELEVANT_PATHS = frozenset({"/setup", "/login"})


def proxy_mode_enabled() -> bool:
    return os.environ.get(_AUTH_MODE_ENV, "").lower() == "proxy"


def _trusted_proxy_ips() -> set[str]:
    from src.primary import settings_manager
    raw = settings_manager.get_setting("security", "trusted_proxies", "")
    if not raw:
        return set()
    return {p.strip() for p in raw.split(",") if p.strip()}


def is_from_trusted_proxy(req: Request) -> bool:
    """Return True only when the direct connection IP is in the trusted set.

    An empty trusted set is treated as no proxies configured, so every request
    is untrusted — this prevents accidental open access if the setting is blank.
    """
    trusted = _trusted_proxy_ips()
    if not trusted:
        return False
    return (req.remote_addr or "unknown") in trusted


def get_proxy_username(req: Request) -> str | None:
    """Read the username header injected by the reverse proxy.

    Returns None if the header is absent or empty. Callers MUST verify the
    request came from a trusted proxy before calling this — this function does
    not re-check to keep the two responsibilities separate.
    """
    header = os.environ.get(_PROXY_HEADER_ENV, _DEFAULT_PROXY_HEADER)
    value = req.headers.get(header, "").strip()
    return value or None


def authenticate_proxy_request(req: Request) -> tuple[str | None, int | None]:
    """Validate a request under proxy auth mode.

    Returns (username, None) on success, or (None, http_status_code) on failure.
    Callers should abort with the returned status code when username is None.
    """
    if not is_from_trusted_proxy(req):
        return None, 403

    username = get_proxy_username(req)
    if username is None:
        return None, 401

    return username, None
