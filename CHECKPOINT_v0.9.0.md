# Viral Studio v0.9.0 — release and continuation checkpoint

Resume from tag v0.9.0 / the corresponding main commit in minhpark89/viral-studio. This release publishes the library and Meta overview implementation first validated as 0.8.9-local.1, on top of public v0.8.8. Package/lockfile versions are 0.9.0; dependency versions and render composition/encoding are unchanged.

## What changed and where to investigate

- Library: src/pages/Library.jsx and library.css select all matching media across pages within the current project, render 48 cards per page, report storage by category, preview bulk deletion and display protected-item reasons. Changing filters/project clears selection. Confirmation revalidates each selected item.
- server/published-media.js implements both single/bulk deletion reference/path guards and published-media cleanup version 3. POST /api/media/delete-bulk accepts explicit IDs and preview:true for a dry run; DELETE /api/media/:id shares its guards. Bulk processing yields every 20 items and refreshes its path index.
- Saved publication.mediaCleanup.lineage includes editorialMediaIds alongside generated presenter, producer-job and superseded-output IDs. Saved output newsImageMediaIds / producer imageMediaIds recover older lineage; completed version-two records are reconsidered. Only confirmed video + first-comment success with an external post ID permits automatic cleanup.
- Automatic cleanup removes unreferenced final video, generated raw news MC, news-editorial images and related thumbnails/previews. It preserves reusable MC images, imported clips, avatars, drafts, timelines, unfinished work and other outputs. Research detaches removed image IDs while retaining source text and links. Ambiguous historical replacements are not guessed by name/date.
- Startup/every-five-minute sweep and GET /api/storage/published-media / POST /api/storage/published-media/clean are wired in server/index.js. GET is a preview; the POST retries eligible cleanup. Paths outside the workspace, symlinks/junctions, shared aliases and non-files are refused.
- Meta overview: server/meta-insights.js, shared/meta-insights.js, src/pages/Overview.jsx and overview.css. Existing verified Page/token bindings are reused through meta.js's usableTokenBinding. No generation, publishing or Page settings are changed by monitoring. Review/publishing restrictions must not hide a Page from monitoring; only deleted Pages are excluded.
- Current summed followers are distinct from follower growth. Views/engagement cover 7 or 28 completed reporting days in America/Los_Angeles with exclusive end dates. Missing, stale, unsupported, incomplete and actual zero are distinct; views are not relabeled as Reach. Historical follower points start when observed.
- Separate meta-insights.json cache retains four period snapshots and 90 follower observations. GET /api/meta/overview reads cache only. POST /api/meta/overview/refresh coalesces work, caps workers at three and one Page per token lane, combines daily metric reads and respects rate/cooldown headers; /cancel stops the refresh. Writes are debounced. Credentials and raw remote errors are never returned or cached.
- UI supports charts, Page/group/search/status filters, sorting and 25-row pagination. Auto-refresh runs only when the overview is visible and data is stale (15 minutes); local progress polling does not repeatedly call Graph.

## Verification

- **408/408 automated tests passed** after npm ci with physical dependencies and npm run build. Release host Node.js v26.13.0; .node-version pins 24.22.2 and engines supports >=22.12.0. Tests include editorial lineage, safe bulk cleanup, reference/path guards, Pacific reporting dates, missing/zero metrics, cache/restart, concurrent/rate-limited/cancelled refreshes, and monitoring review Pages.
- Actual Portable 0.9.0 opened an isolated synthetic workspace. It selected 60 media over two pages, previewed/cancelled, deleted 58 eligible fixture files and preserved two referenced items plus another project's ten files with unchanged hashes. Accounts filters, post manager and startup/idempotent cleanup passed.
- Native Meta overview displayed the empty state with missing values as dashes, switched between 7/28 days and made zero external metric calls in the credential-free smoke workspace. Earlier implementation validation separately covered populated charts, filters, real zeros, responsive layouts and authorized live Meta reads; no additional live metrics were needed for this version-only packaging step.
- 92 packaged application/frontend files match release source. 80 production dependency versions match the lockfile; bundled FFmpeg/ffprobe match their source binaries. The extracted Installer runtime matches the verified Portable runtime. Workspace/profile/media/credential files are excluded.
- Runtime SHA-256: `635e249eb51190c5ea6963451cc4d613ca4e6ec94c426d8b64654b97b248febc`.
- v0.8.7 previously passed 11 GPU and 11 CPU offline render cases on the release PC. No new performance benchmark or GPU hardware coverage is claimed in this release.

## Next session and recovery

1. Read this document and RELEASE_NOTES_v0.9.0.md, inspect git status/current branch and the actual installed version before editing. On the release PC also read its local CHECKPOINT_CURRENT.md for authoritative paths, installed hash and private audit evidence. GitHub publication and local installation are separate states.
2. Reproduce in an isolated workspace with external publishing/providers disabled. Use Node >=22.12.0 and the lockfile: npm ci, npm run build, npm test. Build first because HTTP preview tests need dist. Windows packaging needs physical node_modules; a junction previously omitted transitive production dependencies.
3. For cleanup problems inspect the actual workspace/.server-instance.json, publication.mediaCleanup.lineage, references and the read-only preview endpoint. Confirm first-comment success. Use POST /api/media/delete-bulk with preview:true and explicit fixture IDs for bulk-deletion diagnostics. Never run historical private migration scripts or destructive tests against the live workspace.
4. For overview problems inspect the requested reporting period, cache timestamps, coverage/status and the verified binding fingerprint. Review Pages remain eligible. A failed same-period refresh can show stale last-good data, but another period cannot reuse the old totals. Keep token values out of logs, screenshots, reports and issues.
5. Preserve the current workspace before repairs. Reverting app code does not restore deleted media. Restoring old metadata alone can resurrect missing paths and lose publication history, risking duplicate posts; restore matching file backups only when needed and preserve newer publication IDs.
6. npm run pack:release builds Installer/Portable. Verify source/dependency/binary hashes and launch the actual EXE using separate STUDIO_DATA_DIR and --user-data-dir paths. Publish fixes as a new version after authorization; never overwrite v0.9.0's tested tag/assets.

## Release files

Installer, Portable, installer blockmap, latest.yml, SHA256SUMS.txt, offline render-check script, GPU/profile guide, release notes and this checkpoint. Source is in the repository/tag; machine-specific operational checkpoints and private data stay outside the public repository.
