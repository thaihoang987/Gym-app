# Gym App

Self-hosted, local-first family workout tracker. React frontend + Express backend + SQLite.

## Stack & Structure
- `src/main.jsx` — entire React frontend (single large file, ~7600+ lines): workout logger, routines/groups, scheduling, analytics, settings, offline sync logic
- `src/i18n.js`, `src/muscleMapping.js`, `src/bodyHighlighterPaths.js` — translations, muscle heatmap mapping/SVG paths
- `server/index.js` — Express API
- `server/db.js` — SQLite (better-sqlite3) schema/access
- `hasaneyldrm-exercises-dataset/` — bundled third-party exercise GIF dataset (non-commercial use only, see `THIRD_PARTY_NOTICES.md`)
- `docker-compose.yml`, `Dockerfile` — image build (`ghcr.io/thaihoang987/gym-app`)
- `unraid-template.xml`, `ca_profile.xml` — Unraid Community Apps submission files
- `casaos-appstore/app/` — staged files for CasaOS App Store submission (not yet PR'd)

## Offline-first architecture (src/main.jsx)
- `api(path, options)` (~line 1723) — wraps `fetch`; on failure while offline, queues mutation via `addToOfflineQueue`
- `addToOfflineQueue(userId, entry)` (~line 467) — pushes to per-user localStorage queue, with type-specific dedup/merge (e.g. `settingsUpdate`, `manualSetUpdate`, `exercisePreferenceUpdate`)
- `flushOfflineQueue(userId)` (~line 528) — replays queue against real API when back online (`offlineQueue: false`)
- `pendingOfflineState(userId)` (~line 654) — derives pending-state collections from raw queue
- `applyOfflineQueueToCachedApi(path, data)` (~line 925) — overlays pending offline mutations onto cached API responses for display
- `API_CACHE_GET_PATTERNS` / `WORKOUT_CACHE_PATTERNS` (~line 1298) — which GET responses get cached to localStorage for offline fallback
- `clearWorkoutApiCaches(userId)` (~line 1305) — clears cached workout data; be careful not to call this for handlers that need to preserve cached fields (e.g. manual-set/preference offline queuing)

When adding a new mutation endpoint that should work offline, follow this same pattern: queue handler in `api()` catch block → dedup/merge in `addToOfflineQueue` → replay case in `flushOfflineQueue` → overlay in `applyOfflineQueueToCachedApi` if it affects cached GET data.

## Workflow rules for code changes
1. Every fix bumps the **patch version** in both `package.json` and `package-lock.json` (root `version` AND `packages[""].version`)
2. `npm run build` to verify it compiles
3. Commit locally
4. **Do NOT `git push` unless the user explicitly says "push"** for that specific request
5. When pushing: remote is `origin` → `https://github.com/thaihoang987/Gym-app.git`, branch `main`. **Always verify `pwd` is `D:\Project\Gym` / `/d/Project/Gym` before git commands** — cwd can reset to a different project between tool calls
6. After commit (and build), restart dev server to refresh `__APP_VERSION__`:
   ```powershell
   taskkill /F /IM node.exe; cd D:\Project\Gym; npm run dev
   ```
   Verify via output: "Gym App listening on http://localhost:3001" + correct version. A "failed" exit code from `taskkill` (when no node process exists) is normal — judge success by the dev server output.

## Distribution
- Docker image auto-built/pushed to GHCR via `.github/workflows/docker.yml` on push to `main` and on `v*.*.*` tags (single-arch, amd64 only)
- Unraid Community Apps: auto-approved submission, reads `unraid-template.xml` directly from raw GitHub — pushing changes to that file updates Unraid's listing within minutes to ~1 hour, no resubmission needed
- CasaOS App Store: staged in `casaos-appstore/app/`, requires forking `IceWhaleTech/CasaOS-AppStore` and PR (manual, not yet done)

## Licensing care
- The bundled exercise dataset (`hasaneyldrm-exercises-dataset/`) is third-party, non-commercial — avoid making unverifiable marketing claims about exercise counts (e.g. do not reintroduce "1300+ exercises") in descriptions/templates
