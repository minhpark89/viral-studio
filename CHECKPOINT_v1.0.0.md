# Checkpoint Viral Studio 1.0.0

Ngày 16/11/2026. Mốc công khai trước: `v0.15.3`, commit `09df04482c5e59b0bf3cb81c1bc0abf87dfb36c4`. Mốc sửa tiếp: tag `v1.0.0` và source commit trong manifest của [release](https://github.com/minhpark89/viral-studio/releases/tag/v1.0.0). Không ghi hash của chính commit vào file này; manifest được tạo sau commit.

## Hành vi cần giữ

V4 mặc định cho yêu cầu News mới, khung ảnh `{x:0,y:224,w:1080,h:1040}`, MC/headline ở dưới, phụ đề và nguồn nằm trong vùng an toàn. V3, V3-fast và classic giữ khả năng dùng lại. `Store` gán kiểu cũ cho bản ghi lịch sử thiếu style; không đổi style của batch đã lưu khi thử lại. Tùy chọn News lưu theo project và dùng chung giữa các màn hình.

Tái sử dụng MC/receipt trước khi cân nhắc tạo lại. Nếu lần gửi cũ chưa rõ kết quả, giữ trạng thái cần kiểm tra. Phục hồi lời đọc, ảnh hay render phải giữ liên kết job/batch/media và video cũ theo đúng loại thao tác. Không lấy video khác chỉ vì trùng tiêu đề. Provider lỗi/quota/đăng nhập được phân loại, không được che bằng kết quả giả.

Kho Content lấy video xuất thực tế theo project, phân biệt video chưa có bài với bài đã có. Page/token được đối chiếu theo nhóm và trạng thái hợp lệ; lịch mỗi Page một bài/ngày chỉ chạy khi người dùng bật. Tránh đăng lại cùng Page/ngày, giữ first-comment retry dùng bài đã xuất bản, giữ các hold đang có và khoảng cách giữa token/Page.

## Bản đồ mã và ca hồi quy

| Khu vực | Mã chính | Kiểm thử liên quan |
| --- | --- | --- |
| V4, ảnh, typography, phụ đề | `shared/news-format.js`, `server/news-v3-layout.js`, `server/news-v3-render.js`, `server/news-v3-motion.js`, `server/news-captions.js` | `news-v3`, `news-v3-layout`, `news-avif-render`, `news-style-browser` |
| Nguồn bài, ảnh, chuẩn bị nhiều tin | `server/news-source.js`, `news-document.js`, `news-plan.js`, `news-visuals.js`, `production.js` | `news-document`, `news-quality`, `news-image-variety`, `news-preparation-speed`, `news-preparation-browser` |
| DreamFace editor và receipt | `server/news-avatar-editor.js`, `dreamface-news-result.js`, `dreamface-diagnostics.js`, `providers/dreamface.js` | `news-avatar-editor`, `dreamface-news-result`, `dreamface-diagnostics`, `dreamface-radio` |
| Phục hồi hàng đợi/lời đọc | `server/queue-retry.js`, `queue.js`, `news-narration-recovery.js`, `shared/queue-issues.js`, `src/NewsNarrationRecovery.jsx` | `queue-retry`, `news-narration-recovery`, `news-retry-browser` |
| Video chưa có Content | `shared/content-inventory.js`, `src/pages/ContentVideoInbox.jsx`, `src/content-creation.js` | `content-inventory`, `content-inventory-browser` |
| Nhóm, token, trạng thái Page | `server/group-setup.js`, `shared/page-diagnostic.js`, `src/pages/GroupFromTokensDialog.jsx`, `src/PageCheckResult.jsx` | `group-setup`, `group-setup-browser`, `page-check-results-browser` |
| Lịch mỗi Page/ngày | `server/page-daily-schedule.js`, `social-scheduler.js`, `social.js`, `shared/posting-calendar.js` | `page-daily-schedule`, `social-cadence`, `page-daily-browser` |
| Lưu state / HTTP desktop | `server/atomic-file.js`, `store.js`, `http-runtime.cjs`, `desktop/main.cjs` | `store-file-lock`, `http-runtime` |

Tên không có đuôi trong cột kiểm thử là `tests/<tên>.test.js`; browser là `tests/<tên>.mjs`.

Windows đôi lúc khóa file khi đọc/quét: `commitFileSync` retry lỗi EPERM/EACCES/EBUSY có giới hạn, giữ file tạm đã flush và bản cũ; chỉ xác nhận receipt sau commit. HTTP dùng bản Undici đã pin và các web class tương ứng trước khi service giữ tham chiếu fetch; không nuốt uncaught exception toàn cục.

## Build và xác minh

Dùng Node 24.22.2 theo `.node-version`, `npm ci`, setup captions/windows, `npm test`, browser liên quan và `npm run pack:release`. Khi chạm phần dùng chung, chạy `tests/news-studio-desktop.mjs` và `tests/product-research-desktop.mjs` trên `release/win-unpacked/Viral Studio.exe`.

Chạy `scripts/Test-Render-Windows.ps1` với EXE thật; script mặc định kiểm 1.0.0 và ghi report/RESULT trong thư mục mới. Kiểm CPU; thêm `-Gpu` trên máy có encoder đã xác nhận. Xem frame thật, metadata, audio, decode toàn bộ và style, không chỉ exit code. Kết quả/số ca cụ thể được ghi trong `RELEASE_VALIDATION_v1.0.0.json`.

DOM/HTTP fixture không thay cho kiểm chứng trực tiếp dịch vụ bên ngoài. Không có clean Windows VM và không kiểm tất cả GPU/driver cho release này. Khi cần thử nhà cung cấp, dùng quyền đã được người dùng cấp, kiểm công việc đang chạy và receipt trước khi gửi thêm. Dữ liệu, video người dùng, token và trace riêng không được đính kèm vào release.

## Cách sửa tiếp và nâng cấp

1. Đọc checkpoint nội bộ của máy cần sửa, xác định EXE/version/hash, dataDir và công việc đang chạy. Fetch main/tag, đối chiếu manifest; bảo toàn thay đổi chưa commit trước khi tạo nhánh sửa từ `v1.0.0`.
2. Tái hiện trong workspace riêng; giữ bản ghi lỗi, stage, mã lỗi và receipt đã lược thông tin xác thực. Không tạo `Store` thứ hai có quyền ghi vào dataDir đang mở.
3. Sửa đúng module và ca hồi quy cho nguyên nhân đã xác nhận. Chạy các kiểm thử bị ảnh hưởng; khi phát hành hợp nhất, chạy đầy đủ như runbook.
4. Trước thay EXE, chờ jobs/batches idle, tạm giữ automation có ghi lại cấu hình, đóng app bình thường rồi đợi cả portable wrapper thoát. Backup state đã flush, bí mật riêng, database phụ, EXE và marker phiên bản. So sánh ID và cấu hình sau khi mở lại rồi khôi phục automation đúng giá trị cũ.
5. Rollback binary chỉ khi tương thích schema và có backup đã kiểm tra. Không ghi đè state live bằng snapshot cũ vì có thể làm mất công việc hoặc lịch sử đăng phát sinh sau snapshot.
6. Bản sửa tiếp dùng version mới; giữ tag/artifact 1.0.0 bất biến. Tạo source ZIP từ `git archive`, manifest source commit, SHA256SUMS và cập nhật cả checkpoint công khai lẫn checkpoint nội bộ.

Release GitHub không tự nâng cấp các máy đang dùng. Trạng thái cài đặt thật được ghi ở checkpoint vận hành riêng, không suy ra chỉ từ số phiên bản trên GitHub.
