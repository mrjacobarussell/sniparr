#!/usr/bin/env python3
"""
Authentication module for Sniparr
Handles user creation, verification, and session management
Including two-factor authentication
"""

import os
import json
import hashlib
import secrets
import time
import threading
import pathlib
import base64
import io
import qrcode
import pyotp # Ensure pyotp is imported
import re # Import the re module for regex
import sqlite3
from typing import Dict, Any, Optional, Tuple, Union
from flask import request, redirect, url_for, session
from .utils.logger import logger # Ensure logger is imported

from src.primary.utils.database import get_database
from src.primary import settings_manager

SESSION_EXPIRY = 60 * 60 * 24 * 7
SESSION_COOKIE_NAME = "sniparr_session"

# In-memory cache for auth middleware hot-path checks (avoids DB hit per request)
_auth_cache = {
    "user_exists": None,           # bool or None
    "user_exists_ts": 0,           # timestamp
    "setup_in_progress": None,     # bool or None
    "setup_in_progress_ts": 0,     # timestamp
    "auth_settings": None,         # dict or None
    "auth_settings_ts": 0,         # timestamp
}
_AUTH_CACHE_TTL = 10  # seconds — short enough to pick up setup/login changes quickly
_auth_cache_lock = threading.Lock()

def get_base_url_path():
    try:
        base_url = settings_manager.get_setting('general', 'base_url', '').strip()
        if not base_url or base_url == '/':
            return ''
        base_url = base_url.strip('/')
        base_url = '/' + base_url
        return base_url
    except Exception as e:
        logger.error(f"Error getting base_url from settings: {e}")
        return ''

# Store active sessions
active_sessions = {}
_session_cleanup_ts = 0  # Last time expired sessions were swept

# --- Helper functions for user data ---
def get_user_data(username: str = None) -> Dict[str, Any]:
    """Load user data from the database."""
    db = get_database()
    if username:
        return db.get_user_by_username(username) or {}
    else:
        # For backward compatibility, return first user if no username specified
        # This is used in legacy code that expects single user
        try:
            # Get the first user from the database using configured connection
            with db.get_connection() as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute('SELECT * FROM users LIMIT 1')
                row = cursor.fetchone()
                
                if row:
                    user_data = dict(row)
                    return user_data
                return {}
        except Exception as e:
            logger.error(f"Error getting user data: {e}")
            return {}

def save_user_data(user_data: Dict[str, Any]) -> bool:
    """Save user data to the database."""
    try:
        db = get_database()
        username = user_data.get('username')
        if not username:
            logger.error("Cannot save user data without username")
            return False
            
        # Check if user exists
        existing_user = db.get_user_by_username(username)
        if existing_user:
            # Update existing user
            success = True
            if 'password' in user_data:
                success &= db.update_user_password(username, user_data['password'])
            if 'two_fa_enabled' in user_data or 'two_fa_secret' in user_data:
                success &= db.update_user_2fa(
                    username, 
                    user_data.get('two_fa_enabled', existing_user.get('two_fa_enabled', False)),
                    user_data.get('two_fa_secret', existing_user.get('two_fa_secret'))
                )
            if 'temp_2fa_secret' in user_data:
                success &= db.update_user_temp_2fa_secret(username, user_data.get('temp_2fa_secret'))
            return success
        else:
            # Create new user
            return db.create_user(
                username=username,
                password=user_data.get('password', ''),
                two_fa_enabled=user_data.get('two_fa_enabled', False),
                two_fa_secret=user_data.get('two_fa_secret')
            )
    except Exception as e:
        logger.error(f"Error saving user data: {e}", exc_info=True)
        return False
# --- End Helper functions ---


def _password_is_hashed(stored: str) -> bool:
    """True if stored value looks like a hash (not plaintext). Supports bcrypt and salt:hash."""
    if not stored or len(stored) < 10:
        return False
    if stored.startswith("$2") and stored.count("$") >= 3:
        return True  # bcrypt
    if ":" in stored and len(stored) > 40:
        return True  # salt:hash (e.g. our SHA-256 format)
    return False


