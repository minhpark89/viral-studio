# News image preparation and Queue visibility — 1 November 2026

Superseded by [v0.7.5](CHECKPOINT_2026-11-01_v0.7.5.md), which includes these fixes and the new Research selection/deletion workflow. The local-only release status below describes the earlier checkpoint.

Local fix on top of public v0.7.4 (`3c732af909119d7d59b8c3744728baea8bb6cfeb`). Installed locally; no GitHub release assets replaced and no remote push. Package version remains 0.7.4. Previous release context: [v0.7.4 checkpoint](CHECKPOINT_2026-11-01_v0.7.4.md).

## Problem and behavior

- Coin reports without article photos failed before creating a render job. Wikimedia results were accidentally ordered by numeric page ID, so old/unrelated files displaced relevant results. A large rejected cache prevented fresh search. Preparation items were absent from Queue, making both running preparation and early failures look like missing work.
- Wikimedia parsing now preserves relevance via `page.index`, includes source description/canonical URL/original image URL, and can fall back from an unavailable thumbnail to the original download. Query-level cache deduplicates requests for five minutes.
- `server/news-visuals.js` supplies short subject queries and bounded article Open Graph lookup. Production re-searches rejected cached candidates, then ranks exact-subject context imagery. Search terms alone are not relevance evidence. Never re-add rejected unrelated images.
- Context imagery is visibly labeled `CONTEXT IMAGE / NOT EVENT FOOTAGE`. Non-article search imagery is labeled even when the first ranking pass accepts it. If no usable relevant image can be downloaded, `createNewsSourceCard` builds a source/headline card with `SOURCE SUMMARY / NO EVENT PHOTO`; the MC video can continue. No invented price charts or fake event photographs.
- Preserve `visualMode` through the plan, batch cache and production metadata. Cache revision 3 includes diagnostics; per-batch/per-research separation, MC rotation and Page-avatar exclusions remain intact. Research shows the visual warning. Source cards remain editorial media, not MC or Page avatars.
- Persist preparation stages. `shared/queue-preparation.js` derives pending/preparing/failed/interrupted entries without duplicating linked jobs. Queue shows these entries within project, type, search, date and status filters, including errors before job creation. Retry calls the existing preparation-only batch endpoint. Interrupted jobs appear under Errors too.
- All news drawtext filters use literal expansion so percent signs in finance headlines render correctly.

## Verification

- `npm.cmd run build` passed.
- `node --test --test-timeout=180000 tests/*.test.js`: 255 passed, zero failures/skips.
- `node tests/queue-preparation-browser.mjs`: six browser checks passed, including immediate visibility, SSE stage changes, failure/retry, filters, job handoff and correct batch navigation.
- `node tests/research-manager-browser.mjs`: six existing workflow/browser checks passed.
- Replayed the two actual failing coin stories with the configured LLM and live image search in isolated stores. Both prepared labeled, relevant images and reached queued jobs. Provider queue stayed paused; no new DreamFace generation or publication was submitted.
- Exported and fully decoded two 1080×1920 H.264/AAC 12-second fixtures using a sample from an existing presenter: context images and source card. Inspected frames and literal `100%` text. These are technical fixtures, not newly generated production stories.
- Packaged Electron opened successfully, showed a failure before job creation, and built a source card using bundled fonts/FFmpeg.
- Installed app verified read-only: existing preparation failures and retry buttons visible, old completed video plays/seeks, all persisted production data deeply unchanged.

## Artifacts and continuation

- Installer: `release/news-images-20261101/Viral.Studio.Setup.0.7.4.image-fix.exe`.
- Installer SHA-256: `f7ed7d8997b3624ed9c134667b55181387a21654f40729794543cecc00843736`.
- Installed `app.asar` SHA-256: `0588cde22a943acd87d2b028a3d92a743a0a0e689fe0e3356d074e4afd888db5`.
- Detailed private evidence and fresh pre-install backup are outside the repo in the workspace `.maintenance/news-images-20261101` directory. The backup contains account settings; keep it local.
- Old failed attempts remain as history. Use Queue → Có lỗi → Render hôm nay → Thử lại bước chuẩn bị on the intended attempt. Do not automatically retry all historical batches.
- The public v0.7.4 installer predates this local fix. Do not reinstall it over the current local build when investigating this issue. Read the live server owner file afresh for PID/address; never hardcode a prior session's port.
