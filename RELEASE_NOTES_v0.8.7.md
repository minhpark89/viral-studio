# Viral Studio 0.8.7

Post management now scrolls correctly, bulk account checks execute for every selected eligible profile, and quota-blocked DreamFace profiles can become ready automatically after their allowance actually recovers.

## Changes

- Fixed inherited post-manager wheel scrolling and retained access to table controls at compact window sizes.
- Preserved historical Page names, IDs and links for posts returned to the warehouse. Page references appear in table/details, search/filter and CSV; drafts are not silently assigned for publishing.
- Fixed the bulk account-check request method that previously produced `0/4`. Progress separates checked profiles, ready profiles, profiles needing attention, request failures and busy profiles.
- Added **Bị lỗi** and **Hết hạn mức** account filters. DreamFace quota checks distinguish a Generate credit price from a Free Daily allowance, and read available credits for the selected Avatar workflow.
- Added a 30-minute quota recheck schedule while the app is open and resumed overdue checks on startup. Recovery requires confirmed usable allowance; login/verification problems and unknown quota are not marked ready. Failed generation jobs are not automatically resubmitted.
- Improved article-gallery discovery, grounded context queries, bounded image ranking, failed-download refill and duplicate rejection using decoded image content. Context images remain identified as context; unavailable or unrelated images are not substituted as event footage.
- Made DreamFace option selection resilient to UI hydration and kept production status aligned with the latest retry.
- Persisted same-token and group-wide posting gaps across restart/retry; comment-only retries reuse the existing video.

## Measured render behavior

An audit of 23 completed news jobs from the November 3–4 overnight batch found NVIDIA RTX 3060 `h264_nvenc` in every job. Original presenter clips averaged 16.33 seconds.

| Measured interval | Mean | Range |
| --- | ---: | ---: |
| After verified MC download through completed local output | 42.44 s | 26.02–56.56 s |
| Provider submission through verified MC download | 150.97 s | 137.65–175.93 s |
| Active job start through completion | 214.61 s | 191.57–274.59 s |

The post-download interval includes render-slot waiting, composition, encoding and media import; it is an upper bound rather than an encoder-only benchmark. Active job time excludes research/image preparation and queue time. All 23 final videos previously passed full decode, dimensions and audio verification. These are observations from one PC and batch, not a speed guarantee for other machines or providers.

## Downloads

Use the Installer to update an installed copy, or the Portable executable for a separate portable copy. The release includes SHA-256 checksums, update metadata and an offline Windows render-check script. See `CHECKPOINT_v0.8.7.md` for release verification.

Quota recovery does not guarantee a daily grant from DreamFace. Accounts requiring login/verification or an unavailable provider model option still need review.
