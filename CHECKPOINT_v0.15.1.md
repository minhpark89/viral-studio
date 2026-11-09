# Viral Studio 0.15.1 — unified News/Product and Windows portability

This is the unified successor prepared on 2026-11-09 from tag `v0.15.0` (commit `a32e0e2d7e4cc7a4025bcfc6c0f5dc04b7f7d8f0`). It incorporates the verified News fixes from the local KAD22P5 hotfix based on 0.10.1. No GitHub publication is implied by this document.

## Merge boundaries

- Keep Product Studio, Product Research/SQLite, Product image-aware Vietnamese LLM requests, daily/batch workflows and independent output directories from 0.15.0.
- Integrate only the DreamFace fresh-profile readiness and bounded LLM truncation recovery. Do not replace whole News/queue/production modules with 0.10.1 files.
- Preserve the V3 renderer, geometry, motion, colors and credits from 0.15.0, including its earlier headline height fix and News output-directory handling.
- The small portrait/empty-photo-space concern is a visual improvement proposal, not a renderer change in 0.15.1. Proposed future handling: cover suitable landscape photos; retain portrait/text images and fill their side space using a restrained blurred copy of that image. Keep verified subjects and do not fill an image target with unrelated images.

## Root causes on the new PC

1. Fresh DreamFace profiles opened Template and did not load My Image history; the old readiness condition timed out. Now open My Image after model hydration, wait for actual history, and recover matching existing receipts before considering a new submission.
2. The configured reasoning LLM exhausted its output allowance before returning JSON. On `finish_reason=length`, retry once with a larger allowance capped at 8192, under the same timeout/cancellation signal. Both attempts retain Product images, Vietnamese instructions and existing first-request budgets. HTTP errors and malformed JSON are not retried as budget errors.
3. Windows lacked the Visual C++ DLLs needed by whisper-cli (`0xC0000135`). The old package included Whisper/model but omitted this external prerequisite. Windows x64 packages now carry a pinned, signed Microsoft installer and probe/install/recheck it before starting work. See `THIRD_PARTY_WINDOWS.md`.
4. New workspaces now default to automatic encoder selection: use a GPU only after its real encode/decode probe passes, otherwise report CPU. Explicit GPU and CPU choices in existing workspaces remain unchanged.

The initial test video used three images because its original preparation targeted eight but LLM failures left only three approved/downloaded images. Retrying the render preserved those saved inputs. It was confirmed as `v3-single-pass`, `newsRenderStyle=v3`, with aligned captions; the hotfix did not change its navy background.

## Build and checks

Use Node >=22.12 (verified with Node 24.22.2). Run `npm ci`, `npm run setup:captions`, `npm run setup:windows`, `npm run build`, `npm test`, then `npm run pack:release`. Both Installer and Portable include the same app, caption assets and Windows prerequisite.

- 528/528 backend tests passed, including missing-DLL installation flow, cancellation, unsupported native failures, automatic CPU fallback, strict GPU mode, fresh DreamFace history, bounded retries and Product multimodal preservation.
- Browser suites passed: News Studio, saved News styles, independent workspaces/manual/Product navigation.
- Packaged News Studio test passed: native folder selection, shared style persistence, independent Product output and version 0.15.1.
- Local packaged CPU render diagnostic: 11/11 passed, 36.1 seconds.
- Product packaged test passed: SQLite persistence, missing-key handling, native external-link routing and Trends CSV chart.
- KAD22P5 packaged GPU diagnostic: 11/11 passed, 30.7 seconds, Intel QSV; caption runtime initialized successfully. Details and update verification are recorded in `RELEASE_VALIDATION_v0.15.1.json`.

## Continue on another PC

Use the 0.15.1 source commit/archive and its manifest, not the older 0.10.1 repair branch. Keep each PC's own `Viral Data`, credentials, profiles and output folders. Never copy the build PC's private data into an installer or open a second writing Store on a live data directory.

KAD22P5 is updated only after all jobs and production preparation are idle. Its data root remains `D:\Viral Studio\Viral Data`; the canonical shortcut targets `D:\Viral Studio\Viral Studio.exe`. Back up state after graceful shutdown and verify existing IDs/settings after restart. Windows runtime/hardware behavior is tested as documented; no claim is made that all Windows versions, GPUs or third-party account states have been tested.

The completed KAD22P5 upgrade retained 1 project, 16 accounts, 42 media, 13 jobs, 10 research results, 1 production batch and 2 social posts, with zero missing original IDs. The saved LLM key and explicit GPU preference are unchanged. The interactive desktop screenshot confirms the News Studio/Product Studio navigation, version 0.15.1 and Intel GPU indicator. Old executables and state are retained under `D:\Viral Studio Support\2026-11-09\before-unified-0.15.1`; only the canonical current EXE remains in the app folder. No new paid generation or publishing was triggered for this upgrade.
