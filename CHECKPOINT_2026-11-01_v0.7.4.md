# Viral Studio v0.7.4 — MC rotation, Research batches and media fixes

Local continuation after release: [news image preparation and Queue visibility](CHECKPOINT_2026-11-01_NEWS_IMAGES_QUEUE.md). The installed local fix is newer than the public v0.7.4 assets described here.

## Scope

Release requested by the user on 1 November 2026. Includes the accumulated local v0.7.3 startup, narration, concurrency, Research management, playback and media separation fixes, plus editable Research counts and MC rotation for 100-video News batches.

Expected release: https://github.com/minhpark89/viral-studio/releases/tag/v0.7.4

## Behavior and implementation

- `shared/mc-rotation.js`: ordered MC assignment, up to 100 News videos. Each rotation entry has `avatarMediaId` and a positive integer `count`. Example A=10, B=20 gives A for videos 1–10, B for 11–30, then repeats. Assignments depend on video index, not profile/worker completion order.
- `shared/production-contracts.js`, `server/production.js`: `mcRotation` and optional ordered `researchIds` (one ID per video); a single batch spans all selected stories. Validate every MC/research project before creating work. Store the selected MC on each item, plan, job and production metadata; retries and restart preserve it. Product limit stays 50, News limit is 100. Narration/visual variants support index 100.
- `src/NewsMcPicker.jsx`: shared single-image/rotation controls for direct production, an individual Research story and bulk Research. Per-image count, add/remove, reorder, upload, preview of video ranges. Page avatars are excluded. Avoid clearing MC state in an effect on initial Research mount; the parent already keys workspaces by project/tab.
- `server/research-batches.js`: persistent background Research worker. `POST /api/research/batches` takes `requestId`, project, topic, feeds and count 1–100; endpoints `/retry` and `/cancel` operate on that batch. Each distinct current source becomes one research record. Discovery excludes source URLs/titles already saved in the project. Fewer matching sources produces an explicit shortage message, not duplicate stories. The worker saves each result, supports cancellation, and resumes interrupted work without recreating saved results.
- `server/research.js`: RSS cap increased from 40 to 150 items per feed within the existing byte limit; current-news discovery uses US Eastern calendar date. Batch requests reuse the verified existing LLM pipeline with abort support. Original `POST /api/research` remains compatible for callers that request a combined summary.
- `server/store.js`: only new persisted collection is `researchBatches`, initialized to `[]` for existing workspaces. Existing accounts, media, jobs, research and publishing data remain intact.
- Research UI accepts a numeric story target, shows background progress and a research-run filter, plus render-state/date/search filters and pagination. Bulk render skips stories already completed or active; explicit per-story Render again remains available. AI task concurrency and FFmpeg render concurrency are distinct settings.
- `shared/research-status.js`, `shared/source-context.js`: derive render/publication history, source dates and output versions from existing records. Cleaning an old video does not make its story appear new.
- `src/MediaPreview.jsx`, Library and Queue: inline final-video playback/seek, source/MC/version/date context and exact-file reveal via the canonical physical path. Library separates final videos, MC images, raw presenters, Page avatars and other assets.
- `server/production.js`, `server/news-plan.js`, `server/queue.js`: editorial image caches/promises scoped by batch + research; rank every candidate including article photos against narration; never fill rejected candidates with unrelated images. MC, Page avatars and other projects cannot enter editorial inputs. Versions of the same story may share its verified image set.
- `server/queue.js`, `server/render.js`: News and timeline exports share the selected FFmpeg concurrency limit. Release the DreamFace profile after the presenter is available; wait for an export slot independently. Filter-graph threads follow render settings. Cached presenter retries require no extra provider work.
- `desktop/main.cjs`: Windows software compositing and first-paint capture before showing splash/main; main waits for initial UI data. FFmpeg behavior is independent of Electron GPU settings.

## Verification

