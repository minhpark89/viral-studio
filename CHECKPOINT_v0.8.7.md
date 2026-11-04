# Viral Studio v0.8.7 — verified Windows release

This release combines the post-scroll, historical Page reference, image-variety, account-check/quota recovery and posting-cadence changes on top of v0.8.6. Package and lockfile versions are 0.8.7.

## Verification

- All **379 automated tests passed**. Another 22 targeted tests passed with a clean, physical dependency installation from the lockfile.
- The browser account fixture sent four real POST requests through the local HTTP server and completed 4/4 checks, distinguishing one ready profile from three needing attention. Error, quota and verification filters passed at normal and compact window sizes.
- **14 wheel/control checks across five viewport sizes** passed, including nested post-table scrolling, the last row's details, pagination, Page/token lists, group dialogs and sidebar navigation.
- The actual **Portable 0.8.7 EXE** started its own isolated workspace, served the correct version, displayed account filters and post management, and closed cleanly. No production data was used in this smoke test.
- The same Portable passed **11 GPU and 11 CPU offline render checks**. These include eight presenter geometries, portrait/landscape full news compositions and a timeline with text, logo and looped music. Outputs were fully decoded and checked for dimensions, H.264/AAC audio/video and duration. GPU compositions additionally verified the order of five and ten images.
- GPU test duration, including fixture creation, decoding and inspection: 170.3 seconds. CPU test duration: 83.5 seconds. These diagnostic totals are not production-render benchmarks.
- NVIDIA RTX 3060 NVENC was physically verified. AMD AMF and Intel QSV were not physically tested in this release session; the app runs its own encode/decode probe on each PC.
- 89 packaged application/frontend files match the release source, and all 80 installed production dependencies match the lockfile. FFmpeg/ffprobe match the bundled binaries. The Installer's extracted application archive exactly matches the verified Portable build.

## Overnight render audit

All 23 original completed jobs used NVIDIA h264_nvenc. Presenter duration averaged 16.33 seconds. After verified MC download, completion took 42.44 seconds on average (26.02–56.56 seconds); this includes composition, encoding, media import and any render-slot waiting. Provider submission through verified download averaged 150.97 seconds. Active jobs averaged 214.61 seconds, excluding research/image preparation and initial queue time. The original batch spanned 102.93 minutes including preparation overlap, retries and maintenance/editorial pauses. Final corrective edits are outside these original-job timings.

## Package contents and limits

Release assets include Installer, Portable, installer blockmap, latest.yml, SHA256SUMS.txt, the offline render script, GPU/profile guide, release notes and this checkpoint. Workspace data, credentials, browser profiles, media and private diagnostic reports are excluded.

Automatic DreamFace quota checks run every 30 minutes while open and resume overdue checks on startup. Readiness requires actual usable allowance; calendar rollover does not guarantee provider credits. Login/verification and unavailable model options remain actionable errors. Failed generation jobs are not automatically resubmitted.

Runtime SHA-256: `db24ac48e38667f5542b2d17a34ee4407c103fb8c522b9784d9f71b7316c54fe`.
