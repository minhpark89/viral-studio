# Viral Studio v0.8.8 — release and continuation checkpoint

Start here when resuming work or investigating cleanup. Source is the v0.8.8 tag / corresponding main commit in minhpark89/viral-studio. This release extends v0.8.7 with automatic cleanup of generated raw news presenters after successful publication. Package and lockfile versions are 0.8.8; dependency versions are unchanged.

## Behavior and implementation

- server/published-media.js owns provenance, reference/path guards, read-only previews, deletion and periodic cleanup. Confirmed publication requires published video, published first comment and an external post ID.
- server/meta.js captures lineage before publication cleanup and keeps it across comment retries. server/news-render.js records newsPresenterMediaId on each new output. server/post-lifecycle.js exports cleanup alongside existing post lifecycle logic.
- server/index.js starts the sweep on server startup and every five minutes, exposes GET /api/storage/published-media and POST /api/storage/published-media/clean, and closes the worker on shutdown.
- Stored mediaCleanup.lineage tracks producer jobs, presenter media and explicitly verified superseded outputs even after the final output's media record is gone. Existing legacy job references can supply missing lineage. Missing/ambiguous historical replacements are not inferred from names or timestamps.
- Deletion checks drafts, timelines, unfinished work, production requests, account images and other outputs. Shared presenter media remains until all dependent output work is retired. Failed ancestors retire only through an unambiguous completed retry whose output was published.
- Only generated raw news-presenter videos are removed as MC inputs. Reusable MC images and user-imported presenter clips remain. Final output cleanup retains the existing publication behavior. Related thumbnails/previews follow exact paths; no directory-wide deletion occurs.
- Outside-workspace paths, symlinks/junctions, non-files and shared file aliases are refused. Reference checks and unlink operations are synchronous per media item, sweeps coalesce, and processing yields between publication records.

## Verification in this release

- **394/394 automated tests passed** with physical dependencies installed by npm ci from the lockfile and a completed frontend build. Release host Node.js was v26.13.0; .node-version remains pinned to 24.22.2 and engines supports >=22.12.0.
- tests/published-media.test.js covers final/MC/thumbnail deletion, shared and unfinished references, retries, restart recovery, path guards, provenance, changing references, overlapping sweeps and the actual HTTP endpoints. tests/meta.test.js verifies that MC media remains until the first comment succeeds.
- The actual **Portable 0.8.8 EXE** opened an isolated empty workspace, served version 0.8.8, ran startup cleanup, exposed the five-minute interval and passed an idempotent cleanup call. Account filters and post management displayed without page errors. No production accounts or external posting were used.
- 90 packaged application/frontend files match source. 80 production dependency versions match the lockfile. FFmpeg/ffprobe match the bundled binaries; the Installer's extracted app.asar matches the verified Portable runtime.
- v0.8.7 previously passed 11 GPU and 11 CPU offline render cases on the release PC. These render suites were not rerun for this cleanup release; the rendering change only persists the presenter ID. No new performance benchmark is claimed.
- Runtime SHA-256: `c540cd68034a3dd91a197e051ed07e9b3919991b676cd2157cae7fc62c838512`.

## Reproduce and continue

1. Read this checkpoint and RELEASE_NOTES_v0.8.8.md, then inspect git status and the current commit before editing. Preserve unrelated local changes.
2. Use Node.js >=22.12.0 and the pinned lockfile. Run npm ci, npm run build, then npm test. Build before testing because the HTTP preview test needs dist. Use a physical node_modules directory for Windows packaging; a junction previously caused missing transitive production dependencies.
3. Run npm run pack:release for Installer and Portable. Compare packaged source/dependency/binary hashes and smoke-test the real executable with a separate STUDIO_DATA_DIR and desktop user-data-dir. Never point a diagnostic fixture at the live workspace.
4. For cleanup problems, identify the running app's actual data root and .server-instance.json. Inspect publication.mediaCleanup, saved lineage, current media records and reference guards. GET /api/storage/published-media reports pending candidates and refusal reasons without deleting. POST /api/storage/published-media/clean retries only eligible confirmed publications.
5. Preserve the current workspace before repairs. Reproduce failures in a copy with external providers/publishing disabled. Do not rerun historical migration scripts or remove files merely because their titles match.
6. Reverting app code does not restore files already deleted after successful publication. An old metadata snapshot may reintroduce dead paths. A full restore needs matching file backups and must preserve current publication history to avoid duplicate posts.

## Release contents

Installer, Portable, installer blockmap, latest.yml, SHA256SUMS.txt, offline render-check script, GPU/profile guide, release notes and this checkpoint. No workspace, browser profiles, credentials, media, private migration IDs or production snapshots are included. Local machine-specific operational checkpoints remain outside the public repository.