- 250 automated tests passed. New tests cover 100 real queued job records with 10/20/5 MC blocks, multiple stories, a failed item, retry and Store reload; no duplicate jobs or mixed editorial/MC inputs. Invalid counts, foreign-project MC/research and Page avatars are rejected before work starts.
- Research tests create 100 separate records from local RSS, skip them on the next run, report shortages, stop/resume an interrupted LLM call without duplicate records, and reject stale sources.
- `tests/rotation-browser.mjs`: local RSS/LLM HTTP fixtures, real Research API and persistence, editable 100-story target, research-run selection, MC add/reorder/preview, 100-video bulk/direct/single-story request payloads, separate concurrency settings and narrow-screen layout. Production submissions are intercepted here to avoid paid provider calls; backend production is covered separately by `mc-rotation.test.js`.
- `tests/media-flow-browser.mjs`: actual Electron inline play/seek, no popup, canonical exact-file reveal, separate Library categories, date filtering, chosen MC and counts on individual/bulk render, and MC upload auto-selection. Uses recent existing videos read-only in an isolated workspace.
- `tests/research-manager-browser.mjs`: history filters, search, pagination, mixed selections, cleaned-video history, failure navigation and SSE progress changes.
- `tests/workspaces-browser.mjs`: 11 checks across Research, LLM form, render/source link, navigation, current Page import/post management, Content, Product and offline profile creation. Updated stale selectors to the current UI.
- Packaged Electron runtime produced an actual 720×1280, 8-second timeline video and a 1080×1920 News video at visual variant 100. Both fully decoded without error. Mixed News/timeline rendering completed all three jobs with exactly two concurrent FFmpeg renders, matching the configured limit. Source workspace was untouched.
- Live read-only Google News discovery returned 39 distinct current US-news sources in this session; requesting 100 is a target, not a promise that 100 matching sources exist.
- Package verification compares every runtime/frontend file in ASAR with source/build and verifies version 0.7.4, preserved earlier rendering/startup fixes, `git diff --check` and artifact checksums.

## Build and next-session commands

```powershell
npm.cmd run build
node --test --test-timeout=180000 tests/*.test.js
node tests/research-manager-browser.mjs
node tests/workspaces-browser.mjs
node tests/rotation-browser.mjs
node node_modules/electron-builder/cli.js --win nsis portable --publish never --config.directories.output=release/v0.7.4 --config.electronDist=node_modules/electron/dist
```

For packaged UI verification, set `ROTATION_EXE` or `MEDIA_FLOW_EXE` to `release/v0.7.4/win-unpacked/Viral Studio.exe`, then run the respective browser script. `tests/media-flow-browser.mjs` uses the local installation's existing outputs and should be adapted if run on another PC.

Local-only evidence/backups live under the workspace root `.maintenance/v0.7.4`; helper scripts and isolated test data live in `studio/.verification`. These locations are excluded from Git. Never upload workspace JSON, browser profiles or credentials. The local root checkpoint records exact install/data/backup paths and deployment results.

Before investigating a new failure, read the final installation/release section below, identify the running `.server-instance.json`, and capture the failed batch/job ID. MC assignment is `batch.items[index].avatarMediaId` → `job.payload.avatarMediaId`; the story is `item.researchId` → `job.production.researchId`. Research progress is in `researchBatches`, render preparation in `productionBatches`. Preserve these records and media before retrying.

## Operational limits

Research depends on available current RSS stories and LLM availability. Feed fallback is shown explicitly and can be rewritten later. DreamFace concurrency depends on ready profiles and provider quotas; FFmpeg concurrency is a separate local setting. Verification used existing presenter clips and isolated mocks, without generating 100 paid DreamFace videos or posting to Facebook.

Existing completed videos are preserved; improved editorial selection applies to subsequent renders. A same-story variation may legitimately reuse an image while using another MC or narration.


## Release artifacts

- Viral.Studio.Setup.0.7.4.exe: SHA-256 3c356e1df4d09f62e6cde86dd7ac20ba18e836f4ea16a12ed5af9fb3dbfa3377
- Viral.Studio.0.7.4.exe: SHA-256 d555efdbf4eafb0d9fdc89f99d9f4121c1e099fe676e16ecd983830f0486ca83
- Viral.Studio.Setup.0.7.4.exe.blockmap: SHA-256 c084452399652894b24fe38fd491a5eb90af5fd3424fc9fea484d4b06b6acb31
- latest.yml: SHA-256 e7f3ced1effa853128a313803294c4ed23e1a3edb4c501e90ea44983d5b1925d

ASAR SHA-256: f5950e2c7dd823124d563c98c67b6fa0af4be67b9e4c4c84a3176a115e588996.

## Installed verification

Installed and opened v0.7.4 on the user's PC on 1 November 2026. Installed ASAR matches the release build. Read-only verification played and sought through all three recent completed videos, checked library separation, source-age filtering, editable Research count and both MC rotation controls. Existing data fields are unchanged; the only schema addition is an empty `researchBatches` collection. Counts remain 8 projects, 23 accounts, 121 media, 37 jobs, 18 research results, 37 production batches and 7 posts. The installed application remains open.

The final frontend build includes the fast-selection fix; the FFmpeg/queue/media/narration runtime files are byte-identical to the packaged runtime used for the actual render/concurrency tests. Final packaged UI checks passed again after that frontend change.