def hash_password(password: str) -> str:
    """Hash a password using bcrypt. All new and updated passwords use this."""
    import bcrypt
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(stored_password: str, provided_password: str) -> bool:
    """Verify a password against its stored hash.

    Supports three formats for seamless migration:
    - bcrypt ($2b$…)         — new standard; all fresh passwords use this
    - salt:sha256            — legacy Sniparr/Sniparr format; still accepted
    - plaintext              — very old installs; accepted once, rehashed on next save
    """
    if not stored_password or not provided_password:
        return False

    # bcrypt — preferred format going forward
    if stored_password.startswith("$2") and stored_password.count("$") >= 3:
        try:
            import bcrypt
            return bcrypt.checkpw(provided_password.encode("utf-8"), stored_password.encode("utf-8"))
        except Exception as exc:
            logger.debug("bcrypt verify failed: %s", exc)
            return False

    # salt:sha256 — legacy format; still valid until the user changes their password
    if ":" in stored_password and len(stored_password) > 40:
        try:
            salt, pw_hash = stored_password.split(":", 1)
            verify_hash = hashlib.sha256((provided_password + salt).encode()).hexdigest()
            return secrets.compare_digest(verify_hash, pw_hash)
        except Exception as exc:
            logger.debug("sha256 verify failed: %s", exc)
            return False

    # plaintext — only present on very old databases; allow login so user can set a real password
    return secrets.compare_digest(stored_password, provided_password)

def hash_username(username: str) -> str:
    """Create a normalized hash of the username"""
    # Convert to lowercase and hash
    return hashlib.sha256(username.lower().encode()).hexdigest()

def validate_password_strength(password: str) -> Optional[str]:
    """Validate password strength. Returns an error string on failure, None on pass."""
    if not password or len(password) < 8:
        return "Password must be at least 8 characters long."
    if not re.search(r"[A-Z]", password):
        return "Password must contain at least one uppercase letter."
    if not re.search(r"[0-9]", password):
        return "Password must contain at least one number."
    if not re.search(r"[^A-Za-z0-9]", password):
        return "Password must contain at least one special character (e.g. !@#$%)."
    return None

def invalidate_auth_cache():
    """Clear the auth middleware cache (call after user creation, setup changes, auth mode changes)."""
    with _auth_cache_lock:
        _auth_cache["user_exists"] = None
        _auth_cache["user_exists_ts"] = 0
        _auth_cache["setup_in_progress"] = None
        _auth_cache["setup_in_progress_ts"] = 0
        _auth_cache["auth_settings"] = None
        _auth_cache["auth_settings_ts"] = 0

def _auto_clear_setup_progress():
    """Silently clear any lingering setup_progress record.
    
    Called when a user is already authenticated (via session or bypass).
    If they can use the app, setup is done — the record is stale.
    Only runs once per process to avoid hitting the DB on every request.
    """
    # Fast path: if cache says setup is not in progress, nothing to clear
    if _auth_cache.get("setup_in_progress") is False:
        return
    try:
        db = get_database()
        if db.is_setup_in_progress():
            db.clear_setup_progress()
            with _auth_cache_lock:
                _auth_cache["setup_in_progress"] = False
                _auth_cache["setup_in_progress_ts"] = time.time()
            logger.info("Auto-cleared stale setup_progress (user is already authenticated)")
    except Exception as e:
        logger.debug(f"_auto_clear_setup_progress: {e}")

def user_exists() -> bool:
    """Check if a user has been created"""
    db = get_database()
    return db.user_exists()

def create_user(username: str, password: str) -> bool:
    """Create a new user. Password is hashed before storage (security)."""
    if not username or not password:
        logger.error("Attempted to create user with empty username or password")
        return False

    db = get_database()
    success = db.create_user(
        username=username,
        password=hash_password(password),
        two_fa_enabled=False,
        two_fa_secret=None
    )

    if success:
        logger.info("User creation successful")
        invalidate_auth_cache()
    else:
        logger.error("User creation failed")

    return success

