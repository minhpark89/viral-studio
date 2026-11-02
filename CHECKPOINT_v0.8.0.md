# Viral Studio v0.8.0 — verified Windows release

## Profile creation and storage

Optimization is enabled by default for existing and future profiles. Bulk creation creates distinct account/credential records without copying another profile's cache or login data. Browser data is created lazily at first open.

Real browser checks opened three new DreamFace profiles and two new Dola/Flow profiles, verified the actual cache-limit/model-restriction launch arguments, kept each profile's cookie/localStorage isolated, skipped cleanup while profiles were active, and reopened them after automatic removal of oversized cache/model fixtures. Login state and page operation survived. Failed browser launches released the shared profile lease for another attempt.

DreamFace and BrowserProfiles share installed Chrome/Edge discovery, including 32-bit installation paths and stale paths copied from another PC. This fixes a fresh-PC failure when Playwright Chromium has not been downloaded. Measuring a live cache also tolerates files/directories disappearing during browser eviction.

The packaged app created **20 additional slots through its API**, verified default optimization and no cloned browser directories, showed the detected GPU/driver, and correctly skipped an externally opened Chrome profile during manual cleanup.

## Portable concurrency fix

Before this fix, concurrent launches of the same Portable build extracted into the same temporary runtime directory; a second extraction could replace/remove the first process's FFmpeg and fail its GPU check. The final build was tested with overlapping CPU and GPU diagnostics. Their runtime directories were distinct, both completed all 11 checks, and one diagnostic exiting did not break the other.

Build detail: electron-builder is pinned to 26.15.3. Its installed implementation leaves UNPACK_DIR_NAME unset when portable.unpackDirName is true, selecting the NSIS per-launch plugin directory. This differs from the boolean wording in that dependency's type comments; the final Windows executable behavior was verified directly. Recheck this when upgrading electron-builder. NSIS documents the per-process temporary plugin directory in its [reference](https://nsis.sourceforge.io/Docs/Chapter4.html#varconstant).

## Final checks

- **319/319 automated tests** passed, including the five additional browser/profile checks.
- **11/11 GPU diagnostic checks** and **11/11 CPU checks** passed concurrently in the final Portable EXE. GPU News covered five direct-composed images and ten bounded-render images with complete order checks, audible audio, correct duration/codec, full decoding and a timeline with text/logo/music. Eight presenter geometries were also checked.
- **71 server/desktop/shared files** in the packaged archive matched source; no workspace/account data was bundled.
- The actual Installer was installed and launched. GPU readiness, settings, existing video playback/seek and all workspace collections were verified. **14218 data-file hashes** were checked after startup against a fresh backup; the workspace database was also compared structurally. No cleanup of user profiles was performed as part of this release installation.
- Final app.asar SHA-256: d47a6f6aa79039eb5f5b7224ab38c00bdeb286acc1209a5d5d245c5468745b50.

NVIDIA RTX 3060 NVENC was verified with WHQL driver 621.01. AMD AMF/Intel QSV selection and failure behavior have automated coverage, but those GPUs were not physically tested in this release session. Each PC performs its own real encode/decode probe before declaring GPU readiness.

Prior measurements of the same renderer: one cached 12-video batch took about 200 seconds with GPU/direct composition versus 225 seconds on v0.7.8 CPU. Direct composition used more RAM; low-memory PCs and larger image sets retain the bounded path. These are earlier single-run measurements, not a new 0.8.0 benchmark or a guarantee for other machines. Earlier safe trimming of 23 profiles reduced 7.70 GB to 0.82 GB, with protected data retained.

## Assets and data

The release includes Installer, Portable, installer blockmap/update metadata, SHA256SUMS.txt, Test-Render-Windows.ps1, WINDOWS_GPU_PROFILE_GUIDE.md, release notes and this checkpoint. It excludes user data, browser profiles, credentials, local backups and private diagnostic artifacts. NVIDIA driver installers are not bundled; use the app's official-driver guidance.

Back up data and close profiles before upgrading. Cookies and website data are preserved locally, but Windows/Chrome encryption can require sign-in again when moving a profile to another PC. Cache limits cover regenerable caches, not all website/user data. Run the attached script with -Gpu to test hardware encoding on each additional PC.
