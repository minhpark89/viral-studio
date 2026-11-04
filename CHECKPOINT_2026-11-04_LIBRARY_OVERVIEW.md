Published as v0.9.0: use [the release checkpoint](CHECKPOINT_v0.9.0.md) for current build/continuation instructions. The implementation record below describes its earlier local validation.

# Library cleanup and Meta overview — local 0.8.9-local.1

This local change builds on public v0.8.8. No new GitHub release was requested for this work.

Library now paginates at 48 cards, selects all matching media across pages in the current project, previews bulk deletion, reports protected files, and revalidates each media before deletion. The single-file route shares the same guards. Bulk requests yield between groups and rebuild the path index before continuing.

Published media cleanup version 3 persists editorial image IDs from output/job lineage as well as raw presenter IDs. Confirmed video + first-comment publication retires unreferenced generated MC and article illustration assets, with periodic/startup retry. Reusable MC images, imported clips, avatars, drafts, timelines, unfinished work and other outputs remain protected. Completed research image-ID lists are detached from removed assets; source text is retained for future research/reimport. Version-two cleanup records are revisited to recover image lineage from retained jobs.

Meta overview reads verified existing Page/token bindings using Authorization headers. It does not publish, generate, modify Page settings or change publisher metadata. It supports 7/28 completed reporting days, Page/group/search/status filters, per-Page details and charts, and local pagination. Followers are a current snapshot and historical chart points start when observed; view/engagement metrics use Meta's exclusive end dates in America/Los_Angeles. Missing, incomplete, stale and actual-zero values are distinct. Publishing restrictions/review do not exclude a Page from read-only monitoring; deleted Pages are excluded.

Server cache is separate meta-insights.json, bounded to four period snapshots and 90 follower observations. GET reads memory/cache only. Refresh is coalesced, uses at most three workers with one Page/token lane, combines daily view/engagement reads, respects rate headers and cooldowns, and supports cancellation. Cache writes are debounced; tokens and raw remote errors are never persisted or returned to the UI. UI refreshes Meta only while overview is visible and stale; it polls local progress while a refresh runs. Unsupported metrics are handled independently per credential.

Files: server/meta-insights.js, shared/meta-insights.js, src/pages/Overview.jsx + overview.css; server/published-media.js, server/index.js, src/pages/Library.jsx + library.css. meta.js exposes its existing verified-binding predicate; main.jsx adds navigation. Package/lockfile version is 0.8.9-local.1, with dependency versions unchanged.

Verification: 408 automated tests passed; focused UI fixture selected 120 items over three pages, previewed/cancelled, deleted 118 unreferenced items and preserved two protected items plus another project's ten items. A 30-Page fixture verified actual HTTP/UI integration, cached filtering with no extra Graph requests, zeros and layouts at 1440/900 pixels. Production validation and installation records are private in the local task checkpoint, outside this repository.

Continue by inspecting git status and reading the machine's CHECKPOINT_CURRENT.md for the authoritative worktree, installed hash and data root. Build frontend before npm test. Package from physical dependencies when producing a future release. Use isolated fixtures; never run migration or bulk deletion against live data as a test. Backing out code cannot restore already deleted files, and old metadata must not overwrite newer publication history.
