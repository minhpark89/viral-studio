# Viral Studio v0.7.8 — 2026-11-02

## User-visible behavior

News videos are short summaries that lead to the full article in the first comment. Research and News Render expose automatic duration (roughly 15–30 seconds), 15/20/30-second script targets, and automatic or up-to-6/8/10 image targets. Exact length follows the MC voice; local composition holds the closing frame/audio padding if necessary to reach 15 seconds. Queue displays processing time and actual clip length separately.

The narration writer retains complete source-grounded sentences and the complete CTA. It no longer adds invented uncertainty or filler, and the provider no longer silently slices a script mid-sentence.

## Provider correctness

- MC Image waits for DreamFace model/history hydration, checks that the prompt survived, and requires submission acknowledgement. A saved matching request can be recovered without another image generation.
- Avatar submission records the exact task ID, profile and normalized narration hash. The submitted payload must contain that narration. Downloads come only from the matching completed `ADVANCED_AVATAR` work's official download button.
- Existing video URLs, matching title fragments and page-wide downloads are never accepted as the new MC. The live test caught this pre-existing bug when an exhausted profile opened the credits drawer and the old implementation downloaded a prior video.
- An insufficient-credit drawer reports `PROVIDER_QUOTA`; missing acknowledgement is `PROVIDER_SUBMISSION_UNCONFIRMED`. A confirmed task can resume on browser restart without another submission. Old records without a reliable task receipt cannot be recovered by a loose title match.
- Hidden Avatar browser sessions close before local rendering; visible user-opened sessions are preserved.
- The provider explicitly selects Text when a profile remembers Audio, and records the actual free/credits button label instead of labeling every task free. Readiness errors inspect the browser body through Playwright, avoiding a Node-side `document` error.

Free limits were checked in the real provider UI on 2026-11-02: standard Avatar is 30 seconds/500 characters; 3.0 Fast has separate daily eligibility and currently exposes 2,000 characters/180-second audio selection. The Free profile showed one daily use. A 181-second test upload selected only 180 seconds; no generation was submitted. See the Windows guide for source links and the distinction between composer limits and an actual completed long free render. News retains its conservative 24-second automatic script target and 500-character cap.

Core code: `server/dreamface-image.js`, `server/dreamface-news-result.js`, `server/providers/dreamface.js`.

## Illustrations and rendering

Source discovery reads Open Graph images, article JSON-LD image galleries and captioned figures inside the article body. Candidates retain separate image identities even when they share one article page. Search retains full names and city/state qualifiers, distributes results across queries, and adds explicit context queries.

Ranking uses groups of at most 12 compact candidates, reducing model gateway timeouts. It rejects unrelated events and similar images, and exact file hashes reject duplicate downloads. Context imagery is visibly labeled. Source shortages and ranking failures are shown; the target is not filled with unrelated images.

The renderer prepares photos individually, merges clips in pairs, then adds the presenter and graphics. This limits simultaneous high-resolution image decoders and large filter graphs. The 10-photo regression test verifies every photo, including photos 6–10, in order with the correct duration. Actual shot count is saved with the output; shots stay at least approximately 2.5 seconds long.

Core code: `shared/news-format.js`, `server/news-plan.js`, `server/news-visuals.js`, `server/image-search.js`, `server/production.js`, `server/news-motion.js`, `server/news-render.js`.

## Installation and data

The old NSIS uninstaller removed custom `Viral Data` stored inside the install directory even with `/KEEP_APP_DATA`. The new installer preserves named legacy data folders in an adjacent `.data` directory on the same volume before invoking that uninstaller. It stops on conflicting copies or a failed move. A UTF-16 data-location pointer preserves Unicode paths and locations across subsequent installs.

Portable data remains beside the portable EXE. Installed data defaults outside the removable program directory. Existing media paths are relinked by the prior portability migration. Use the default per-user installation for Windows testing.

Core code: `build/installer.nsh`, `desktop/data-directory.cjs`, `tests/data-portability.test.js`.

## Verification

- All 303 automated tests passed, including exact Avatar task/payload matching, submission recovery, data portability and the 10-photo sequence.
- The final portable EXE passed all 11 offline render checks with the bundled FFmpeg/ffprobe. Thirteen packaged application modules were compared with the tested source; installer/updater hashes match.
- A real News render produced a different, correctly matched MC: one acknowledged DreamFace request with the intended narration, 16.9-second 1080×1920 H.264/AAC output, four relevant context photos, complete decode and audio.
- The live request payload shape was checked again with submission intercepted before reaching DreamFace: the exact text is in `media.texts[0].text`; no additional generation was created by that probe.
- The first installed upgrade preserved all 9,838 existing data files byte-for-byte and retained 14 accounts, one project, 24 media and 12 jobs. Subsequent test output adds six media and one job. Final install checks use a separate verified incremental backup.
- Reinstallation preserved all 10,300 files in the next backup; the final release install preserved all 10,322 files after the provider limit inspection. Installed UI checks verified version, valid media paths, duration/image controls, quota explanation, queue timing labels and playback/seek of the 16.9-second clip, with no browser errors.
- Run the offline `Test-Render-Windows.ps1` from this release against the actual EXE on every additional PC. It checks eight presenter geometries, two full News compositions and a timeline export, without provider calls or publishing.
- The verification runs do not publish website articles or social posts. Development caches, credentials, browser profiles, copied user data and local investigation reports are excluded from release assets. The application runtime and FFmpeg/ffprobe are bundled.

External service login, network availability, quota and GUI changes remain separate from local FFmpeg compatibility. Image targets and narration-duration targets are not guarantees of a particular source's available photos or an exact speaking speed.
