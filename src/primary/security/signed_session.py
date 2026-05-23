"""
itsdangerous-backed session signing layer.

Sniparr's existing auth keeps a server-side active_sessions dict (which allows
instant revocation on logout or password change). This module wraps that
mechanism: the value stored in the browser cookie is an itsdangerous-signed
envelope around the random session ID, rather than the raw ID itself.

Why bother signing if the server validates the ID anyway?
- Signed cookies cannot be forged or enumerated even if an attacker observes
  the cookie — they would need the secret key to produce a valid signature.
- A CSRF token is embedded in the signed payload and paired with a readable
  CSRF cookie, enabling the double-submit CSRF protection in csrf.py.

The signing secret is stored in the 'security' settings group. It is generated
once on first use and never exposed in the UI or logs. Rotating it (after a
password change) invalidates every existing signed cookie, forcing re-login.
"""

import os
import secrets

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from src.primary.utils.logger import logger

COOKIE_NAME = "sniparr_session"
CSRF_COOKIE_NAME = "sniparr_csrf"
MAX_AGE = 86_400  # 24 hours

_serializer: URLSafeTimedSerializer | None = None


def _get_serializer() -> URLSafeTimedSerializer:
    global _serializer
    if _serializer is None:
        from src.primary import settings_manager
        secret = settings_manager.get_setting("security", "session_secret", None)
        if not secret:
            secret = os.urandom(32).hex()
            settings_manager.save_setting("security", "session_secret", secret)
        _serializer = URLSafeTimedSerializer(secret, salt="sniparr-session-v1")
    return _serializer


def invalidate_serializer() -> None:
    """Drop the cached serializer so the next request re-reads the secret.

    Call this after rotating the session secret (e.g. password change) so all
    existing signed cookies become unverifiable.
    """
    global _serializer
    _serializer = None


def sign_session(session_id: str) -> tuple[str, str]:
    """Sign a session ID and generate a paired CSRF token.

    Returns (signed_cookie_value, csrf_token). The caller is responsible for
    setting both cookies on the response.
    """
    csrf_token = secrets.token_hex(32)
    payload = {"sid": session_id, "csrf": csrf_token}
    signed = _get_serializer().dumps(payload)
    return signed, csrf_token


def unsign_session(cookie_value: str) -> tuple[str | None, str | None]:
    """Verify and decode a signed session cookie.

    Returns (session_id, csrf_token) on success, or (None, None) on any
    failure (bad signature, expired, tampered).
    """
    if not cookie_value:
        return None, None
    try:
        payload = _get_serializer().loads(cookie_value, max_age=MAX_AGE)
        return payload.get("sid"), payload.get("csrf")
    except (SignatureExpired, BadSignature) as exc:
        logger.debug("Session cookie rejected: %s", exc)
        return None, None
    except Exception as exc:
        logger.warning("Unexpected error verifying session cookie: %s", exc)
        return None, None


def set_session_cookies(response, signed_value: str, csrf_token: str, secure: bool = False) -> None:
    """Attach the session and CSRF cookies to a Flask response."""
    samesite = "Lax"
    base = dict(max_age=MAX_AGE, samesite=samesite, secure=secure)
    response.set_cookie(COOKIE_NAME, signed_value, httponly=True, **base)
    # CSRF cookie is intentionally NOT httponly so JS/HTMX can read it.
    response.set_cookie(CSRF_COOKIE_NAME, csrf_token, httponly=False, **base)


def clear_session_cookies(response) -> None:
    """Remove both session cookies from a Flask response."""
    response.delete_cookie(COOKIE_NAME)
    response.delete_cookie(CSRF_COOKIE_NAME)
