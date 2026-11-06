# Checkpoint v0.10.2 — tối ưu profile, stream state và kho tin

Đây là bản thử để tải sang PC khác. Source tiếp nối v0.10.1, chưa thay phiên bản app/dữ liệu đang dùng trên máy phát triển. Installer/Portable và validation ở release tương ứng. Dữ liệu/token/cookie/fixture riêng không đi cùng source hoặc bộ cài.

Các thay đổi chính: `server/dreamface-accounts.js` gom một lần lưu; `shared/state-events.js` và `server/state-events.js` truyền delta có revision, snapshot đầy đủ khi reconnect, đóng stream khi shutdown; `server/profile-measurement.js` và `profile-storage.js` đo một lượt và cache kết quả 30 giây. Giới hạn cache, kiểm tra process/khóa và danh sách đường dẫn cho phép xóa giữ nguyên.

`server/history-archive.js` lưu nội dung Research đã đăng hơn 30 ngày vào gzip có SHA-256 trong workspace/history/research, fsync trước khi đổi bản ghi thành tóm tắt. Giữ ID, nguồn phục vụ chống trùng. Bỏ qua bài còn media/draft/job chưa completed hoặc publication chưa có bình luận thành công. Khôi phục kiểm tra hash/ID/project và chạy được khi đổi đường dẫn workspace. Tác vụ tự lưu trữ chạy khi mở app và mỗi 24 giờ, tối đa 100 tin/lượt. Có thể tắt qua historyArchiveEnabled. Job/batch/publication không bị xóa. Nếu quay lại 0.10.1, khôi phục các tin đã lưu trữ bằng 0.10.2 trước vì bản cũ không có nút khôi phục.

`WorkspaceStorageSettings.jsx` hiển thị ổ/thư mục thực; `Research.jsx` có bộ lọc Đã lưu trữ. Research selector/style/shared persistence của 0.10.1 phải tiếp tục hoạt động. `news-typography.js` thêm giới hạn chiều cao font, `news-v3-render.js` giới hạn headline 268px từ y=1124, trước caption-panel y=1408. Các font được đo pixel bằng FFmpeg, không chỉ ước tính số dòng.

Kiểm thử liên quan: `tests/performance-storage.test.js`, `tests/storage-performance-browser.mjs`, `tests/profile-storage.test.js`, `tests/new-profile-storage.test.js`, `tests/research-render-style-browser.mjs`, `tests/workspaces-browser.mjs`, `tests/research-manager-browser.mjs`, `tests/management-ui.mjs`, `tests/desktop.mjs --packaged`. Chạy full `npm.cmd test`, build và kiểm tra EXE trước khi phát hành thêm. Không khởi tạo Store ghi thứ hai trên workspace đang chạy; luôn đọc lại `.server-instance.json` và dùng fixture riêng.

Trên máy phát triển, evidence ở `../.maintenance/release-0102-20261106`. Benchmark chỉ đọc data thật, dùng workspace giả cho thao tác ghi. Lần thử playback đầu tiên có dropped frames khi đang chạy render khác; chỉ dùng kết quả final sau khi máy rảnh để kết luận. Lỗi shutdown tái hiện ở EXE sơ bộ đã có regression test và phải xác minh lại EXE cuối. Không dùng hash của gói trước lần rebuild cuối để bàn giao.

Máy mới đọc `HUONG-DAN-O-DU-LIEU-v0.10.2.md`; Portable đặt trên ổ riêng sẽ có Viral Data bên cạnh EXE, gồm history và secret store. Test offline đi cùng `Test-Render-Windows.ps1`, hỗ trợ CPU/GPU. Chưa kiểm chứng GPU AMD/Intel trên phần cứng thật hoặc live DreamFace/Meta trên PC của người dùng.
