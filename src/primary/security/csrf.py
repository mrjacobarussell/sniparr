"""
CSRF protection for Sniparr.

Uses a double-submit pattern: the signed session cookie embeds a CSRF token
(see signed_session.py); a separate readable cookie carries the same token so
JavaScript / HTMX can echo it back in the X-CSRF-Token request header.

On every state-changing request (POST, PUT, PATCH, DELETE) the middleware
compares the submitted token against the one in the session using a
constant-time comparison to prevent timing-based attacks.

Plain form submissions can put the token in a hidden 'csrf_token' field
instead of the header — both paths are checked.
"""

from hmac import compare_digest

from flask import Request

from src.primary.security.signed_session import CSRF_COOKIE_NAME, COOKIE_NAME, unsign_session

PROTECTED_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _expected_token(req: Request) -> str | None:
    """Extract the CSRF token that was embedded when the session was created."""
    signed = req.cookies.get(COOKIE_NAME)
    if not signed:
        return None
    _session_id, csrf_token = unsign_session(signed)
    return csrf_token


def _submitted_token(req: Request) -> str | None:
    """Read the token the client is asserting — header takes priority over form."""
    token = req.headers.get("X-CSRF-Token")
    if token:
        return token.strip()
    return req.form.get("csrf_token")


def validate(req: Request) -> bool:
    """Return True if the request carries a CSRF token matching the session.

    Always returns True for methods that don't change state so callers can
    call this unconditionally without branching on the method themselves.
    """
    if req.method not in PROTECTED_METHODS:
        return True

    expected = _expected_token(req)
    submitted = _submitted_token(req)

    if not expected or not submitted:
        return False

    return compare_digest(expected, submitted)
