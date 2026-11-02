# v0.7.5 local diagnostic and Queue history correction — 2 November 2026

The user reported render errors after opening 0.7.5. The installed archive matched the public release exactly. Capturing the actual app window showed preparation failures reporting `LLM returned HTTP 503`; those displayed batches were created on 27 October and had no new attempt timestamp. There were no new render submissions on the morning of this investigation.

## Verification of the reported failure

- A connection request using the configured LLM succeeded in about 5.6 seconds, without changing settings or data.
- Replayed the displayed `Sunday Papers: Royal Claims and EU Free Movement` preparation in an isolated workspace using the real configured LLM and image sources. Narration and image ranking succeeded (about 16.5 and 86.1 seconds respectively), downloaded two relevant context images, and produced a queued News job. Provider processing stayed paused; this check did not generate a new DreamFace presenter.
- Separately exported the latest completed Binance news story using its existing presenter, images and plan with the installed FFmpeg binaries. The 30.733-second 1080×1920 H.264/AAC result decoded fully and its frame was inspected. This validates local composition, not a new paid provider submission.
- The observed errors are preserved historical attempts. A successful current connectivity test does not erase an old failed attempt or prove that the provider will never fail in a later request.

## Correction

- Preparation cards now display original creation and last-activity dates, and mark failures from before today as saved history.
- Production retries, source preparation, per-item stages, completion/failure and linked-job status transitions record current activity. Original creation dates remain unchanged. Opening the application does not make old failures appear newly attempted.
- Queue ordering and date filtering for preparation items use actual last activity. A retried old batch can appear in today's work. Repeating Retry on an already queued/completed batch stays a no-op.
- LLM configuration, prompts, MC rendering and FFmpeg composition were unchanged.

## Validation and installed build

- Build passed; 262 automatic tests passed with no failures or skips.
- Queue browser suite passed seven checks, including historical timestamps and today's filter updating over SSE after a new attempt.
- Packaged 69 runtime/font files matched the working source. Existing LLM/render/MC modules remained equivalent to public 0.7.5.
- Installed locally and verified read-only: historical card date, today filtering, completed-video playback, archive hash and deep equality with the fresh pre-install data snapshot all passed.
- Version remains 0.7.5; installer `release/queue-history-20261102/Viral.Studio.Setup.0.7.5.queue-history.exe`.
- Installer SHA-256: `5d2379131fae645583fa55ecb8fe9d44c39c8e56b53751caaffa235d2d738cef`.
- Installed archive SHA-256: `70f9894696fbf4a749a1576d015c8dce112c55110e826c4dcd371b495c8efda5`.
- Private evidence and fresh backup are in workspace `.maintenance/render-075-20261102`. Keep the backup local because it contains account settings.
- This is a local correction; the public GitHub 0.7.5 assets were not replaced. Prior release: [0.7.5 checkpoint](CHECKPOINT_2026-11-01_v0.7.5.md).

For a future report, read the current server owner file, inspect the exact item and timestamps, and distinguish stored failures from new submissions. Do not silently retry all old batches or change provider/model settings merely because a historical 503 is visible.