def verify_user(username: str, password: str, otp_code: str = None) -> Tuple[bool, bool]:
    """
    Verify user credentials
    
    Returns:
        Tuple[bool, bool]: (auth_success, needs_2fa)
    """
    if not user_exists():
        logger.warning("Login attempt failed: User does not exist.")
        return False, False
        
    try:
        db = get_database()
        user_data = db.get_user_by_username(username)
        
        if not user_data:
            logger.warning(f"Login attempt failed: User '{username}' not found.")
            return False, False

        from src.primary.security import audit as _audit
        _client_ip = request.remote_addr or "unknown"

        # ── Account lockout check ────────────────────────────────────────────
        locked_until = user_data.get("locked_until")
        if locked_until and int(time.time()) < int(locked_until):
            wait = int(locked_until) - int(time.time())
            logger.warning("Login blocked: account '%s' is locked for %ds more.", username, wait)
            _audit.log(_audit.ACCOUNT_LOCKED, username, _client_ip, f"locked for {wait}s more")
            return False, False

        stored_password = user_data.get("password") or ""
        if not verify_password(stored_password, password):
            logger.warning(f"Login attempt failed for user '{username}': Invalid password.")
            _audit.log(_audit.LOGIN_FAILURE, username, _client_ip, "wrong password")
            _increment_failed_logins(db, username, _client_ip)
            return False, False

        # Silently upgrade legacy password formats to bcrypt on successful login.
        is_bcrypt = stored_password.startswith("$2") and stored_password.count("$") >= 3
        if not is_bcrypt:
            try:
                db.update_user_password(username, hash_password(password))
                logger.info("Upgraded password hash to bcrypt for user '%s'.", username)
            except Exception as exc:
                logger.warning("Could not upgrade password hash for '%s': %s", username, exc)

        # Check if 2FA is enabled
        two_fa_enabled = user_data.get("two_fa_enabled", False)
        logger.debug(f"2FA enabled for user '{username}': {two_fa_enabled}")
        logger.debug(f"2FA secret present: {bool(user_data.get('two_fa_secret'))}")
        logger.debug(f"OTP code provided: {bool(otp_code)}")

        if two_fa_enabled:
            two_fa_secret = user_data.get("two_fa_secret") or ""
            if not two_fa_secret.strip():
                logger.warning(f"Login attempt failed for user '{username}': 2FA enabled but secret missing.")
                return False, False
            if otp_code:
                totp = pyotp.TOTP(two_fa_secret)
                valid_code = totp.verify(otp_code)
                logger.debug(f"OTP code validation result: {valid_code}")
                if valid_code:
                    logger.debug(f"User '{username}' authenticated successfully with 2FA.")
                    _clear_failed_logins(db, username, _client_ip)
                    _audit.log(_audit.LOGIN_SUCCESS, username, _client_ip, "password+2FA")
                    return True, False
                else:
                    logger.warning(f"Login attempt failed for user '{username}': Invalid 2FA code.")
                    _audit.log(_audit.LOGIN_FAILURE, username, _client_ip, "bad 2FA code")
                    _increment_failed_logins(db, username, _client_ip)
                    return False, True
            else:
                logger.warning(f"Login attempt failed for user '{username}': 2FA code required but not provided.")
                logger.debug("Returning needs_2fa=True to trigger 2FA input display")
                return False, True
        else:
            # 2FA not enabled, password is correct
            logger.debug(f"User '{username}' authenticated successfully (no 2FA).")
            _clear_failed_logins(db, username, _client_ip)
            _audit.log(_audit.LOGIN_SUCCESS, username, _client_ip, "password")
            return True, False
    except Exception as e:
        logger.error(f"Error during user verification for '{username}': {e}", exc_info=True)

    logger.warning(f"Login attempt failed for user '{username}': Username not found or other error.")
    return False, False


# ── Account lockout helpers ──────────────────────────────────────────────────
_LOCKOUT_THRESHOLD = 10   # consecutive failures before lockout
_LOCKOUT_SECONDS   = 900  # 15 minutes


def _increment_failed_logins(db, username: str, ip: str = "") -> None:
    """Increment the failure counter and lock the account if threshold is reached."""
    from src.primary.security import audit as _audit
    try:
        with db.get_connection() as conn:
            conn.execute(
                "UPDATE users SET failed_login_count = failed_login_count + 1 WHERE username = ?",
                (username,),
            )
            row = conn.execute(
                "SELECT failed_login_count FROM users WHERE username = ?", (username,)
            ).fetchone()
            count = row[0] if row else 0
            if count >= _LOCKOUT_THRESHOLD:
                locked_until = int(time.time()) + _LOCKOUT_SECONDS
                conn.execute(
                    "UPDATE users SET locked_until = ? WHERE username = ?",
                    (locked_until, username),
                )
                logger.warning("Account '%s' locked for %ds after %d failures.", username, _LOCKOUT_SECONDS, count)
                _audit.log(_audit.ACCOUNT_LOCKED, username, ip, f"after {count} consecutive failures; locked {_LOCKOUT_SECONDS}s")
            conn.commit()
    except Exception as exc:
        logger.warning("Could not increment failed logins for '%s': %s", username, exc)


