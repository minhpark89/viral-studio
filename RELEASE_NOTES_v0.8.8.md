# Viral Studio 0.8.8

Published news videos now clean up their generated raw presenter clips as well as the final video, so completed work does not keep accumulating local video files.

## Changes

- Capture the output/job/presenter relationship before removing the final media record. New news outputs also save their presenter ID explicitly.
- Remove unreferenced final video, generated raw news MC and their thumbnails/previews only after both video publication and the first comment are confirmed successful. Publication history and external links remain available.
- Resume cleanup at startup and every five minutes while the app is open. Locked files and temporarily shared media can be reconsidered later.
- Preserve media used by drafts, timelines, unfinished jobs, production requests or another output; preserve reusable MC images and uploaded presenter clips. A failed retry chain retires only when its unique completed retry was published.
- Guard against paths outside the workspace, symbolic links/junctions, shared file paths and concurrent cleanup requests. Explicitly recorded superseded news outputs can be retired; unrelated versions are preserved.
- Add local preview and cleanup endpoints: GET /api/storage/published-media and POST /api/storage/published-media/clean.

Existing profile cache optimization and all v0.8.7 account, scrolling, Page-reference and news-image fixes remain included.

## Upgrade behavior

Existing published items are reconsidered when their saved job/presenter relationship can still be established. Old manually replaced videos with missing provenance are retained rather than matched by title. This release does not bundle private historical migrations, credentials, profiles or workspace data.

The Installer updates an installed app; the Portable executable uses its own adjacent workspace. Keep a workspace backup when changing machines or installations. Media already removed after publication cannot be recovered merely by downgrading the app or restoring metadata.

See CHECKPOINT_v0.8.8.md for verification and continuation instructions, and SHA256SUMS.txt to verify downloads.
