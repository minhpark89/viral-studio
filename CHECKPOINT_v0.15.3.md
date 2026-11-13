# Viral Studio 0.15.3 — quality gates và hàng đợi thử lại

Ngày 13/11/2026. Base: `b8caa9535684b811f3fdf0f216b2b35345c39da4` (0.15.2). Nhánh thực hiện: `fix/news-quality-0.15.3`; nguồn tiếp tục là tag `v0.15.3`/main và commit trong manifest của [release](https://github.com/minhpark89/viral-studio/releases/tag/v0.15.3). Không ghép đè source từ worktree Product Research 0.21.0. Người dùng đã yêu cầu phát hành và cài KAD22P5; kết quả triển khai bên dưới.

## Bằng chứng và thay đổi

Kiểm tra KAD22P5 trước sửa xác định: 30 video/15 tin, 21 hoàn tất, 9 lỗi; 6/21 dùng thẻ tin, 6/21 chỉ có một ảnh. Cả 15 cặp A/B dùng cùng tập ảnh, 7 cặp cùng thứ tự. Encode QSV thực tế khoảng 8,67–15,46 giây, phần lớn thời gian nằm ở chuẩn bị/MC/hàng đợi. Các nguồn đều là wrapper Google News; đường đọc ảnh từ bài gốc từng bị bỏ qua. Báo cáo gốc nằm ở workspace hỗ trợ `docs/KAD22P5-check-2026-11-13.md`.

| Khu vực | Thay đổi | Kiểm tra |
| --- | --- | --- |
| Thử lại hàng loạt | `shared/queue-retry.js`, `server/queue-retry.js`, `src/QueueRetryBar.jsx`; chỉ lần cuối trong dự án, kiểm lại trạng thái trên server, dedupe, giữ MC, recover receipt, báo ambiguity | `tests/news-quality.test.js`, `tests/news-retry-browser.mjs` |
| Chuẩn bị thiếu ảnh | `server/production.js`, `shared/news-format.js`, `QueuePreparation.jsx`; trạng thái `needs_assets`, min 6 mặc định, giữ narration, opt-in ít ảnh/thẻ, bổ sung cho job cũ | News quality/visuals/production/preferences tests |
| Bài gốc | `server/news-source.js`; resolver Google public, giới hạn bytes/deadline, pinned DNS/redirect guard qua `fetchProductResource`, đọc JSON-LD/article/main và ảnh | Parser, redirect/private-address tests; 5 nguồn thật trong validation |
| Chọn ảnh | `news-plan.js`, `news-visuals.js`; truy vấn ngắn bám chủ thể, quyết định duyệt/từ chối/chưa duyệt tách biệt, không cache lỗi thành thành công, cache ảnh revision 6 | News image variety/visuals/broadcast/quality tests |
| A/B | `news-variants.js`; số biến thể theo từng tin, so với các bản đã chuẩn bị kể cả retry bản trước, ưu tiên ảnh ít dùng/cảnh mở khác; V3 nhận visualVariant | Narration/pool 12 ảnh dùng 8 mỗi bản; hai ảnh legacy dựng thật |
| Hiệu năng/diagnostic | Hai worker chuẩn bị tin độc lập, khóa theo tin; `job-timing.js`, `dreamface-diagnostics.js`; thông báo đã redaction, receipt được giữ cả khi URL submit đổi | Phase timing, incomplete acknowledgement, browser/provider tests |
| Desktop/package | 0.15.3, Node 24.22.2, Electron 45; giữ nguyên runtime/FFmpeg/fonts và các workspace Product | Bộ test toàn cục, News/Product packaged UI và render diagnostic |

## Cách kiểm tra thủ công

1. Hàng đợi → Có lỗi → News → tìm tên hoặc giới hạn thời gian; tick một mục và thử lại. Đổi bộ lọc để kiểm tra phạm vi. Bấm lại request cũ không tạo job trùng.
2. MC còn tệp: không cần tài khoản để dựng cục bộ. Receipt có ID: tìm đúng kết quả; receipt không xác nhận: báo cần kiểm tra. Hàng đợi tạm dừng không tự chạy khi bấm thử lại.
3. Tin chỉ có 0–5 ảnh: mặc định dừng trước MC; tìm thêm ảnh dùng lại lời đọc. Chỉ dựng ít ảnh/thẻ tin sau khi chọn chính sách tương ứng.
4. Video đã xuất ít ảnh: dùng Tìm thêm ảnh và dựng lại, kiểm tệp mới, giữ nguyên MC/narration và video cũ, không tạo bài Content tự động.
5. Hai bản cùng tin: kiểm mở đầu lời đọc, tập/thứ tự ảnh và chuyển động. Kho 12 ảnh, mục tiêu 8: bản thứ hai có 4 ảnh mới. Kho thiếu: xem cảnh báo thay vì coi là đã khác 50%.

## Phạm vi kiểm chứng và giới hạn

Kết quả thực tế, số test, renderer, metadata và hash artifact được chốt trong `RELEASE_VALIDATION_v0.15.3.json`/manifest kèm bộ cài. Ảnh chụp UI được xem trực tiếp; kiểm thêm chiều rộng cột tên và kích thước checkbox để ngăn lỗi co cột. Kiểm video thật dùng bản sao MC/ảnh đã có của KAD22P5 trong workspace riêng, không gửi yêu cầu MC trả phí.

Kết quả chốt: **547/547** test toàn cục; **28/28** test tập trung sau sửa phân loại thời gian render, **27/27** test chuẩn bị/timing; hai bộ browser Queue đạt, packaged News/Product đạt. Portable chạy **11/11 CPU** (21,0 giây cả bộ) và **11/11 GPU** (37,3 giây cả bộ; fixture GPU dài hơn CPU). Source/server/shared/desktop/dist trong ASAR khớp byte với source dùng để đóng gói; metadata package đã kiểm phiên bản 0.15.3.

Máy kiểm: Windows x64, i7-11800H, Intel UHD và RTX 3050 Ti Laptop. Hai bản dựng lại từ media thật: 1080×1920, 30 fps, 20,367 giây, có âm thanh; QSV, decode toàn bộ đạt. Thời gian pipeline 9,99 giây và 5,66 giây; lần hai dùng cache căn lời đọc. Cả hai giữ lời đọc/MC cũ để thử retry và đổi thứ tự hai ảnh legacy; đây không phải phép thử sinh lời A/B mới. Năm link Google News thật đều ra nội dung bài gốc (1.824–8.539 ký tự), tìm 2–7 ảnh ứng viên mỗi bài.

Đọc được bài gốc và ảnh ứng viên không bảo đảm mọi ảnh đều đạt kiểm duyệt hoặc tải được. Duyệt ảnh vẫn dựa trên metadata/nội dung nguồn, chưa thêm dịch vụ nhận diện ảnh. Các site chặn truy cập, thay HTML, Google đổi protocol, quota provider hoặc LLM timeout vẫn có thể gây lỗi; có trạng thái và đường thử lại rõ ràng. Chưa thử tạo MC mới có trả phí trên DreamFace cho phiên bản này. Thời gian đo cục bộ không được coi là tốc độ bảo đảm trên mọi PC.

## Triển khai KAD22P5

Đã nâng cấp ngày 13/11/2026 lúc 16:34 (+07). Kiểm idle, đóng app bình thường và đợi portable wrapper thoát; sao lưu sau khi state đã flush rồi thay EXE nguyên tử. App mở lại trong desktop session 1, API health xác nhận 0.15.3 và đúng dataDir; cửa sổ thật đã được chụp kiểm tra. API thử lại hàng loạt nhận lựa chọn rỗng trả 0/0/0, không tạo job mới.

- EXE chuẩn: `D:\Viral Studio\Viral Studio.exe`; SHA-256 `78336FE5D2E70F153994C64B57D70B569AEE72A03EB9AFBC91FD40F35B9B8E7A`.
- Dữ liệu: `D:\Viral Studio\Viral Data`. Đối chiếu mọi ID collection: không thiếu bản ghi; 36 accounts, 167 media, 51 jobs, 25 research, 31 socialPosts, 2 productionBatches và 1 project được giữ. Không có key cấu hình nào thay đổi.
- Backup: `D:\Viral Studio Support\2026-11-13\v0.15.3\before-0.15.3`; có state, `.private`, Product database, EXE 0.15.2, marker và shortcut cũ. Media/exports/profiles giữ tại chỗ. `backup-manifest.json` ghi hash các tệp sao lưu.
- Chẩn đoán riêng trên máy đích: `D:\Viral Studio Support\2026-11-13\v0.15.3\gpu-diagnostic\report.json`, 11/11 đạt, Intel QSV, 61,943 giây cả bộ. Windows 10 19045, i5-12450H, 15,7 GiB RAM; video V3/V3 Fast 1080×1920, 30 fps, audio và decode đạt.
- Bằng chứng cục bộ hỗ trợ: `.verification/deploy-0.15.3`; các script triển khai chỉ là helper riêng, không đi vào source ZIP. Thông tin SSH nằm trong tài liệu hỗ trợ cục bộ của chủ máy, không đưa khóa hay dữ liệu xác thực lên release.

Rollback nếu cần: kiểm idle và đóng app bình thường; khôi phục EXE 0.15.2 đã backup, giữ dữ liệu hiện hành trước. Chỉ phục hồi snapshot state/DB/secret khi đã đối chiếu và sao lưu phần phát sinh mới; không đè snapshot cũ lên dữ liệu sau nâng cấp. Các lần nâng cấp tiếp theo theo `RELEASE_RUNBOOK.md`.
