# Viral Studio v0.7.7 — render và chuyển PC

Ngày kiểm chứng: 02/11/2026. Nền mã: v0.7.6, commit `4eb255389084209af5466f891bc13c637f926a39`. Phát hành Windows x64: Installer và Portable.

## Nguyên nhân đã xác nhận

`presenterFilter()` cũ tính `aspect` và `target` từ cùng kích thước đích, khiến nhánh dành cho MC ngang không chạy. MC 1056×792 bị thu thành khoảng 342×256 rồi crop 342×384, gây `Invalid too big or non positive size`. Test cũ chỉ có video MC dọc nên không bắt được trường hợp này. Đây là lỗi xử lý đầu vào của ứng dụng; việc một mẫu chạy được trên PC trước không chứng minh các mẫu khác đều chạy được.

## Thay đổi

- Scale MC theo tỷ lệ hiển thị thực tế, phủ đủ panel trước khi crop, chuẩn hóa pixel 1:1; bỏ scale thừa. Kiểm tra 8 loại đầu vào và xuất News đầy đủ với MC dọc/ngang.
- Giới hạn thời lượng các nguồn lặp trong timeline: ảnh, logo, âm thanh rỗng và nhạc. Mỗi bước FFmpeg có thời gian chờ tối đa theo thiết lập. Kiểm tra timeline có đổi tốc độ, chữ tiếng Việt, logo và nhạc lặp với 1, 2, 4 threads.
- Workspace mới mặc định 1 lượt xuất, 2 render threads. Cấu hình người dùng đã lưu được giữ nguyên.
- Portable dùng `Viral Data` và profile giao diện `.desktop` cạnh EXE, không tự lấy dữ liệu từ một bản đã cài ở nơi khác. Cơ chế tìm dữ liệu Dropship cũ vẫn dành cho nâng cấp Installer; `STUDIO_DATA_DIR` vẫn được ưu tiên nếu chỉ định.
- Khi chép cả workspace, tự nối lại các trường `file`, `thumbnail`, `previewFile` tìm thấy trong bản sao. Ghi `dataRoot` cho lần chuyển tiếp theo; giữ bản sao `studio.json.before-portability.bak` trước khi đổi đường dẫn. Không sửa URL, nội dung, API key hay đường dẫn bên ngoài workspace.
- Đường dẫn FFmpeg/ffprobe tuyệt đối đã mất trên PC mới được thay bằng công cụ đóng gói khi chạy. Đường dẫn tùy chỉnh còn hợp lệ vẫn được tôn trọng.
- Nhận diện backend đang chạy bao gồm cả package/version để tránh gắn một shell mới vào backend khác phiên bản.
- Thêm `--render-self-test=<thư mục mới>` và `scripts/Test-Render-Windows.ps1`: chạy kiểm tra ngay trong EXE, dùng media tổng hợp, không khởi động provider, hàng đợi hoặc scheduler. Xuất báo cáo, hash công cụ và ba video mẫu.

## Xác minh bản cuối

Máy kiểm tra: Windows 10 x64, build 19045; Intel Core i7-11800H, 16 logical CPUs, RAM khả dụng cho hệ điều hành khoảng 23,8 GiB. Chưa có phép đo vật lý trên PC thứ hai trong phiên này.

| Kiểm tra | Kết quả |
| --- | --- |
| Toàn bộ test | 278/278 đạt; 0 lỗi, 0 bỏ qua; khoảng 89,8 giây |
| Build giao diện | Vite thành công |
| Source/runtime | 64 file trong server/desktop/shared khớp sau chuẩn hóa CRLF; package/version và production dependencies đúng |
| Khởi động Portable trong thư mục mới | Đúng 0.7.7; tự tạo dữ liệu/profile cạnh EXE; không đọc tài khoản hoặc jobs của bản cài |
| Dữ liệu chép từ vị trí cũ | 22 mục media nối lại thành công; có backup trước migration |
| Bốn MC 4:3 từng bị lỗi crop | 4/4 xuất thành công; không gửi lượt tạo MC mới |
| Kết quả News thực tế | 1080×1920, H.264/AAC, SAR 1:1; đủ thời lượng; cả bốn giải mã toàn bộ và có tín hiệu âm thanh |
| Phát trong app | Phát và tua qua giây 10, không có lỗi player |
| Giới hạn encoder | Một job: tối đa 1 FFmpeg, khoảng 52,7 giây. Ba job: tối đa 2 FFmpeg, khoảng 108,5 giây |
| Bộ kiểm tra ngoại tuyến trong EXE | 11/11 đạt: 8 geometry, 2 News 13 giây, 1 timeline 5 giây; khoảng 51,5 giây |
| Installer | Giải nén thành công; toàn bộ 244 file payload khớp runtime đã kiểm tra |
| Bảo toàn dữ liệu | Dữ liệu bản cài và workspace cũ không bị thay đổi; các lượt thử đều dùng bản sao riêng |

Một lượt QA chạy nhiều test đồng thời ban đầu bị treo ở bước ghép logo/nhạc của timeline. Mẫu đơn lẻ không tái hiện lỗi trong mọi lần chạy. Bản cuối giới hạn nguồn lặp và thời gian chờ, đã qua các mức 1/2/4 threads, toàn bộ suite với 4 worker và phép thử timeline trong EXE. Không suy diễn rằng mọi khả năng treo do driver, ổ đĩa hoặc nguồn media khác đã được loại bỏ.

Không chạy trình cài đặt để thay bản đang dùng trên PC này; kiểm tra Installer ở mức payload. Không tạo MC mới hoặc đăng bài lên dịch vụ trong lần xác minh bản cuối. Phiên đăng nhập trình duyệt có thể phải tạo lại khi đổi Windows/user. Thử thêm luồng LLM → MC mới → News trên mỗi PC như hướng dẫn trước khi chạy lô lớn.

## Artifact và môi trường build

- Portable SHA-256: `a0d343aef76cda6726dc5c9627680b96f3661080ba1be38c6dc36f35f66e044e`.
- Installer SHA-256: `aae0a96731cea97f303344b65fd0ccb5f217e0fbfe2dd3ed9768219d9a3211af`.
- `app.asar` SHA-256: `ff44de3c2d13c0c287e4e01e3558d739f5a9c0bf123eaffad6a90cb5d04afb58`.
- Node 24.22.2 x64 (archive đối chiếu SHASUMS chính thức), Electron 45.0.0, electron-builder 26.15.3. `.node-version` ghim phiên bản Node; package engines yêu cầu >=22.12.0.
- Playwright tests dùng Edge cài trên PC qua preload adapter vì chưa có managed Chromium. Không thay đổi code sản phẩm để phục vụ adapter này.
- Build dùng Electron local đã cài trong `node_modules/electron/dist`, với `publish: never`; chỉ upload các artifact đã kiểm chứng qua GitHub Release. Media thật, profile, tài khoản, token và thư mục dữ liệu không nằm trong artifact/source được phát hành.

Xem [hướng dẫn test Windows 0.7.7](WINDOWS_TEST_GUIDE_v0.7.7.md) để dùng cùng mẫu trên các PC. Tốc độ là số đo tại máy này, không phải cam kết cho cấu hình khác.
