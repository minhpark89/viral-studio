# Viral Studio v0.15.2 — bản thống nhất News, Product và ảnh V3

Ngày: 09/11/2026. Đây là mốc tiếp tục sửa lỗi cho mọi PC. Source chuẩn là tag `v0.15.2` trên `minhpark89/viral-studio`; commit chính xác và SHA-256 bộ cài nằm trong `RELEASE_MANIFEST_v0.15.2.json` đính kèm release. Không tiếp tục từ nhánh hotfix 0.10.1 hoặc chép nguyên module cũ đè lên bản này.

- [Bộ cài và source](https://github.com/minhpark89/viral-studio/releases/tag/v0.15.2)
- [Release notes](RELEASE_NOTES_v0.15.2.md), [kết quả kiểm chứng](RELEASE_VALIDATION_v0.15.2.json), [quy trình cho phiên bản sau](RELEASE_RUNBOOK.md).
- Nền gốc: v0.15.0, commit `a32e0e2d7e4cc7a4025bcfc6c0f5dc04b7f7d8f0`, có Product Studio/Research và News Studio riêng.
- Mốc ghép đã cài thử trên KAD22P5: 0.15.1, commit `9b5e914787edcc9f1dce050e178ddfe44d4bf78f`, chưa phát hành GitHub riêng. Xem [checkpoint 0.15.1](CHECKPOINT_v0.15.1.md).

## Vì sao máy cũ chạy nhưng máy mới lỗi

| Triệu chứng | Nguyên nhân đã xác định | Sửa trong bản thống nhất |
| --- | --- | --- |
| DreamFace báo chưa lấy được ảnh MC | Profile mới mở Template, chưa tải lịch sử My Image; điều kiện readiness cũ không hoàn tất | Sau khi model hydrate, mở My Image một lần, đợi history thật; vẫn phục hồi receipt trước khi cân nhắc submit mới |
| LLM không trả đủ JSON khi chọn ảnh/soạn lời đọc | Reasoning model dùng hết output budget, trả `finish_reason=length` | Nhận diện truncation cho JSON/SSE, thử lại tối đa một lần, trần 8192 token, chung deadline/cancellation; giữ nguyên ảnh và chỉ dẫn tiếng Việt của Product |
| Whisper không chạy trên Windows mới | Thiếu Visual C++ runtime, native exit `0xC0000135`; chỉ mang exe/model chưa đủ | Installer/Portable kèm bộ cài Microsoft có hash/chữ ký đã kiểm, probe trước khi khởi động tác vụ, cài khi thiếu rồi probe lại; không tự reboot |
| GPU có tên nhưng encode không hoạt động | Driver/encoder khác nhau giữa các PC | Workspace mới chọn Auto: kiểm encode/decode thực tế, có GPU dùng GPU, không có thì CPU; lựa chọn GPU/CPU đã lưu được giữ |
| Video cũ chỉ có ba ảnh | Bước chuẩn bị trước đó bị lỗi LLM, chỉ lưu ba ảnh đã duyệt; retry render giữ nguyên đầu vào | Không tự tạo thêm ảnh không liên quan. Muốn tìm lại ảnh phải chạy lại bước chuẩn bị; tối ưu khung ảnh không thay số ảnh của job cũ |

Không quy lỗi render/LLM cho SSH. SSH chỉ là kênh hỗ trợ từ xa. Phần sửa OpenSSH trên máy không thuộc bộ cài Viral Studio.

## Ảnh V3 thay đổi cụ thể

Giữ khung ảnh `x=0,y=272,w=1080,h=720`, bố cục MC/headline/phụ đề, màu nhận diện, attribution, timeline và dissolve 9 frame (300 ms). Đầu ra vẫn 1080×1920, 30 fps.

- Ảnh ngang có tỷ lệ phù hợp được scale/crop giữa để lấp đầy khung. Phần diện tích cắt ở bước fit tối đa 18%; zoom nhẹ trên một số cảnh tối đa 1,8%. `cropPercent` là phần cắt trước zoom; `zoomPercent` ghi riêng.
- Ảnh dọc/vuông, ảnh quá rộng và ảnh không có kích thước giữ toàn bộ hình. Khoảng trống được lấp bằng bản sao mờ, giảm sáng/bão hòa từ chính ảnh đó; ảnh chính không đổi màu. Ảnh contain đứng yên để giữ trọn mép ảnh và đạt kích thước tối đa trong khung.
- Source card luôn giữ trọn và đứng yên. Metadata có từ khóa screenshot/chart/ballot/document/map... hoặc cờ `preserveComposition:true`/`newsPhotoFit:'contain'` được bảo vệ tương tự. Đây là quy tắc dựa trên metadata, **không phải OCR hay nhận diện khuôn mặt**; cần xem lại ảnh quan trọng sát mép.
- Nền mờ được xử lý một lần trước khi loop frame, không tính blur lại mỗi frame.
- Trong các ảnh đã xác minh có độ liên quan tương đương, hướng dẫn chọn ảnh ưu tiên ảnh ngang rõ nét, đa dạng. Không bỏ ảnh chân dung đúng chủ thể chỉ vì tỷ lệ, không nới điều kiện xác minh để đủ số ảnh.
- Kết quả lưu `media.newsLayout.shots[]`: `fit`, `fitReason`, `background`, `sourceWidth/Height`, `cropPercent`, `motion`, `zoomPercent`, frame/timing. Comment trong MP4 ghi đúng thao tác crop/blur đã dùng.
- Video đã xuất trước khi nâng cấp giữ nguyên. Thay đổi áp dụng khi render lại hoặc tạo video mới. Classic không đổi; V3 và V3 Fast cùng dùng quy tắc fit, V3 Fast luôn đứng yên.

## Bản đồ code và kiểm tra hồi quy

| Khu vực | File chính | Test cần chạy khi sửa |
| --- | --- | --- |
| Fit/crop/blur ảnh | `server/news-v3-photo-fit.js`, `server/news-v3-motion.js`, `server/news-v3-render.js` | `tests/news-v3-photo-fit.test.js`, `tests/news-v3.test.js`, packaged CPU + GPU self-test, xem frame/video thật |
| Chọn ảnh, đủ ảnh, độ liên quan | `server/news-plan.js` | `tests/news-image-variety.test.js`, `tests/news-visuals.test.js`, `tests/news-broadcast.test.js` |
| DreamFace ảnh MC/profile mới | `server/dreamface-image.js` | fresh-history/receipt tests; không submit lại nếu receipt/result còn phục hồi được |
| LLM + Product multimodal | `server/llm.js`, `server/llm-response.js` | `tests/llm-budget.test.js` và toàn bộ LLM/Product tests; không bỏ images/language để sửa News |
| Windows prerequisite | `desktop/windows-runtime.cjs`, `shared/windows-runtime-assets.json`, `scripts/setup-windows-runtime.mjs` | `tests/windows-runtime.test.js`; kiểm hash, chữ ký, probe, cancel và reprobe |
| GPU/CPU | `server/render-hardware.js`, `server/store.js` | `tests/render-hardware.test.js`, diagnostic trên GPU thật |
| Product Research | Giữ module SQLite/Research và output riêng từ 0.15.0 | `tests/product-research-desktop.mjs`, `tests/news-studio-desktop.mjs` |

## Kết quả đã kiểm chứng

- 532/532 backend tests, không fail/skip; gồm kiểm pixel FFmpeg thật cho mép ảnh dọc, màu ảnh chính, nền từ chính ảnh và góc ảnh ngang.
- News Studio và Product Research trong EXE 0.15.2: native folder selection, style persistence, output độc lập, SQLite, missing-key handling và Trends CSV đều đạt.
- Packaged CPU: 11/11, 25,0 giây. Portable trên Intel QSV của KAD22P5: 11/11, 29,9 giây. Cả hai thực thi caption runtime và render ảnh cover/blur, decode đầu ra, kiểm âm thanh/thời lượng.
- 120 file server/desktop/shared trong ASAR trùng byte với source đã kiểm. Dựng lại bộ ba ảnh/MC có sẵn: 15 giây, 1080×1920, 30 fps, H.264/AAC, 450 frame; đã decode toàn bộ và xem ảnh trước/sau, không tạo thêm MC trả phí.
- KAD22P5 chạy EXE 0.15.2, UI hiển thị News/Product và GPU Intel. Giữ 1 project, 16 accounts, 42 media, 13 jobs, 10 research results, 1 production batch, 2 social posts; không mất ID gốc, key LLM và lựa chọn GPU được giữ. Chi tiết trong validation JSON.

## Chẩn đoán khi lỗi tái diễn

1. Ghi version từ UI và `/api/health`, SHA-256 EXE, đường dẫn `Viral Data`, Windows/GPU/driver. Đọc `.server-instance.json` mới để lấy address/pid; đừng dùng port ghi nhớ từ lần trước.
2. Ghi job ID, trạng thái, `error.code`, thời điểm, renderer, số `payload.imageMediaIds`, `newsLayout.shots`, `renderDevice`, caption timing/warning và đầu ra mong muốn. Che token/key/cookie; không upload cả `studio.json` hoặc browser profiles lên GitHub.
3. Phân biệt lỗi chuẩn bị ảnh, lấy MC, captions, FFmpeg và publish. Retry render không đồng nghĩa chạy lại chuẩn bị. Tái dùng presenter/cache/receipt để tránh phát sinh thêm lượt trả phí.
4. Chạy `Test-Render-Windows.ps1 -AppPath <exe>`; thêm `-Gpu` để kiểm encoder thật. Diagnostic dùng workspace mới, không gọi LLM/DreamFace/publish. Bản 0.15.2 kiểm cả ảnh ngang cover và ảnh dọc nền mờ.
5. Nếu chỉ lỗi trong workspace thật, sao chép tối thiểu các media và plan cần thiết sang thư mục kiểm chứng riêng. **Không tạo Store ghi thứ hai trên dữ liệu app đang mở.** Không đưa key/profile của máy build vào gói phát hành.

## Build, nâng cấp và rollback

Node >=22.12; môi trường build đã dùng Node 24.22.2. Lệnh: `npm ci`, `npm run setup:captions`, `npm run setup:windows`, `npm test`, `npm run pack:release`. Xem runbook để kiểm EXE, commit/tag, source archive và hash trước khi phát hành.

KAD22P5 dùng `D:\Viral Studio\Viral Studio.exe`, dữ liệu `D:\Viral Studio\Viral Data`. Chỉ thay EXE sau khi jobs và production preparation idle, đóng app bình thường rồi sao lưu state đã flush. Backup trước bản này: `D:\Viral Studio Support\2026-11-09\before-unified-0.15.2`; gồm EXE 0.15.1, state và shortcut. Kết quả kiểm nâng cấp ghi riêng trong validation đi kèm release. Máy khác giữ data/profile/key riêng, không lấy dữ liệu KAD22P5 làm bản mẫu.

Rollback: đợi idle, đóng app, sao lưu dữ liệu hiện tại trước, phục hồi EXE trước đó từ backup và mở cùng data root. 0.15.2 không có migration phá dữ liệu; trường audit ảnh mới là bổ sung. Chỉ phục hồi snapshot `studio.json` khi thật sự cần, vì sẽ mất bản ghi tạo sau snapshot. Không chạy đồng thời hai bản trên cùng data root.

Giới hạn: chưa có clean Windows VM để kiểm toàn bộ cài mới/NSIS và chưa thử mọi GPU/driver. Missing-runtime flow có unit test; runtime đã được cài thật trên KAD22P5 ở đợt sửa trước. Document detection dựa trên metadata; không bảo đảm tự hiểu mọi chữ/mặt trong ảnh. Tài khoản, mạng và API của bên thứ ba vẫn cần hoạt động.