def _clear_failed_logins(db, username: str, ip: str = "") -> None:
    """Reset failure counter and remove any lockout on successful authentication."""
    from src.primary.security import audit as _audit
    try:
        with db.get_connection() as conn:
            row = conn.execute(
                "SELECT locked_until FROM users WHERE username = ?", (username,)
            ).fetchone()
            was_locked = row and row[0] and int(row[0]) > int(time.time())
            conn.execute(
                "UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE username = ?",
                (username,),
            )
            conn.commit()
        if was_locked:
            _audit.log(_audit.ACCOUNT_UNLOCKED, username, ip, "lockout cleared on successful login")
    except Exception as exc:
        logger.warning("Could not clear failed logins for '%s': %s", username, exc)

def create_session(username: str) -> str:
    """Create a new session for an authenticated user"""
    session_id = secrets.token_hex(32)
    # Store the actual username, not the hash
    
    # Store session data
    active_sessions[session_id] = {
        "username": username, # Store actual username
        "created_at": time.time(),
        "expires_at": time.time() + SESSION_EXPIRY
    }
    
    return session_id

def verify_session(session_id: str) -> bool:
    """Verify if a session is valid"""
    global _session_cleanup_ts
    now = time.time()

    # Periodic sweep: remove ALL expired sessions every 5 minutes
    if now - _session_cleanup_ts > 300:
        _session_cleanup_ts = now
        expired = [sid for sid, sd in active_sessions.items()
                   if sd.get("expires_at", 0) < now]
        for sid in expired:
            active_sessions.pop(sid, None)

    if not session_id or session_id not in active_sessions:
        return False
        
    session_data = active_sessions[session_id]
    
    # Check if session has expired
    if session_data.get("expires_at", 0) < now:
        # Clean up expired session
        del active_sessions[session_id]
        return False
        
    # Extend session expiry
    active_sessions[session_id]["expires_at"] = now + SESSION_EXPIRY
    return True

def get_username_from_session(session_id: str) -> Optional[str]:
    """Get the username from a session"""
    if not session_id or session_id not in active_sessions:
        return None
    
    # Return the stored username
    return active_sessions[session_id].get("username")

def update_session_username(session_id: str, new_username: str) -> bool:
    """Update the username in an existing session"""
    if not session_id or session_id not in active_sessions:
        return False
    
    # Update the username in the session
    active_sessions[session_id]["username"] = new_username
    logger.debug(f"Updated session {session_id} username to '{new_username}'")
    return True

