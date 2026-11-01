# Viral Studio v0.7.5 — Research selection, deletion and portable testing

Release requested by the user on 1 November 2026. Includes the prior local news-image/Queue fix (`6f6a645262d987fb3fadff02568ccc93368f0a85`) on top of v0.7.4 and the new Research management actions.

Release page: https://github.com/minhpark89/viral-studio/releases/tag/v0.7.5

## User behavior

- Research cards start compact. Select an individual checkbox, the current page, or all filtered stories; clear the entire selection. Selection survives pagination/page-size/sort changes, and resets when project or filters change.
- The action toolbar sits beside the list and remains visible while scrolling on desktop. It shows selected and filtered counts plus the exact eligible story/video count. Bulk Render uses eligible selected stories, or the filtered scope when none are selected; completed and active stories are skipped. The 100-video limit and remaining story count are explicit.
- Each story has Delete, quick Render and **Chi tiết & MC**. Quick Render inherits the batch MC/count/content settings; expanded controls permit a separate per-story configuration and explicit re-render of completed stories.
- Bulk Delete confirms once and sends one request. It only removes the specified Research records. Videos, media, jobs, production batches and publication history remain intact. Active preparation/render stories are skipped with a count; another project's records invalidate the whole request before mutation.
- All prior image fallback, preparation visibility, MC rotation, playback and source-age fixes are included. See [news-image checkpoint](CHECKPOINT_2026-11-01_NEWS_IMAGES_QUEUE.md) and [v0.7.4 checkpoint](CHECKPOINT_2026-11-01_v0.7.4.md).

## Implementation

- `server/research-management.js`: bounded UUID/project validation, deduplication, active-state guards using the shared Research progress model, one save for eligible deletion, explicit missing/skipped results. Handles pending/preparing production before job creation and active retry lineage.
- `POST /api/research/delete`: `{projectId, ids}` → `{deletedIds, skipped, missingIds}`. Idempotent when an item is already gone. Existing `DELETE /api/research/:id` now uses the same preparation/render guard.
- `src/pages/Research.jsx`, `research.css`: compact rows, per-story actions, page/filter selection and partial-checkbox state, sticky action bar, safe selection scope, bulk deletion progress and count feedback. Full MC/media/source controls remain available via expansion.
- No persisted schema migration or new dependencies. Package and lockfile version are 0.7.5.

## Verification

- Build and 259 automatic tests passed (zero failures/skips). New tests cover exact deletion scope, a single save, media/history preservation, pending/preparing guards, retry lineage, cross-project rejection and repeated deletion.
- `tests/research-selection-browser.mjs`: seven workflows passed against real local API/SSE: selection across pages, filter scope, bulk deletion with active skips, single-delete guard, cancel/confirm per-story deletion, exact selected render payload/MC/count and quick/per-story controls. Narrow screen had no horizontal overflow.
- Existing Research manager and Queue preparation browser suites passed (six checks each).
- Packaged Electron passed MC rotation/100-story Research (five workflows) and media playback/seeking/library/individual and bulk MC flows (seven workflows). Render submission is intercepted in these fixtures; no external DreamFace work or publication is created.
- Actual Portable executable launched from a new folder with an empty `Viral Data` directory. Verified version, empty accounts/media/jobs/Research, no inherited LLM key, UI startup and bundled FFmpeg/ffprobe binaries inside the extracted Portable runtime. Existing production data stayed unchanged. This was an isolated test on the current Windows PC, not a physical second PC.
- Archive verification compared 69 runtime/font files with source, retained prior rendering/MC fixes, and excluded workspace data. Installer, Portable, blockmap, update metadata, SHA-256 sums and Windows test guide are release artifacts.
- Installed upgrade verified read-only against a fresh pre-install snapshot: version 0.7.5, new Research selection/expand controls, prior preparation failures and retry buttons, completed-video Play/seek, exact archive hash and deep equality of all persisted data values. No production Research record was deleted during verification.

## Artifacts

- Installer: `release/v0.7.5/Viral.Studio.Setup.0.7.5.exe`; SHA-256 `e53d9c3702b1d5801537c3e17eda2f326486ac5ccad522a7aa58d18773e197dd`.
- Portable: `release/v0.7.5/Viral.Studio.0.7.5.exe`; SHA-256 `e1bceb3105421470e3f71b7460500b838fe255accd9d6b5e4a6012ea4796c14b`.
- App archive SHA-256 `70f5c101dd658b658ae0f1e18d4e507de27eed4f37702db2d176015ec7986f9a`.
- [Windows test guide](WINDOWS_TEST_GUIDE_v0.7.5.md) explains a separate Portable workspace and the exact selection/delete/render test sequence. Fresh test data requires its own configured LLM/provider login.
- Private installation/verification evidence and a fresh pre-install backup are under workspace `.maintenance/v0.7.5`. Backups contain account settings: keep them local. Read the current server-owner file for address/PID rather than reusing a prior checkpoint's values.
