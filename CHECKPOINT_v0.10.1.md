# Checkpoint v0.10.1 — Research là luồng render chính

Người dùng chủ yếu tìm tin rồi render ngay trong Research. Bản này đưa lựa chọn style ra cạnh thao tác render, chia sẻ thiết lập với Dựng video, giữ người dùng ở Research và thêm quản lý các lượt đã gửi. V3 chuẩn vẫn mặc định. Phiên làm việc 05–06/11/2026; tiếp nối yêu cầu tích hợp, deploy, tải về và lưu checkpoint cho V3.

## Source và bộ cài

- Repo: https://github.com/minhpark89/viral-studio
- Release: https://github.com/minhpark89/viral-studio/releases/tag/v0.10.1
- Source cố định: tag `v0.10.1`; commit và hash asset trong `RELEASE_MANIFEST_v0.10.1.json` của release.
- `Viral.Studio.Setup.0.10.1.exe`, `Viral.Studio.0.10.1.exe`, `SHA256SUMS.txt`.
- Kết quả kiểm chứng: `RELEASE_VALIDATION_v0.10.1.json`.

## Hành vi phải giữ

1. Research có selector V3 chuẩn / V3 nhanh / Kiểu cũ ngay trong thanh chọn và xử lý tin. Tất cả đường gửi News từ Research đều truyền style, font, độ dài và ảnh hiện tại.
2. Bốn thiết lập này nằm trong `project.newsVideoOptions`, dùng chung với Render và lưu qua API. Dự án khác độc lập; khởi động app với port mới hoặc browser mới không làm mất lựa chọn. Không dùng localStorage làm nguồn chính nữa.
3. Tin đã chọn được ưu tiên; chưa chọn thì áp dụng cho tin trong bộ lọc. Bỏ qua tin đã hoàn tất hoặc đang chạy; giới hạn 100 video/lượt. MC rotation, số video mỗi tin, bộ lọc và lựa chọn vẫn ở Research sau khi gửi.
4. History lấy style từ `batch.request`, không lấy từ selector hiện tại. Thử lại chuẩn bị lỗi giữ request đã lưu. Job retry thành công thay thế lỗi của lần trước trong tiến độ. Video đã dọn sau đăng vẫn tính hoàn tất, không hiện preview giả.
5. Gửi single/bulk/LLM → Render không chuyển trang. Lắp ảnh thủ công vẫn mở Dựng video vì đó là tác vụ dựng riêng.
6. Save pending/error chặn gửi render; rapid changes được tuần tự hóa. Giữ snapshot đã được server xác nhận trong khoảng chờ SSE để đổi dự án ngay sau lưu không hiện thiết lập cũ.

## Bản đồ module

| File | Trách nhiệm |
|---|---|
| `shared/news-format.js` | Schema `newsVideoOptions`, defaults và nhãn style/font. |
| `server/index.js` | PATCH project chấp nhận và validate các tùy chọn News. |
| `src/useNewsVideoOptions.js` | Server persistence, migration một lần từ localStorage cũ nếu project chưa có tùy chọn, tuần tự PATCH, pending/error/retry. |
| `src/NewsVideoOptions.jsx` | Các selector dùng chung và thông báo trạng thái lưu. |
| `src/pages/Research.jsx` | Toolbar chính, cùng cấu hình cho mọi entry point, giữ trang, focus và phân trang history. Form research mới thu gọn khi đã có tin. |
| `src/ResearchRenderSettings.jsx` | Thiết lập mở rộng: font, độ dài, ảnh, MC/rotation, hiệu năng, LLM. |
| `src/ProductionBatchRecords.jsx` | Record dùng chung Research/Render, saved style, progress, lỗi, retry preparation, preview video thành phẩm. |
| `shared/production-progress.js` | Tìm job mới nhất cho từng item, fallback item/jobId, đếm hoàn tất/đang chạy/lỗi. |
| `src/pages/ProductionPanel.jsx` | Form Dựng video dùng cùng thiết lập dự án và record component. Product giữ luồng riêng. |

Renderer, motion, caption model và thông số hình ảnh V3 không thay đổi so với 0.10.0. Xem [checkpoint V3](CHECKPOINT_v0.10.0.md) cho hình học, font, captions và fallback. Phần localStorage trong checkpoint cũ đã được thay bởi cơ chế project persistence ở trên. Record trước 0.10.0 vẫn giữ migration classic đã có; 0.10.1 không thêm migration dữ liệu hàng loạt.

## Tiếp tục ở session sau

Đọc checkpoint local để tìm nơi cài/data/backup. Kiểm tra `git status`, version và `.server-instance.json` mới nhất. Không khởi tạo Store ghi thứ hai trên workspace đang dùng. Token, cookie, profile, backup và dữ liệu người dùng không đi cùng source/release.

```powershell
git clone https://github.com/minhpark89/viral-studio.git
cd viral-studio
git switch -c fix/research-issue v0.10.1
npm.cmd ci
npm.cmd run setup:captions
npm.cmd run build
npm.cmd test
node tests/research-render-style-browser.mjs
```

Node >=22.12; đã kiểm thử với Node 26.13.0. Browser scripts dùng Chrome ở đường dẫn mặc định Windows hoặc `STUDIO_TEST_CHROME`. Chạy Electron/EXE với `STUDIO_DATA_DIR` và `--user-data-dir` riêng. Kiểm tra bổ sung có liên quan: `tests/news-style-browser.mjs`, `tests/workspaces-browser.mjs`, `tests/research-selection-browser.mjs`, `tests/research-manager-browser.mjs`, `tests/rotation-browser.mjs`. `tests/media-flow-browser.mjs` là kiểm tra tùy chọn, cần dữ liệu media giữ lại trên PC phát hành; không thuộc test portable mặc định.

435/435 test đã đạt, cùng kiểm tra browser về single/bulk/LLM, đổi style nhanh, lỗi save/retry, dự án độc lập và restart server khác port với browser sạch. Bản EXE đã kiểm tra controls, shared persistence và byte của runtime/ASAR; GPU RTX 3060 và Portable CPU đều qua 11 ca chẩn đoán. Test không gọi MC/LLM mới hoặc đăng bài thật. Chi tiết nâng cấp và hash nằm trong validation; bằng chứng/backup có đường dẫn riêng trong checkpoint local.

Để kiểm tra render trên máy khác, chạy `scripts/Test-Render-Windows.ps1 -AppPath <EXE>`; thêm `-Gpu` nếu muốn thử GPU. Luôn dùng thư mục kết quả/profile thử riêng. Các ca GPU/CPU dùng input khác nhau nên không so thời gian giữa chúng. AMD/Intel GPU chưa kiểm chứng trên phần cứng thật.

Khi báo lỗi: ghi version, dự án, style đang chọn, style đã lưu của lượt, ID batch/job, bước single/bulk/LLM, lỗi lưu nếu có, và API response đã bỏ secret. Phân biệt lỗi lưu project với lỗi chuẩn bị và lỗi render provider. Không tạo MC mới để chẩn đoán một lỗi UI/local render.

## Khôi phục

Giữ runtime/bộ cài 0.10.0 và backup trước cập nhật. Bản 0.10.1 chỉ bổ sung tùy chọn project khi người dùng đổi lựa chọn; không đổi request/style của batch cũ. Rollback phần mềm không đồng nghĩa restore `studio.json` cũ lên dữ liệu đang phát sinh; phải giữ các ID media/bài đã đăng và dữ liệu mới. Phát hành bản sửa bằng version/tag mới, không thay asset 0.10.1 đã phát hành.
