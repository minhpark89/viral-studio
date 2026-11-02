# Viral Studio 0.7.8 — Windows test guide

Use the x64 installer or portable EXE from the v0.7.8 GitHub release on Windows 10/11. Node.js and separate FFmpeg installations are not required. DreamFace workflows require a supported Chrome/Edge installation, an authenticated profile, network access and available provider quota.

## Install or upgrade

1. Close Viral Studio and its provider browsers. Keep a backup of the existing data folder.
2. Run `Viral.Studio.Setup.0.7.8.exe`. The installer preserves the old `Viral Data` directory before invoking the previous uninstaller. The data is stored in the installation's sibling `.data` folder; `data-location.txt` records a preserved location when necessary.
3. Open the Desktop shortcut. Confirm **0.7.8**, account/project counts, and playback of an existing video. Use **Ứng dụng → Mở thư mục dữ liệu** to locate the active data.

For an independent portable test, put `Viral.Studio.0.7.8.exe` in its own writable folder. It creates `Viral Data` beside the EXE. To test an existing workspace, copy the complete data folder with the app closed. Missing old-PC media/tool paths are relinked to the local copy where available. Do not merge two different data folders.

## Offline render check

Put `Test-Render-Windows.ps1` beside the portable EXE, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-Render-Windows.ps1 -AppPath '.\Viral.Studio.0.7.8.exe'
```

The check creates isolated synthetic fixtures and a `Render Test Results` folder. It verifies presenter geometry, frame size, codecs, audio and duration using the packaged FFmpeg/ffprobe. It does not call DreamFace or publish content. A PASS validates that local runtime, not every possible external provider response.

## News acceptance check

1. Select one researched story. For test-only rendering, turn off **Tự tạo Content** to avoid the configured website/social automation.
2. In **Độ dài clip tóm tắt**, select **Theo tin** or a 15/20/30-second target. In **Ảnh minh họa**, choose automatic or up to 6/8/10 images. The choices apply to individual and batch News renders.
3. Render once. A fresh profile may first create an MC image; quota/login/readiness problems have separate messages. Image and Avatar generation wait for actual submission. The MC video must match the task ID, profile and narration; a prior clip with a similar title is never substituted. A profile with no free usage/credits needs another eligible profile or credits before it can generate a new MC.
4. Play the completed video. Confirm a complete factual summary, the first-comment CTA, understandable audio and at least 15 seconds. Voice pace affects the exact length. Longer narration is never silently cut in the middle of a sentence.
5. Compare **Độ dài clip** with playback. **Thời gian xử lý** includes provider waiting and export and can be much longer.
6. Check subject, location and date against the source. Context photos have a visible label; older event photos are rejected. An image shortage is reported. The requested count is a maximum; a 15-second clip will not flash through ten photos.

Start with one AI task, one video export and two FFmpeg threads on a busy PC. Keep the report, app version, error code and source story when reporting a problem; never share cookies, tokens, passwords or the complete private data folder publicly.

## DreamFace Free limits checked on 2026-11-02

The [official in-app comparison](https://www.dreamfaceapp.com/avatar?type=price) lists standard Free Avatar at 30 seconds, 500 text characters and 720p, with five daily uses for the standard Avatar/AI Photo group. This is separate from Avatar 3.0 Fast.

On the inspected Free profile, **Avatar 3.0 Fast** shows **one free daily use**, a **2,000-character** input counter and an **180-second** audio selection limit. A 181-second synthetic upload was capped to 180 seconds while the free button remained available. This verifies the current composer limit, not a completed 180-second free generation. No extra generation was submitted for that inspection. The [official Avatar tutorial](https://www.dreamfaceapp.com/blog/how-to-create-a-baby-angel-ai-singing-video) also describes one daily free use. Availability and credit charges depend on the selected model, resolution and profile; the app records the current button's quota label.

News intentionally stays much shorter: automatic scripts target about 24 seconds, adjustable to 15/20/30 seconds, within 500 characters including the full CTA. Speaking speed affects actual duration; the minimum final composition is 15 seconds. These conservative targets also fit the standard Avatar text allowance. The separate **AI Video** product's 8-second limit is not the News talking-presenter workflow.
