# Viral Studio v0.8.0

GPU rendering and profile storage optimization now apply to both existing and newly created profiles.

- News and timeline use NVIDIA NVENC, AMD AMF or Intel QSV only after a real encode/decode probe. Settings show the detected GPU and official driver guidance; NVIDIA lookup confirms model support before suggesting a specific package. GPU-required mode reports failure before requesting a new presenter and preserves cached inputs for retry. CPU compatibility remains an explicit option.
- News with up to five images can compose directly when available RAM covers the configured render workers. Larger stories and low-memory PCs retain the bounded rendering path. Effects and audio still use CPU where needed.
- Every new profile receives the same HTTP/media cache limits and on-device model restrictions at first launch. Oversized allowlisted caches are trimmed before opening; small warm caches are retained. Cleanup skips running/busy profiles or unverified process state and does not follow cache junctions/symlinks.
- Cookies, saved passwords, local storage, IndexedDB, Service Worker data, sessions, preferences and extensions are retained. Cache limits do not impose a hard limit on website/user data. A first page load after cleanup can take longer.
- DreamFace and the profile manager now share browser discovery. Valid configured paths are respected; stale paths copied from another PC fall back to installed Chrome/Edge. A separate Playwright Chromium download is unnecessary when a supported installed browser is available.
- The offline EXE diagnostic accepts `-Gpu` to verify GPU News with five/ten images, image order, audio, full decoding and timeline rendering without provider accounts or credits.
- Each Portable launch extracts its runtime to a separate temporary directory. Opening another instance no longer replaces or removes the FFmpeg files of a running instance.

On the measured RTX 3060 machine, a cached 12-video batch took about 200 seconds versus 225 seconds with v0.7.8 CPU rendering. This is a single-run comparison; direct composition used more RAM. Trimming 23 existing profiles reduced their total from 7.70 GB to 0.82 GB while protected data hashes remained unchanged. Results depend on machine and workload.

NVIDIA RTX 3060 NVENC has been tested on physical hardware. AMD/Intel paths require successful testing on each target PC and have not been physically verified in this release session. Some GPUs/drivers lack a compatible hardware encoder; GPU mode reports this rather than silently switching to CPU.

Download the Installer for normal installation or Portable for a separate adjacent workspace. Back up data and close the app/profiles before upgrading. See the attached GPU/profile guide, offline test script, verification checkpoint and SHA-256 checksums.
