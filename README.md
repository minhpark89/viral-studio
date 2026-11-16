# Viral Studio 1.0.0

Ứng dụng Windows cho nghiên cứu tin tức, tạo video News/Product, quản lý Content và lên lịch đăng Page.

[Tải Installer / Portable](https://github.com/minhpark89/viral-studio/releases/tag/v1.0.0) · [Thay đổi 1.0.0](RELEASE_NOTES_v1.0.0.md) · [Checkpoint để sửa tiếp](CHECKPOINT_v1.0.0.md) · [Kết quả kiểm thử](RELEASE_VALIDATION_v1.0.0.json)

## Có gì trong 1.0.0

- **News V4** mặc định cho yêu cầu mới: ảnh lớn hơn, MC và headline gọn, phụ đề rõ. V3 chuẩn, V3 nhanh và kiểu cũ vẫn dùng được; công việc đã lưu giữ style của lượt tạo.
- **News Studio** gồm nghiên cứu nguồn, tạo video từ chủ đề/link, chọn MC và cấu hình Output. Chuẩn bị ảnh, lời đọc, phụ đề và render có tiến độ và lỗi riêng.
- **Hàng đợi** hỗ trợ lọc lỗi, chọn nhiều mục và phục hồi theo receipt. MC đã tạo được dùng lại; yêu cầu chưa xác định kết quả được đưa về kiểm tra trước khi gửi thêm.
- **Content Studio** đếm và chọn video chưa có Content theo dự án, tạo bài viết/bình luận, giữ liên kết với video và lịch sử đăng.
- **Page và token** hỗ trợ tạo nhóm từ token, phân bổ Page, chẩn đoán trạng thái và lịch mỗi Page một bài/ngày khi bật tùy chọn đó. Lịch giữ khoảng cách giữa các lượt và không lặp lại bài đã đăng.
- **Product Studio/Research** và công cụ dựng timeline thủ công tiếp tục có workspace, Output và dữ liệu riêng.
- FFmpeg, phụ đề offline và bộ kiểm tra render đi kèm bản Windows. Render CPU và GPU được chọn qua kiểm tra khả năng encode thực tế.

## Cài đặt và dữ liệu

Dùng `Viral.Studio.Setup.1.0.0.exe` để cài, hoặc `Viral.Studio.1.0.0.exe` để chạy Portable. Đối chiếu SHA-256 với `SHA256SUMS.txt` trong release khi cần xác minh tệp.

Portable giữ `Viral Data` cạnh EXE. Bản cài dùng thư mục dữ liệu riêng ngoài thư mục ứng dụng và có cơ chế nhận diện dữ liệu cũ. Khi nâng cấp, chờ công việc đang chạy hoàn tất, đóng app bình thường và sao lưu dữ liệu đã ghi xong. Giữ nguyên thư mục dữ liệu, profiles và thông tin xác thực của từng workspace.

V4 áp dụng cho yêu cầu mới chưa chọn style khác. Cấu hình đã lưu và style của batch cũ được tôn trọng. Các tích hợp AI, website và Meta cần tài khoản/cấu hình phù hợp; việc cài bản mới không tự bật đăng bài.

## Chạy từ source

Dùng Node.js **24.22.2** theo `.node-version` (engine tối thiểu 22.19.0). Người dùng EXE không cần cài Node.js riêng.

```powershell
npm ci
npm run setup:captions
npm run setup:windows
npm run build
npm run desktop
```

## Kiểm thử và đóng gói

```powershell
npm test
node tests/news-style-browser.mjs
node tests/news-retry-browser.mjs
node tests/content-inventory-browser.mjs
node tests/group-setup-browser.mjs
node tests/page-daily-browser.mjs
npm run pack:release
node tests/news-studio-desktop.mjs
node tests/product-research-desktop.mjs
powershell -ExecutionPolicy Bypass -File scripts/Test-Render-Windows.ps1 -AppPath release/Viral.Studio.1.0.0.exe
```

`npm run pack:release` tạo Installer, Portable và blockmap trong `release/`, với `--publish never`. Bộ render offline dùng workspace riêng và media tổng hợp, không cần tài khoản nhà cung cấp. Dùng thêm `-Gpu` trên máy có GPU được hỗ trợ.

Source tag `v1.0.0` và commit trong manifest là mốc tiếp tục phát triển. Đọc [checkpoint](CHECKPOINT_v1.0.0.md) và [quy trình release](RELEASE_RUNBOOK.md) trước khi sửa hoặc nâng cấp dữ liệu. Runtime data, profiles, key, token, log kiểm chứng và checkpoint vận hành riêng không được đóng gói vào source/release.
