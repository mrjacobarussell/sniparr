# TMDB Episode Group Bridge — Design

**Status:** Approved for implementation planning
**Author:** Jacob Russell + Claude (design session 2026-10-17)
**Test case:** SpongeBob SquarePants (Sonarr series 2145 on the `binhex-sonarr` instance)

## Problem

Sonarr tracks episodes using TheTVDB's season/episode numbering. For shows with a messy broadcast history (syndication, streaming-platform reshuffles, double-length episodes split differently across sources), many real-world releases are packaged using a *different* numbering convention than TheTVDB's — commonly one that matches TMDB's default numbering, or one of TMDB's alternate "episode group" orderings (DVD order, streaming-platform order, production order, etc.).

This causes two concrete, observed failure modes:

1. **Search misses.** Sonarr searches indexers using its TVDB-based season/episode. If the only available release for that real episode is labeled under a different scheme, Sonarr's search never finds it — not because the content doesn't exist, but because the numbers don't match.
2. **Partial season-pack imports.** When a "complete season" pack is grabbed, it may be structurally missing episodes relative to Sonarr's season — not because of a download error, but because the pack was built against a *different, smaller* season boundary (e.g. TMDB's "Season 10" for SpongeBob has 22 episodes; TheTVDB's "Season 10" has 71 — TheTVDB's single season spans multiple TMDB seasons).

This is a known, named problem (Sonarr's own "Scene Numbering" feature exists for the generic version of it), but there's no automatic way to populate it for shows like this — the standard scene-numbering database (TheXEM) only covers scene-release-vs-TVDB mismatches, not TVDB-vs-TMDB mismatches.

## Validated finding (empirical, done during design)

TMDB exposes alternate numbering schemes directly via its **Episode Groups** API (`GET /tv/{id}/episode_groups`, `GET /tv/episode_group/{id}`). For SpongeBob, 21 such groups exist (DVD order, Netflix order, Paramount+ order, Production order, various regional network orders, etc.).

Tested all 21 against Sonarr's real episode list for this series, joining by `(title, air_date)`:

- 19 of 21 groups matched at ≥97% (title match is highly reliable — episode titles rarely collide, even across wildly different season groupings)
- 1 group matched at 85.6% (`Skyshowtime` — excluded)
- 1 group was an empty placeholder (0 episodes — excluded)

**Conclusion:** there is no single "correct" alternate scheme to pick. Multiple schemes are simultaneously valid because different uploaders may have followed different conventions. The fix is to support *all* of them, not to pick one.

## Approach

**No manual setup per show.** Fully automatic discovery:

1. Resolve the show's TMDB ID from Sonarr's `tvdbId` (via TMDB's `/find/{tvdb_id}?external_source=tvdb_id`).
2. Fetch all episode groups for that TMDB ID.
3. For each group, fetch full details and join every episode to Sonarr's episode list by normalized `(title, air_date)`. Use `air_date` only as a tie-breaker when title collisions occur (rare).
4. Keep every group that clears a match-quality threshold (**95%** — chosen because the real data showed a sharp drop to 85.6% for the one disqualified group, giving clean separation).
5. Merge all kept groups into one reverse-lookup table: `(scheme_name, season_number, episode_number) → sonarr_episode_id`.
6. Pick the single highest-match-rate scheme as the **primary** — write its season/episode as `sceneSeasonNumber`/`sceneEpisodeNumber` into Sonarr via `PUT /episode/{id}`, then enable `useSceneNumbering` on the series.
7. Retain the full merged table (all schemes, not just primary) for the fallback path (see below).

This means Sonarr's own normal search/grab/import does the work for the common case — no parallel indexer-search or download-client pipeline. Sniparr's job is purely to give Sonarr correct numbering to work with.

### Fallback: forced import when scene numbering still doesn't resolve

Scene numbering fixes *search*, but a downloaded file can still fail Sonarr's *import* matching (observed tonight with the Muppet Babies pack: multi-episode files whose internal naming didn't trigger Sonarr's multi-episode detection). When Sonarr's queue shows an item stuck with an import warning (`importBlocked`/`importPending`, "episode not found in grabbed release," etc.) for one of these bridged shows:

1. Parse the stuck item's season/episode from its release title.
2. Check the *full* merged lookup table (all schemes, not just primary) for a match.
3. If found, resolve the real Sonarr episode ID(s) and issue `POST /api/v3/command` with `name: "ManualImport"` and an explicit `files` array — the same technique used by hand tonight for Muppet Babies.
4. If no scheme resolves it, leave it alone and log it — never guess.

## Data model (new)

New table, e.g. `episode_group_mappings`:

| column | type | notes |
|---|---|---|
| `id` | int, PK | |
| `sonarr_instance_id` | text | which Sonarr instance config this belongs to |
| `series_id` | int | Sonarr series ID |
| `tmdb_id` | int | resolved TMDB show ID |
| `scheme_name` | text | TMDB group name, e.g. "Paramount+" |
| `is_primary` | bool | whether this scheme's numbers are written to Sonarr's scene fields |
| `match_rate` | float | diagnostic / re-evaluation trigger |
| `mapping_json` | text | `{(season,episode): sonarr_episode_id}` serialized |
| `built_at` | timestamp | so it can be refreshed periodically (new episodes added, etc.) |

Rebuild trigger: on-demand (new "Bridge This Show" action in the UI) plus periodic refresh (reuse the existing `scheduler_engine.py` cadence pattern) to pick up newly-aired episodes.

## Components touched

- New module: `src/primary/apps/sonarr/episode_group_bridge.py` — discovery, matching, merge, scene-number write
- New module: `src/primary/apps/sonarr/stuck_import_resolver.py` — queue-watching + `ManualImport` fallback
- `src/primary/apps/sonarr/missing.py` — no changes needed; scene numbering is transparent to it, Sonarr's own search already respects `useSceneNumbering`
- New DB table + migration (see `src/primary/utils/database` pattern already used elsewhere)
- New settings/route: a per-series "Bridge This Show" trigger in the Sonarr section of the UI, plus a status view (which schemes matched, at what rate, any unmapped episodes)
- TMDB API key: new setting (`tmdb_api_key`), stored encrypted like the existing Sonarr/Radarr/Lidarr instance keys (reuse the existing `enc:` encryption helper already used for app API keys)

## Error handling

- Episodes that fail to join by title/air_date across *every* scheme: logged as genuinely unmapped, surfaced in the UI, never guessed at.
- TMDB API failures (rate limit, show not found): log and skip that show's bridge attempt; don't block the normal missing/upgrade cycles for other shows.
- If enabling `useSceneNumbering` fails on Sonarr's side: retry once, then surface the failure in Sniparr's UI/logs (matches what we hit by hand tonight — the PUT can silently not take).

## Testing plan

SpongeBob is the live test case, already has 3 known-real gaps to validate against:
1. Run discovery end-to-end against the real TMDB data (groups already fetched and validated during design — see empirical results above)
2. Confirm scene numbers get written and `useSceneNumbering` persists
3. Confirm Sonarr's next scheduled search actually finds releases for currently-missing episodes
4. For the stuck-import path: re-trigger a known partial-pack scenario and confirm the fallback resolver correctly force-imports via the merged table

## Explicitly out of scope (YAGNI)

- No independent Prowlarr/SABnzbd download pipeline — considered and rejected in design discussion; reverses Sniparr's own documented "let the arr apps download" philosophy and isn't needed now that scene numbering handles the search-stage problem directly
- No support for Radarr/Lidarr/etc. in this pass — Sonarr only, per explicit scope decision
- No manual per-show TMDB group entry — fully automatic discovery replaces this
