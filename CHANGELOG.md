# Changelog

All notable changes to this project will be documented here.

## [1.1.0] - 2026-05-13

### Added
- **Deluge** support for Max Seed Queue gating — Deluge (default port 8112) is now available alongside qBittorrent and Transmission as a torrent client option. Sniparr authenticates via Deluge's JSON-RPC API and counts active seeding torrents to pause hunts when the queue is full.

## [1.0.9] - 2026-05-13

### Fixed
- **Swaparr:** Completed downloads stuck in the queue because the *arr app rejected them for quality/match reasons (cutoff not met, low match %) are now detected and handled instead of being silently ignored forever. After exceeding `max_download_time`, Swaparr will strike and eventually remove + re-search these items.
- **Lidarr:** New per-instance toggle **"Clear Low-Match Queue Items"** — when enabled, bulk-removes and blacklists any `importPending`/warning queue items before each missing-album search cycle so Lidarr immediately re-searches for a better release rather than leaving them stuck indefinitely.

### Technical
- Swaparr queue parser now captures `trackedDownloadState` and `statusMessages` from the *arr queue API
- New `check_quality_match_failure()` function identifies quality-rejected completed downloads via status messages and tracked download state
- Lidarr API: new `clear_low_match_queue_items()` function using bulk queue DELETE with blacklist

## [1.0.8] - 2026-04-29

### Added
- Mount-aware import retry queue for remote seedbox/NFS/SMB mounts — when Docker starts before mounts are ready, failed imports are queued and retried every 60 seconds (up to ~2 hours) instead of being lost
- New `mount_monitor.py` with persistent pending import queue stored in DB and background retry thread
- API endpoints `GET/DELETE /api/pending-imports` to view or clear the retry queue

## [1.0.7] - 2026-04-28

### Fixed
- Swaparr config panel bleeding through on the home screen

## [1.0.6] - 2026-04-27

### Added
- Sportarr integration with full Swaparr support for failed/hung download detection

### Removed
- Prowlarr integration removed
- Plex Account link, movie hunt, and TV hunt from hunt manager
- Dead settings toggles

## [9.3.7] - 2026-04-26
- Initial fork from shaneholloman/sniparr
- Added SECURITY.md with vulnerability reporting policy
- Cleaned up README to reflect this fork (removed upstream branding, donations, external links)
- Added user-configurable TMDB API key in Settings > Advanced — leave blank to use the built-in key
- TMDB API key now resolved at runtime from settings, falling back to embedded key
