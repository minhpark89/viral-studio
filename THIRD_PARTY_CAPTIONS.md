# V3 rendering components

- [fontkit 2.0.4](https://github.com/foliojs/fontkit): MIT; measured layout of the existing bundled news fonts. The package includes its license and is pinned in package-lock.json.
- [whisper.cpp 1.7.6](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.7.6): MIT; the official Windows x64 CPU CLI and required ggml/whisper DLLs. SHA-256 is pinned for the complete release archive.
- [Whisper base.en](https://github.com/openai/whisper): model and code under the [MIT license](https://github.com/openai/whisper/blob/main/LICENSE). The converted GGML weights come from the whisper.cpp maintainer's model repository; their exact SHA-256 and length are pinned in `shared/news-caption-assets.json`.

The native runtime and the model are bundled outside app.asar, with both complete license files and a checksum manifest in `resources/news-captions`. They only process the locally generated presenter audio; no transcription service or external upload is called. The setup script downloads pinned public build dependencies for developers, while installed apps already contain them.

FFmpeg and font licenses remain with the existing bundled assets. No news photographs, reviewed sample presenter, credentials or user workspace are bundled by the V3 change.