def authenticate_request():
    """Flask route decorator to check if user is authenticated"""

    # Skip authentication for static files and the login/setup pages
    static_path = "/static/"
    login_path = "/login"
    api_login_path = "/api/login"
    setup_path = "/setup"
    user_path = "/user"
    api_setup_path = "/api/setup"
    favicon_path = "/favicon.ico"
    health_check_path = "/api/health"
    ping_path = "/ping"

    # Check if this is a commonly polled API endpoint to reduce log verbosity
    is_polling_endpoint = any(endpoint in request.path for endpoint in [
        '/api/logs/', '/api/cycle/', '/api/hourly-caps', '/api/swaparr/status'
    ])

    if not is_polling_endpoint:
        pass  # Path checking debug removed to reduce log spam

    # FIRST: Always allow setup and user page access - this handles returns from external auth like Plex
    if request.path.endswith('/setup') or request.path.endswith('/user'):
        if not is_polling_endpoint:
            logger.debug(f"Allowing setup/user page access for path: {request.path}")
        return None

    # Skip authentication for static files, API setup, health check path, ping, github sponsors, and version endpoint
    if request.path.startswith('/static/') or request.path.startswith('/api/setup') or request.path.endswith('/favicon.ico') or request.path.startswith('/api/health') or request.path.endswith('/ping') or request.path.startswith('/api/github_sponsors') or request.path.startswith('/api/sponsors/init') or request.path.endswith('/api/version'):
        return None

    # Skip authentication for login pages, recovery key endpoints, and setup-related user endpoints
    if request.path.endswith('/login') or request.path.startswith('/api/login') or request.path.startswith('/auth/recovery-key') or '/api/user/2fa/' in request.path or request.path.endswith('/api/settings/general'):
        if not is_polling_endpoint:
            # Reduced logging frequency for common paths to prevent spam
            if hash(request.path) % 20 == 0:  # Log ~5% of auth skips
                logger.debug(f"Skipping authentication for login/recovery/2fa/settings path '{request.path}'")
        return None
    
    # Cached auth checks — avoids hitting the database on every single request
    now = time.time()
    
    # Check if user exists (cached for 10s)
    _user_exists = _auth_cache["user_exists"]
    if _user_exists is None or (now - _auth_cache["user_exists_ts"]) > _AUTH_CACHE_TTL:
        _user_exists = user_exists()
        with _auth_cache_lock:
            _auth_cache["user_exists"] = _user_exists
            _auth_cache["user_exists_ts"] = now
    
    if not _user_exists:
        if not is_polling_endpoint:
            logger.debug(f"No user exists, redirecting to setup")
        # Return JSON for API calls so the frontend doesn't try to parse HTML
        if request.path.startswith("/api/"):
            from flask import jsonify as _jsonify
            return _jsonify({"error": "Setup required", "setup_required": True}), 503
        return redirect(get_base_url_path() + url_for("common.setup"))
    
    # Load auth settings EARLY (cached for 10s) — auth bypass modes must be
    # evaluated before is_setup_in_progress so that a user who already chose
    # No Login or Local Bypass during setup isn't locked out by leftover
    # setup_progress records.
    local_access_bypass = False
    proxy_auth_bypass = False
    _cached_settings = _auth_cache["auth_settings"]
    if _cached_settings is None or (now - _auth_cache["auth_settings_ts"]) > _AUTH_CACHE_TTL:
        try:
            from src.primary.settings_manager import load_settings
            _cached_settings = load_settings("general")
        except Exception as e:
            logger.error(f"Error loading authentication bypass settings: {e}")
            _cached_settings = {}
        with _auth_cache_lock:
            _auth_cache["auth_settings"] = _cached_settings
            _auth_cache["auth_settings_ts"] = now
    
    local_access_bypass = _cached_settings.get("local_access_bypass", False)
    proxy_auth_bypass = _cached_settings.get("proxy_auth_bypass", False)
    
    # Check if proxy auth bypass is enabled - this completely disables authentication
    # Checked before is_setup_in_progress so "No Login Mode" users aren't blocked
    if proxy_auth_bypass:
        _auto_clear_setup_progress()
        return None
    
    remote_addr = request.remote_addr
    if not is_polling_endpoint:
        pass  # IP address debug removed to reduce log spam
    
    if local_access_bypass:
        # Common local network IP ranges
        local_networks = [
            '127.0.0.1',      # localhost
            '::1',            # localhost IPv6
            '10.',            # 10.0.0.0/8
            '172.16.',        # 172.16.0.0/12
            '172.17.',
            '172.18.',
            '172.19.',
            '172.20.',
            '172.21.',
            '172.22.',
            '172.23.',
            '172.24.',
            '172.25.',
            '172.26.',
            '172.27.',
            '172.28.',
            '172.29.',
            '172.30.',
            '172.31.',
            '192.168.'        # 192.168.0.0/16
        ]
        is_local = False
        
        # Check if request is coming through a proxy
        forwarded_for = request.headers.get('X-Forwarded-For')
        if forwarded_for:
            logger.debug(f"X-Forwarded-For header detected: {forwarded_for}")
            # Take the first IP in the chain which is typically the client's real IP
            possible_client_ip = forwarded_for.split(',')[0].strip()
            
            # Check if this forwarded IP is a local network IP
            for network in local_networks:
                if possible_client_ip == network or (network.endswith('.') and possible_client_ip.startswith(network)):
                    is_local = True
                    break
        
        # Check if direct remote_addr is a local network IP if not already determined
        if not is_local:
            for network in local_networks:
                if remote_addr == network or (network.endswith('.') and remote_addr.startswith(network)):
                    is_local = True
                    break
                    
        if is_local:
            if not is_polling_endpoint:
                logger.debug(f"Local network access from {remote_addr} - Authentication bypassed! (Local Bypass Mode)")
            _auto_clear_setup_progress()
            return None
        else:
            if not is_polling_endpoint:
                logger.warning(f"Access from {remote_addr} is not recognized as local network - Authentication required")
    
    # Check for valid session BEFORE is_setup_in_progress so that
    # logged-in users aren't kicked back to setup by stale records.
    # --- Proxy auth mode ---
    from src.primary.security import proxy_auth as _proxy_auth
    if _proxy_auth.proxy_mode_enabled():
        username, status_code = _proxy_auth.authenticate_proxy_request(request)
        if username is None:
            if request.path.startswith("/api/"):
                from flask import jsonify as _jsonify
                return _jsonify({"error": "Unauthorized"}), status_code
            return redirect(get_base_url_path() + url_for("common.login_route"))
        g.proxy_auth_user = username
        # CSRF still required in proxy mode for state-changing requests
        from src.primary.security.csrf import validate as _validate_csrf, PROTECTED_METHODS as _CSRF_METHODS
        if request.method in _CSRF_METHODS and not _validate_csrf(request):
            logger.warning("CSRF check failed (proxy mode) for %s %s user=%s", request.method, request.path, username)
            from flask import jsonify as _jsonify, abort
            if request.path.startswith("/api/"):
                return _jsonify({"error": "CSRF token invalid or missing"}), 403
            abort(403)
        _auto_clear_setup_progress()
        return None

    # --- Builtin auth mode: verify signed session cookie ---
    from src.primary.security import signed_session as _signed_session
    raw_cookie = request.cookies.get(_signed_session.COOKIE_NAME)
    session_id = None
    if raw_cookie:
        session_id, _csrf = _signed_session.unsign_session(raw_cookie)

    # Fall back to legacy plain cookie during migration window
    if not session_id:
        session_id = request.cookies.get(SESSION_COOKIE_NAME)

    if session_id and verify_session(session_id):
        # CSRF check on state-changing requests
        from src.primary.security.csrf import validate as _validate_csrf, PROTECTED_METHODS as _CSRF_METHODS
        if raw_cookie and request.method in _CSRF_METHODS and not _validate_csrf(request):
            logger.warning("CSRF check failed for %s %s", request.method, request.path)
            from flask import jsonify as _jsonify, abort
            if request.path.startswith("/api/"):
                return _jsonify({"error": "CSRF token invalid or missing"}), 403
            abort(403)
        if not is_polling_endpoint:
            pass  # Session valid - debug spam removed
        _auto_clear_setup_progress()
        return None
    
    # No bypass, no session — check if setup is still in progress.
    _setup_in_progress = _auth_cache["setup_in_progress"]
    if _setup_in_progress is None or (now - _auth_cache["setup_in_progress_ts"]) > _AUTH_CACHE_TTL:
        try:
            db = get_database()
            _setup_in_progress = db.is_setup_in_progress()
        except Exception as e:
            logger.error(f"Error checking setup progress in auth middleware: {e}")
            _setup_in_progress = False
        with _auth_cache_lock:
            _auth_cache["setup_in_progress"] = _setup_in_progress
            _auth_cache["setup_in_progress_ts"] = now
    
    if _setup_in_progress:
        if not is_polling_endpoint:
            logger.debug(f"Setup is in progress, redirecting to setup")
        if request.path.startswith("/api/"):
            from flask import jsonify as _jsonify
            return _jsonify({"error": "Setup in progress", "setup_required": True}), 503
        return redirect(get_base_url_path() + url_for("common.setup"))
    
    # Use less verbose logging for polling endpoints
    if is_polling_endpoint:
        # Only log occasionally for polling endpoints to reduce spam
        import random
        if random.random() < 0.1:  # Log only 10% of polling auth failures
            logger.debug(f"No valid session for polling endpoint '{request.path}', session_id: {session_id}")
    else:
        logger.debug(f"No valid session for path '{request.path}', session_id: {session_id}")
    
    # For API calls, return 401 Unauthorized as proper JSON
    if request.path.startswith("/api/"):
        # Return 401 with less verbose logging for polling endpoints
        if is_polling_endpoint:
            # Don't log every 401 for polling endpoints
            pass
        else:
            logger.debug(f"Returning 401 for API path '{request.path}'")
        from flask import jsonify as _jsonify
        return _jsonify({"error": "Unauthorized"}), 401
    
    # No valid session, redirect to login
    if not is_polling_endpoint:
        logger.debug(f"Redirecting to login for path '{request.path}'")
    return redirect(get_base_url_path() + url_for("common.login_route"))

