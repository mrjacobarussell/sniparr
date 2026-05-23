#!/bin/bash
# Sniparr Docker Entrypoint
# Supports PUID/PGID for running as non-root user
# If PUID/PGID are not set (or set to 0), runs as root (backward compatible)

set -e

PUID=${PUID:-0}
PGID=${PGID:-0}

# If running as root (default / backward compatible)
if [ "$PUID" -eq 0 ] && [ "$PGID" -eq 0 ]; then
    echo "[entrypoint] Running as root (no PUID/PGID set)"
    echo "[entrypoint] Config dir: ${SNIPARR_CONFIG_DIR:-/config}"
    if [ -d /config ]; then
        echo "[entrypoint] /config exists, ensuring writable..."
        if touch /config/.write_test 2>/dev/null; then
            rm -f /config/.write_test
            echo "[entrypoint] /config writable OK"
        else
            echo "[entrypoint] WARNING: /config not writable"
        fi
    fi
    # Clean up legacy WAL/SHM files before starting
    for db_file in /config/*.db; do
        [ -f "$db_file" ] || continue
        wal="$db_file-wal"; shm="$db_file-shm"
        if [ -f "$wal" ] || [ -f "$shm" ]; then
            echo "[entrypoint] Cleaning up legacy WAL for $db_file"
            python3 -c "import sqlite3; c=sqlite3.connect('$db_file',timeout=10); c.execute('PRAGMA journal_mode=DELETE'); c.close()" 2>/dev/null || true
            rm -f "$wal" "$shm" 2>/dev/null || true
        fi
    done
    exec python3 main.py 2>&1 | tee -a /config/sniparr_startup.log
fi

# Running as non-root user
echo "[entrypoint] Setting up user with PUID=$PUID and PGID=$PGID"

# Create/modify group - handle existing GID gracefully
EXISTING_GROUP=$(getent group "$PGID" 2>/dev/null | cut -d: -f1 || true)
if [ -z "$EXISTING_GROUP" ]; then
    groupadd -g "$PGID" sniparr
    SNIPARR_GROUP="sniparr"
else
    SNIPARR_GROUP="$EXISTING_GROUP"
fi

# Create/modify user - handle existing UID gracefully
EXISTING_USER=$(getent passwd "$PUID" 2>/dev/null | cut -d: -f1 || true)
if [ -z "$EXISTING_USER" ]; then
    useradd -o -u "$PUID" -g "$SNIPARR_GROUP" -d /app -s /bin/bash -M --no-log-init sniparr 2>/dev/null
    SNIPARR_USER="sniparr"
else
    SNIPARR_USER="$EXISTING_USER"
    # Make sure the existing user is in the right group
    usermod -g "$SNIPARR_GROUP" "$SNIPARR_USER" 2>/dev/null || true
fi

echo "[entrypoint] Using user=$SNIPARR_USER (UID=$PUID) group=$SNIPARR_GROUP (GID=$PGID)"

# Fix ownership of directories the app needs to write to
# /config is the main data directory (database, logs, settings)
echo "[entrypoint] Fixing ownership of /config..."
chown -R "$PUID:$PGID" /config

# /app needs to be readable (and some temp/cache files may be written)
# Only chown if not already correct to speed up startup
APP_OWNER=$(stat -c '%u' /app 2>/dev/null || echo "0")
if [ "$APP_OWNER" != "$PUID" ]; then
    echo "[entrypoint] Fixing ownership of /app..."
    chown -R "$PUID:$PGID" /app
fi

# Don't chown /media or /downloads - those are external mounts
# The user is responsible for ensuring PUID/PGID can access them
# (same convention as Sonarr, Radarr, and all LinuxServer.io containers)

# Clean up any leftover WAL/SHM files (from a previous WAL-mode run).
# We now use DELETE journal mode which is reliable on FUSE/shfs (Unraid).
# Removing stale WAL/SHM prevents "database disk image is malformed" on startup.
for db_file in /config/*.db; do
    [ -f "$db_file" ] || continue
    wal="$db_file-wal"
    shm="$db_file-shm"
    if [ -f "$wal" ] || [ -f "$shm" ]; then
        echo "[entrypoint] Converting legacy WAL database to DELETE mode: $db_file"
        python3 -c "
import sqlite3, sys
try:
    c = sqlite3.connect('$db_file', timeout=10)
    c.execute('PRAGMA journal_mode = DELETE')
    c.close()
    print('[entrypoint] Converted $db_file to DELETE mode')
except Exception as e:
    print(f'[entrypoint] WARNING: could not convert $db_file: {e}', file=sys.stderr)
" 2>&1 || true
        rm -f "$wal" "$shm" 2>/dev/null || true
    fi
done

# Drop privileges and run as the target user
echo "[entrypoint] Starting Sniparr as UID=$PUID GID=$PGID"
exec gosu "$PUID:$PGID" python3 main.py
