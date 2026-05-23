#!/usr/bin/env python3
"""
Symmetric encryption for sensitive credential fields (api_key).
Uses Fernet (AES-128-CBC + HMAC-SHA256) from the cryptography library.

Key lifecycle:
  - Auto-generated on first run, stored at <config_dir>/.encryption_key
  - File permissions set to 0o600 (owner read/write only)
  - If the key file is lost, existing encrypted values cannot be recovered;
    users must re-enter credentials.

Encrypted values are stored with the prefix "enc:" so plaintext legacy values
are automatically detected and migrated on the next save.
"""
import logging
from pathlib import Path

logger = logging.getLogger("encryption")

ENCRYPTED_PREFIX = "enc:"
_fernet = None


def _get_key_path() -> Path:
    from src.primary.utils.config_paths import CONFIG_PATH
    return Path(CONFIG_PATH) / ".encryption_key"


def _get_fernet():
    global _fernet
    if _fernet is not None:
        return _fernet
    from cryptography.fernet import Fernet
    key_path = _get_key_path()
    if key_path.exists():
        try:
            key = key_path.read_bytes().strip()
            _fernet = Fernet(key)
            return _fernet
        except Exception as e:
            logger.error(f"Failed to load encryption key from {key_path}: {e} — generating new key")
    key = Fernet.generate_key()
    try:
        key_path.parent.mkdir(parents=True, exist_ok=True)
        key_path.write_bytes(key)
        key_path.chmod(0o600)
        logger.info(f"Encryption key generated at {key_path}")
    except Exception as e:
        logger.error(f"Failed to persist encryption key: {e}")
    _fernet = Fernet(key)
    return _fernet


def encrypt_value(value: str) -> str:
    """Encrypt a plaintext string. Returns 'enc:<ciphertext>'.
    If already encrypted or empty, returns as-is."""
    if not value:
        return value
    if value.startswith(ENCRYPTED_PREFIX):
        return value
    try:
        return ENCRYPTED_PREFIX + _get_fernet().encrypt(value.encode()).decode()
    except Exception as e:
        logger.error(f"encrypt_value failed: {e}")
        return value


def decrypt_value(value: str) -> str:
    """Decrypt an encrypted string. Returns plaintext.
    If value is not prefixed (plaintext legacy), returns as-is."""
    if not value:
        return value
    if not value.startswith(ENCRYPTED_PREFIX):
        return value  # plaintext — not yet migrated
    try:
        return _get_fernet().decrypt(value[len(ENCRYPTED_PREFIX):].encode()).decode()
    except Exception as e:
        logger.warning(f"decrypt_value failed (returning empty): {e}")
        return ""