def logout(session_id: str):
    """Log out the current user by invalidating their session"""
    if session_id and session_id in active_sessions:
        del active_sessions[session_id]
    
    # Clear the session cookie in Flask context (if available, otherwise handled by route)
    # session.pop(SESSION_COOKIE_NAME, None) # This might be better handled solely in the route

def is_2fa_enabled(username):
    """Check if 2FA is enabled for a user."""
    db = get_database()
    user_data = db.get_user_by_username(username)
    if user_data:
        return user_data.get("two_fa_enabled", False)
    return False

def generate_2fa_secret(username: str) -> Tuple[str, str]:
    """
    Generate a new 2FA secret and QR code
    
    Returns:
        Tuple[str, str]: (secret, qr_code_data_uri)
    """
    # Generate a random secret
    secret = pyotp.random_base32()
    
    # Create a TOTP object
    totp = pyotp.TOTP(secret)
    
    # Get the provisioning URI - Use the actual username here
    uri = totp.provisioning_uri(name=username, issuer_name="Sniparr")
    
    # Generate QR code
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(uri)
    qr.make(fit=True)
    
    try:
        img = qr.make_image(fill_color="black", back_color="white")
    
        # Convert to base64 string
        buffered = io.BytesIO()
        img.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode()
    
        # Store the secret temporarily associated with the user
        user_data = get_user_data(username)
        user_data["temp_2fa_secret"] = secret
        user_data["username"] = username  # Ensure username is set
        if save_user_data(user_data):
            logger.info(f"Generated temporary 2FA secret for user '{username}'.")
            return secret, f"data:image/png;base64,{img_str}"
        else:
            logger.error(f"Failed to save temporary 2FA secret for user '{username}'.")
            raise Exception("Failed to save user data with temporary 2FA secret.")
    
    except Exception as e:
        logger.error(f"Error generating 2FA QR code for user '{username}': {e}", exc_info=True)
        raise

