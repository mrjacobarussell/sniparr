<p align="center">
  <img src="frontend/static/logo/sniparr.svg" alt="Sniparr Logo" width="120">
</p>

<h1 align="center">Sniparr</h1>

<p align="center">
  Automated missing-media hunting and stuck-download clearing for your <em>arr</em> stack — with a proper security layer.
</p>

<p align="center">
  <a href="https://discord.com/invite/ExSFH64kVn"><img src="https://img.shields.io/discord/1370922258247454821?color=7289DA&label=Discord&style=flat&logo=discord" alt="Discord"></a>
  <a href="https://github.com/mrjacobarussell/sniparr/releases"><img src="https://img.shields.io/github/v/release/mrjacobarussell/sniparr?style=flat&label=Release" alt="Release"></a>
  <a href="https://buymeacoffee.com/jacobrussell_medic"><img src="https://img.shields.io/badge/Support-Buy%20Me%20a%20Coffee-yellow?style=flat&logo=buymeacoffee" alt="Support"></a>
</p>

---

## What Sniparr Does

Your *arr apps (Sonarr, Radarr, etc.) grab new releases as they appear on RSS feeds — but they don't go back and search for content already in your library that never downloaded, and they won't automatically clean up stuck or stalled downloads. Sniparr handles both.

**Missing content** — Scans your library, finds everything marked as missing, and triggers searches in controlled batches. You set how many items per cycle and how long to sleep between runs.

**Quality upgrades** — Finds items below your quality cutoff and queues upgrades on the same cadence.

**Stuck downloads (Swaparr)** — Watches your download clients for stalled, slow, or permanently-stuck items. After a configurable number of strikes it removes the dead download and lets your *arr app find a replacement. Also catches downloads that finished but were rejected at import — these get struck and cleared so a better release can be grabbed automatically.

**Indexer monitoring** — Live stats, search history, and per-indexer health for your Prowlarr setup, all in one dashboard.

---

## How It's Different from Huntarr

Sniparr started as a personal fork of Huntarr Revisited. It diverged significantly:

| | Huntarr | Sniparr |
|---|---|---|
| **Scope** | Added its own download pipeline (direct NZB/torrent search and send) | Deliberately removed that — your arr apps already do it better |
| **Security** | Basic auth | SSRF guard, CSRF tokens, signed sessions, 2FA, rate limiting, proxy/SSO auth |
| **Auth options** | Login only | Login, local network bypass, reverse proxy header passthrough |
| **Swaparr** | Strike-based removal | Strike-based + quality-rejection detection + import-failure handling |
| **Prowlarr** | Stats only | Stats, per-indexer history, health indicators |
| **Requests** | None | Use Overseerr/Jellyseerr |

The philosophy difference: Sniparr does one thing — tell your arr apps about content they're missing. It doesn't try to replace them. Huntarr added torrent and NZB client management, custom download pipelines, and calendar views for downloads. Those features overlap heavily with what Sonarr and Radarr already do natively, so Sniparr removed them to stay focused.

---

## Supported Apps

| App | Missing | Upgrades | Swaparr |
|-----|:-------:|:--------:|:-------:|
| Sonarr | ✅ | ✅ | ✅ |
| Radarr | ✅ | ✅ | ✅ |
| Lidarr | ✅ | ✅ | ✅ |
| Readarr | ✅ | ✅ | ✅ |
| Whisparr v2 | ✅ | ✅ | ✅ |
| Whisparr v3 | ✅ | ✅ | ✅ |
| Sportarr | — | — | ✅ |

**Swaparr torrent clients:** qBittorrent · Transmission · Deluge

---

## Security

Sniparr treats security as a first-class feature, not an afterthought.

| | |
|---|---|
| **SSRF guard** | Instance URLs are validated against loopback and link-local ranges before any request. `localhost` is blocked; Docker hostnames and RFC-1918 addresses work normally. |
| **CSRF protection** | All state-changing requests require a matching token — double-submit cookie, HMAC-signed. |
| **Signed sessions** | `itsdangerous` URLSafeTimedSerializer, 24-hour TTL. Changing your password invalidates all sessions. |
| **2FA** | TOTP with QR setup, backup codes, and a recovery key generated at first setup. |
| **Rate limiting** | 5 login attempts per 60 seconds per IP. |
| **Local bypass** | Skip login entirely for RFC-1918 addresses — for trusted home networks. |
| **Proxy / SSO** | Delegate auth to Authelia, Authentik, or oauth2-proxy via a configurable header (`Remote-User` by default). |

---

## Installation

```yaml
services:
  sniparr:
    image: mrjacobarussell/sniparr:latest
    container_name: sniparr
    restart: unless-stopped
    ports:
      - "9705:9705"
    volumes:
      - sniparr-config:/config
    environment:
      - TZ=America/Chicago
      - PUID=99        # Unraid default — use 1000 for standard Linux
      - PGID=100       # Unraid default — use 1000 for standard Linux

volumes:
  sniparr-config:
    name: sniparr-config
```

**Unraid:** Install via Community Applications — search for **Sniparr**.

> [!TIP]
> Use a named Docker volume (`sniparr-config`) rather than a bind-mount path. On Unraid's shfs filesystem, bind mounts can cause SQLite database corruption on container restarts.

---

## How It Works

1. **Connect** your *arr instances with an API key. URLs are SSRF-validated on save.
2. **Configure** items-per-cycle, sleep intervals, and hourly API caps to avoid hammering indexers.
3. **Run** — Sniparr loops: scan → trigger searches → sleep → repeat.
4. **Swaparr** (optional) watches your download queue and removes anything stuck after N strikes.

That's it. Sniparr doesn't download anything itself — it instructs your arr apps, which handle everything through their own clients and pipelines.

---

## Notable Behaviours

**Swaparr quality-rejection handling** — Downloads that complete but fail import due to quality mismatch are detected via `trackedDownloadState` and `statusMessages`. Sniparr strikes them over time and removes them so a better release can be found — not just stalled torrents.

**Lidarr low-match clearing** — Per-instance toggle to bulk-remove stuck `importPending` queue items before each search cycle so Lidarr immediately re-searches rather than sitting on a bad match.

**Mount-aware import retry** — If a container starts before NFS/SMB mounts are ready, failed imports are queued and retried for up to ~2 hours instead of being permanently dropped.

**Hourly API caps** — Per-instance limits that reset every hour, preventing indexer bans during aggressive catch-up runs.

---

## Links

- [GitHub Issues](https://github.com/mrjacobarussell/sniparr/issues)
- [Discord](https://discord.com/invite/ExSFH64kVn)
- [Buy Me a Coffee](https://buymeacoffee.com/jacobrussell_medic)

---

## Origin

Sniparr is a ground-up project by [MrJacobarussell](https://github.com/mrjacobarussell) — not a fork of anything. Several projects shaped the thinking:

- **[plexguide/Huntarr.io](https://github.com/plexguide/Huntarr.io)** — the original missing-media hunt concept
- **[mrjacobarussell/huntarr](https://github.com/mrjacobarussell/huntarr)** — a personal fork where Swaparr quality-rejection handling, Lidarr low-match clearing, and mount-aware retry were proven out
- **[av1155/houndarr](https://github.com/av1155/houndarr)** — security-first approach that inspired the SSRF guard, CSRF tokens, signed sessions, and proxy auth patterns

No code from any of these appears in this repository.
