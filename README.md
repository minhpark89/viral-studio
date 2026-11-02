# Viral Studio

Viral Studio is a Windows desktop app for research, AI video production, timeline editing, Facebook Page management, post planning and Meta publishing preparation.

This checkout contains **0.7.9-local.1**, a local GPU/profile-storage build based on v0.7.8. Its installer and portable executable are in `release/v0.7.9-local.1`; this build has not been published. See [GPU setup and profile storage](WINDOWS_GPU_PROFILE_GUIDE.md). The public download links below still refer to v0.7.8.

## Download for Windows

- [Portable v0.7.8](https://github.com/minhpark89/viral-studio/releases/download/v0.7.8/Viral.Studio.0.7.8.exe)
- [Installer v0.7.8](https://github.com/minhpark89/viral-studio/releases/download/v0.7.8/Viral.Studio.Setup.0.7.8.exe)
- [SHA-256 checksums](https://github.com/minhpark89/viral-studio/releases/download/v0.7.8/SHA256SUMS.txt)

The portable app keeps `Viral Data` beside its EXE. Installed data lives in a sibling `Viral Studio.data` folder outside the app installation; the installer preserves legacy data before running the old uninstaller. The app can still discover legacy `Dropship Data`.

## Included features

- News clips summarize the source and direct viewers to the full article in the first comment. Choose automatic pacing (approximately 15–30 seconds) or a 15/20/30-second script target. Actual duration follows the voice; short results hold the closing CTA to reach at least 15 seconds. Queue distinguishes processing time from actual clip duration.
- Choose up to 6, 8 or 10 illustrations, or let duration determine the target. Source galleries and captions, full-name/context queries, relevance ranking and duplicate checks improve variety. The app reports shortages instead of filling them with unrelated photos. Shot length stays at least about 2.5 seconds; actual image count is saved with the output.
- News with one to five photos can compose directly when free RAM covers the configured workers. Larger stories or lower-memory PCs render photos individually with pairwise transitions; an allocation failure retries that bounded path using the same cached inputs and encoder. DreamFace MC image creation waits for page readiness and submission acknowledgement; retry can recover a matching submitted image without generating another one.
- News and timeline select a GPU encoder only after a real 1080x1920 encode/decode probe. NVIDIA NVENC, AMD AMF and Intel QSV have separate arguments. GPU-required mode reports driver/hardware problems before requesting a new MC; CPU compatibility mode is an explicit user choice. Settings show the detected GPU, driver guidance and official download links. RTX 3060 NVENC has been tested on this PC; AMD/Intel still need physical-device verification.
- Profile storage retains login data and small warm caches. Before opening an idle profile, it trims only allowlisted oversized caches and unused local AI models; manual cleanup skips active or unverified browser profiles. HTTP cache is limited to 64 MiB and media cache to 32 MiB. Cookies, local storage, IndexedDB, Service Worker, saved passwords and session data are preserved.
- Avatar downloads must match the acknowledged task ID and narration/profile receipt. Existing videos with the same title cannot substitute for a new result. Exhausted free usage or insufficient credits reports a quota error; unconfirmed submissions are not automatically sent again.

- News presenter fitting handles landscape, portrait, square, small and non-square-pixel inputs without the crop failure. Eight geometry checks and two full broadcast fixtures cover this release.
- Portable owns its adjacent data/profile. Copied media paths are relinked with a snapshot backup; missing old-PC FFmpeg paths fall back to the bundled tools. New workspaces default to one export and two render threads.
- Run [the offline Windows render check](scripts/Test-Render-Windows.ps1) against the actual EXE on each PC. It produces synthetic sample videos, binary hashes, timings and a PASS/FAIL report without provider accounts.

- Queue preparation cards show creation and last-activity dates and identify errors saved before today. Date filtering and ordering follow actual activity, including retries; opening the app preserves historical timestamps.
- Compact Research management: select individual stories, a page or every filtered result; clear selection, delete in one request, and render only eligible selected stories. Per-story Delete and Render are visible; **Chi tiết & MC** opens the full controls. Active preparation/render stories cannot be deleted, while existing media/publication history is retained.
- News preparation preserves image relevance ordering, retries failed searches and uses labeled context imagery or a source/headline card when no appropriate image is available. Queue includes preparation progress and errors before job creation.

For a separate test workspace on another PC (or this PC), see [Windows test guide](WINDOWS_TEST_GUIDE_v0.7.8.md). For future debugging, start with the [v0.7.8 checkpoint](CHECKPOINT_2026-11-02_v0.7.8.md).

- MC rotation: choose multiple images, enter consecutive videos per image, and repeat the cycle across up to 100 News videos. Assignments survive preparation retries and restart, independently of DreamFace profile rotation.
- Research accepts an editable 1–100 story target. Each current, distinct source becomes a separate saved story; progress continues in the background and resumes after restart. Existing stories are skipped, and shortages are reported instead of silently duplicating sources. Filter by research run, render status, source date or text.
- Completed videos play inline with their source, MC and version details. The library separates final videos, MC images, raw presenter clips and Page avatars; folder reveal selects the exact video file.
- News and timeline exports share the selected FFmpeg concurrency limit. Research exposes AI task concurrency and video export concurrency separately.
- Page and post managers include filters, pagination, selection across all matching results, bulk previews and CSV export. Page review groups, notes, reminders, read-only checks, token/CSV/JSON imports and recoverable trash support large collections.
- Posts that cannot be retried safely return to the Content warehouse with their video and content intact. Reassign a Page to reuse them. A returned or edited draft stays on hold until explicitly approved or scheduled.
- Select multiple posts and use **Sửa … bài đã chọn** to edit each post or apply one field to all selected posts. Details can navigate the selection; stale and busy rows are skipped with reasons.
- Successful Reel and first-comment publication removes the draft from the queue and cleans its unreferenced local video. Publication history and the Facebook link remain under **Lịch sử đã đăng** to prevent duplicates. A comment-only failure reuses the existing Reel.
- The desktop splash and main window remain hidden until their content is painted; the main interface waits for initial data before appearing.
- Batch production: choose News or Product, research a niche or supply a product, and create 1–100 News videos or 1–50 Product videos. Each video keeps its source context for Content.
- Content uses the saved LLM to write complete English news articles, or short product first comments with the configured store link. News articles are included as `article.md` in handoff exports; drafts can be saved before assigning a Page.
- Bundled Inter font works offline, and the app shows its actual package version in the top bar and sidebar.
- Separate Channels, Content, Product and Research workspaces; Page selection, Meta token status and Page management.
- Content management with News/Product type, first comment, store or article link, approved render-library video selection, schedule and handoff export.
- DreamFace generation for news and product videos, local daily-rotation profiles, OpenAI-compatible research and FFmpeg render QA.
- Research image cards allow Wikimedia and article thumbnails through the local UI policy and load them eagerly with a visible fallback when a source is unavailable. News broadcasts automatically create one original AI MC still per DreamFace profile from the saved Highlight-compatible image endpoint, upload it before generation, prefer Avatar 3.0 Fast at 720p, recognize DreamFace's quota-prefixed Generate button, and fall back to an available avatar/resolution when the account does not expose that exact option. The result composes a narrated presenter with a fact-based hook, complete editorial images in a framed card, smooth zoom, pan and crossfade transitions. DreamFace Image is the automatic fallback when the primary image endpoint is unavailable.
- DreamFace profiles can generate and save sign-in details for reuse. **Tạo nhiều profile** creates any number of profiles and signs them in sequentially, or with a chosen number of hidden Chrome lanes, without opening any Chrome window. **Tạo Gmail & đăng nhập** creates a unique Gmail-shaped local credential (it does not create a Google inbox) and signs in hidden. The 2Captcha solver panel in Settings automatically solves DreamFace reCAPTCHA, and the hidden queue waits for each profile to become ready before moving on. If 2Captcha fails, the profile is closed and marked for retry; manual verification stays available from the account card. CAPTCHA is never bypassed.
- Accounts lists each profile as a compact horizontal row instead of a tall card. Search, provider, multi-status (including **Cần xử lý** for every profile that is not ready), proxy and sort filters narrow the pool; select one or many rows to assign one proxy to all (or one proxy per row), remove proxies, run the hidden sign-in queue, re-check sessions, or send pending CAPTCHAs. Every per-profile action stays available in the row action menu. Proxy edits clear the old proxy check result so a stale **Proxy OK** is never shown.
- Import the website domain, username and password from installed Highlight/Longform settings, test the connection, and publish a generated News article automatically after render when the setting is enabled (or review it from Content first). Its verified public URL becomes the exact first comment for the matching video; website or LLM errors stay visible on the Content post with a one-click regeneration action. Website passwords are encrypted separately from workspace snapshots.
- Optional Meta auto-post runs only after the website URL and first comment are confirmed, then publishes the matching Reel and its first comment to the bound Page. It remains off until enabled in Content settings and requires a local Page mapped to the Meta Page.
- Settings include Store/website defaults and First Comment templates; Meta vault supports System User and Via Token with App ID/App Secret validation.
- Settings now discovers OpenAI-compatible models automatically; Render has separate News/Product modes and a fast 480p draft action.
- Page distribution now has a Content warehouse: completed videos create separate Content drafts, Page groups assign them round-robin, and scheduled posts are published by the local scheduler after Meta preflight. A group can automatically take new warehouse videos into its daily time slots, while any Page can also receive a post-now action. News batches can pin one DreamFace profile for the same MC, while each video receives a distinct visual variation.
- Token pools now mirror the Highlight workflow: choose healthy Meta tokens, save a pool, then use **Tự chia Page** to assign verified Pages evenly by round-robin, least-recently-used or random strategy. Each pool records Page/token assignments, load counts and blocked Pages; a Page group can bind a token pool so daily warehouse automation uses the same assignment without asking again for every video.
- News render accepts either a keyword or a direct article URL, then uses the article as the source for the presenter video and Content draft. The render panel keeps the main action small and offers News standard, Viral bold and Minimal font/style presets.
- Research feed, AI video generation providers, timeline editing and Windows packaging. News graphics use a neutral US-news label, a red/yellow broadcast palette, readable condensed typography and keep the source in the lower bar.

## Run from source

Requires Node.js >=22.12.0 (release build: 24.22.2, pinned in `.node-version`) and FFmpeg/ffprobe from `bin/` or `PATH`. Packaged Windows users do not need Node.js.

```powershell
npm ci
npm run build
npm run desktop
```

## Build Windows artifacts

```powershell
npm ci
npm test
npm run build
npm run pack:release
```

Build outputs are written to `release/`. The installer and portable executable use the icon in `build/icon.ico`. Runtime data, browser profiles, tokens and secrets are excluded from the repository.

## Repository

This repository is the dedicated Viral Studio project. The current release is v0.7.8. The GitHub repository is `minhpark89/viral-studio`. See `CHECKPOINT_2026-11-02_v0.7.8.md` for implementation and verification details.