def verify_2fa_code(username: str, code: str, enable_on_verify: bool = False) -> bool:
    """Verify a 2FA code against the appropriate secret (temporary for setup, permanent for enabled 2FA)"""
    try:
        db = get_database()
        user_data = db.get_user_by_username(username)
        
        if not user_data:
            logger.warning(f"2FA verification attempt for '{username}' failed: User not found.")
            return False
        
        # Check if 2FA is already enabled - use permanent secret
        if user_data.get("two_fa_enabled"):
            perm_secret = user_data.get("two_fa_secret")
            if not perm_secret:
                logger.warning(f"2FA verification attempt for '{username}' failed: 2FA enabled but no permanent secret found.")
                return False
            
            totp = pyotp.TOTP(perm_secret)
            # Add time window tolerance for better compatibility
            if totp.verify(code, valid_window=1):
                logger.info(f"2FA code verified successfully for user '{username}' using permanent secret.")
                return True
            else:
                logger.warning(f"Invalid 2FA code provided by user '{username}' for permanent secret. Code: {code}")
                return False
        
        # 2FA not enabled yet - use temporary secret for setup
        temp_secret = user_data.get("temp_2fa_secret")
        
        if not temp_secret:
            logger.warning(f"2FA verification attempt for '{username}' failed: No temporary secret found.")
            logger.debug(f"Available user data keys: {list(user_data.keys())}")
            return False
        
        totp = pyotp.TOTP(temp_secret)
        
        # Add time window tolerance for better compatibility
        if totp.verify(code, valid_window=1):
            logger.info(f"2FA code verified successfully for user '{username}' using temporary secret.")
            if enable_on_verify:
                # Enable 2FA permanently
                success = db.update_user_2fa(username, True, temp_secret)
                if success:
                    # Clear temporary secret
                    clear_success = db.update_user_temp_2fa_secret(username, None)
                    if clear_success:
                        logger.info(f"2FA enabled permanently for user '{username}' and temporary secret cleared.")
                    else:
                        logger.warning(f"2FA enabled for user '{username}' but failed to clear temporary secret.")
                else:
                    logger.error(f"Failed to save user data after enabling 2FA for '{username}'.")
                    return False
            return True
        else:
            logger.warning(f"Invalid 2FA code provided by user '{username}' for temporary secret. Code: {code}")
            # Add debugging info
            current_code = totp.now()
            logger.debug(f"Expected current code: {current_code}")
            return False
    except Exception as e:
        logger.error(f"Error during 2FA verification for '{username}': {e}", exc_info=True)
        return False

def disable_2fa(password: str) -> bool:
    """Disable 2FA for the current user (using only password - kept for potential other uses)"""
    user_data = get_user_data()
    
    # Verify password
    if verify_password(user_data.get("password", ""), password):
        user_data["2fa_enabled"] = False
        user_data["2fa_secret"] = None
        if save_user_data(user_data):
            logger.info("2FA disabled successfully (password only).")
            return True
        else:
            logger.error("Failed to save user data after disabling 2FA (password only).")
            return False
    else:
        logger.warning("Failed to disable 2FA (password only): Invalid password provided.")
        return False

def disable_2fa_with_password_and_otp(username: str, password: str, otp_code: str) -> bool:
    """Disable 2FA for the specified user, requiring both password and OTP code."""
    try:
        db = get_database()
        user_data = db.get_user_by_username(username)
        
        if not user_data:
            logger.warning(f"Failed to disable 2FA for '{username}': User not found.")
            return False
        
        # 1. Verify Password using proper hash verification
        stored_password = user_data.get("password", "")
        if not verify_password(stored_password, password):
            logger.warning(f"Failed to disable 2FA for '{username}': Invalid password provided.")
            return False
            
        # 2. Verify OTP Code against permanent secret
        perm_secret = user_data.get("two_fa_secret")
        if not user_data.get("two_fa_enabled") or not perm_secret:
            logger.error(f"Failed to disable 2FA for '{username}': 2FA is not enabled or secret missing.")
            # Should ideally not happen if called from the correct UI state, but good to check
            return False 
            
        totp = pyotp.TOTP(perm_secret)
        # Add time window tolerance for better compatibility
        if not totp.verify(otp_code, valid_window=1):
            logger.warning(f"Failed to disable 2FA for '{username}': Invalid OTP code provided.")
            return False
            
        # 3. Both verified, proceed to disable
        success = db.update_user_2fa(username, False, None)
        if success:
            logger.info(f"2FA disabled successfully for '{username}' after verifying password and OTP.")
            return True
        else:
            logger.error(f"Failed to save user data after disabling 2FA for '{username}'.")
            return False
    except Exception as e:
        logger.error(f"Error during 2FA disable for '{username}': {e}", exc_info=True)
        return False

def change_username(current_username: str, new_username: str, password: str) -> bool:
    """Change the username for the current user"""
    from .utils.database import get_database
    
    db = get_database()
    
    # Get current user data from database
    user_data = db.get_user_by_username(current_username)
    if not user_data:
        logger.warning(f"Username change failed: User '{current_username}' not found in database.")
        return False
    
    # Verify current password using the proper verify_password function
    stored_password = user_data.get("password") or ""
    if not verify_password(stored_password, password):
        logger.warning(f"Username change failed for '{current_username}': Invalid password provided.")
        return False
    
    # Update username in database
    if db.update_user_username(current_username, new_username):
        logger.info(f"Username changed successfully from '{current_username}' to '{new_username}'.")
        return True
    else:
        logger.error(f"Failed to update username in database for '{current_username}'.")
        return False

def change_password(current_password: str, new_password: str) -> bool:
    """Change the password for the current user"""
    from .utils.database import get_database
    
    # Get current username from session to identify the user
    from .routes.common import get_user_for_request
    username = get_user_for_request()
    if not username:
        logger.warning("Password change failed: No authenticated user found.")
        return False
    
    db = get_database()
    
    # Get current user data from database
    user_data = db.get_user_by_username(username)
    if not user_data:
        logger.warning(f"Password change failed: User '{username}' not found in database.")
        return False
    
    # Verify current password using the proper verify_password function
    stored_password = user_data.get("password") or ""
    if not verify_password(stored_password, current_password):
        logger.warning(f"Password change failed for '{username}': Invalid current password provided.")
        return False
    
    # Update password in database (update_user_password hashes automatically)
    if db.update_user_password(username, new_password):
        logger.info(f"Password changed successfully for user '{username}'.")
        return True
    else:
        logger.error(f"Failed to update password in database for '{username}'.")
        return False

def get_app_url_and_key(app_type: str) -> Tuple[str, str]:
    """
    Get the API URL and API key for a specific app type
    
    Args:
        app_type: The app type (sonarr, radarr, lidarr, readarr)
    
    Returns:
        Tuple[str, str]: (api_url, api_key)
    """
    from src.primary.settings_manager import load_settings
    settings = load_settings(app_type)
    if settings:
        api_url = settings.get('url', '')
        api_key = settings.get('api_key', '')
        return api_url, api_key
    return '', ''

