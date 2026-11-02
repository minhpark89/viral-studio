# Viral Studio v0.7.6 — checkpoint phát hành và tiếp tục kiểm tra

Release: https://github.com/minhpark89/viral-studio/releases/tag/v0.7.6

Người dùng đã chấp nhận bản sửa Hàng đợi local và yêu cầu phát hành thành **0.7.6**, kèm checkpoint cho phiên sau và hướng dẫn thử trên PC khác. Mã sửa nền: `57c9c487158c6b63103c5f7454251245cfc35a47`, sau bản công khai 0.7.5 (`02f863742ea71070e6ceae0c12d22d5adad76e1d`). Phiên bản package/lockfile hiện là 0.7.6; không thay dependency hay schema dữ liệu.

## Vấn đề và sửa đổi

- Người dùng thấy lỗi render sau khi mở app 0.7.5. Đã chụp app thật và xác nhận các thẻ đang xem báo `LLM returned HTTP 503` là lượt chuẩn bị lưu từ **27/10/2026**, không phải lượt mới sáng 02/11.
- `server/production.js`: ghi thời điểm thật khi retry, bắt đầu chuẩn bị, chuyển giai đoạn, kết thúc/lỗi và thay đổi trạng thái tác vụ liên kết. Giữ `createdAt`; mở lại app không đổi ngày lỗi cũ. Retry khi không còn item lỗi/ngắt quãng chưa có job là no-op, không tạo job trùng.
- `shared/queue-preparation.js`: tính `activityAt` theo cập nhật/giai đoạn/kết thúc/bắt đầu/retry, fallback ngày của batch; sắp xếp theo hoạt động thực tế.
- `src/QueuePreparation.jsx`: hiện **Lượt tạo / Cập nhật** và nhãn lỗi lịch sử trước hôm nay.
- `src/pages/Manage.jsx`: lọc ngày chuẩn bị theo `activityAt`; lượt retry của tin cũ xuất hiện trong **Hôm nay**.
- Giữ các tính năng chọn/xóa/render Research, ảnh tin dự phòng, xoay vòng MC, giới hạn render, Play và phân loại media của 0.7.5. Không đổi LLM endpoint/model/prompt, logic MC hay FFmpeg.

## Kiểm chứng bản sửa trước phát hành

- Build và **262 kiểm thử tự động** đạt, không lỗi/bỏ qua. `tests/preparation-history.test.js` kiểm tra giữ ngày lịch sử, retry với ngày mới/ngày tạo cũ, không trùng job và sắp xếp theo lần xử lý.
- `tests/queue-preparation-browser.mjs`: **7 kiểm tra** đạt, gồm ngày lỗi cũ, bộ lọc hôm nay và cập nhật qua SSE.
- Kết nối LLM bằng cấu hình thật đạt khoảng 5.6 giây. Chuẩn bị lại đúng tin lỗi trong dữ liệu thử riêng đạt: lời đọc khoảng 16.5 giây, xếp hạng ảnh khoảng 86.1 giây, tải hai ảnh và tạo job queued. Không gửi lượt tạo DreamFace mới trong phép kiểm tra này.
- Xuất lại tin đã hoàn tất bằng MC/ảnh/plan sẵn có: **30.733 giây, 1080×1920, H.264/AAC**, có âm thanh; giải mã toàn bộ và xem khung hình đạt. Đây là kiểm chứng ghép/xuất cục bộ, không phải tạo MC mới từ đầu.
- Bản sửa local đã cài và kiểm tra trên app thật: ngày lịch sử đúng, lọc hôm nay đúng, Play video cũ được, dữ liệu giữ nguyên.

## Kiểm chứng riêng bộ 0.7.6

- Build và đóng gói NSIS/Portable x64 thành công. Đối chiếu **69 file runtime/font** với source, kiểm tra bộ FFmpeg/ffprobe và metadata `latest.yml`; không có dữ liệu workspace trong archive. Các module startup/LLM/MC/render/production/Hàng đợi tương đương bản sửa local đã chấp nhận.
- Chạy lại **14 test production/history**, **7 kiểm tra Queue trên trình duyệt** đều đạt sau đổi phiên bản.
- Chạy **7 kiểm tra media trên Electron đóng gói 0.7.6**: Play/tua đúng video, mở đúng tệp, phân loại kho, ngày nguồn, MC/số video của từng tin và cả lô, nhập ảnh MC. Khi sửa bài test, giới hạn selector MC vào trang Research để tránh thao tác nhầm ô cùng tên trên trang Render đang chuyển đi; không cần đổi logic sản phẩm.
- Mở **đúng EXE Portable 0.7.6** từ thư mục thử có `Viral Data` trống: phiên bản đúng, không có tài khoản/tin/media/API key kế thừa, giao diện Research hoạt động, FFmpeg/ffprobe nằm trong runtime Portable, archive khớp gói. Dữ liệu thật không đổi; đóng phiên Portable thử thành công.
- Installer SHA-256: `6f0893b21c08679e0dd47d3ca49f781fd340d26ea405e6d373167dec4211cb1a`.
- Portable SHA-256: `603af3cdfdb414a89302fc50bab6d11795f31e093af894def52e40fac741c98f`.
- `app.asar` SHA-256: `946db73c1c594c4e2eeb2ec3efe49cce86f0128a191e02efd8fa964e398ca528`.
- Lần phát hành này không tạo MC trả phí mới, không đăng website/Facebook và không cài đè app đang chạy. Bản local trên PC phát triển vẫn mang số 0.7.5 nhưng đã có cùng sửa Hàng đợi; muốn đồng bộ số phiên bản dùng bộ cài 0.7.6 sau khi tác vụ xong.

## Bộ phát hành và thử trên PC khác

- `Viral.Studio.Setup.0.7.6.exe`: bộ cài Windows x64.
- `Viral.Studio.0.7.6.exe`: Portable Windows x64.
- `Viral.Studio.Setup.0.7.6.exe.blockmap`, `latest.yml`: metadata phát hành.
- `SHA256SUMS.txt`: hash các tệp tải về.
- `WINDOWS_TEST_GUIDE_v0.7.6.md`: cài, cấu hình máy mới, thử một tin/lô nhỏ, MC A-A-B-B, bộ lọc và mẫu `TEST_RESULT_v0.7.6.md`.
- Checkpoint này đi kèm release và nằm trong mã nguồn. Bản phát hành không chứa workspace, profile, API key hay tài khoản máy phát triển.
- Để thử độc lập, đặt Portable trong thư mục có quyền ghi và tạo **Viral Data** trống bên cạnh trước khi mở. Đăng nhập lại DreamFace, cấu hình/Test LLM. Không giả định cookie hoặc đường dẫn media trên máy cũ hoạt động nguyên vẹn trên máy mới.
- Đã kiểm chứng dữ liệu trống bằng phiên Windows cô lập trên PC hiện tại; kiểm chứng vật lý trên PC thứ hai còn do người dùng thực hiện.

## Hướng dẫn phiên sửa lỗi tiếp theo

1. Đọc checkpoint này và `TEST_RESULT_v0.7.6.md`/mô tả từ máy xảy ra lỗi. Xác nhận EXE, phiên bản và thư mục dữ liệu từ menu **Ứng dụng → Mở thư mục dữ liệu**.
2. Trong thư mục dữ liệu, đọc mới `.server-instance.json` để lấy PID/địa chỉ server; không dùng lại PID/port của phiên trước. `studio.json` và `.private` có cấu hình nhạy cảm, không đưa vào release hay Git.
3. Xác định đúng project/tin/batch/job và thời điểm, phân biệt lỗi chuẩn bị chưa có job với lỗi DreamFace/xuất video. Không tự retry toàn bộ lịch sử hoặc đổi model chỉ vì nhìn thấy HTTP 503 cũ.
4. Nếu cần kiểm tra API/UI, ưu tiên đọc; khi tái hiện dùng dữ liệu thử và giữ bản sao. Kết nối LLM hiện thành công không bảo đảm dịch vụ sẽ không lỗi ở yêu cầu sau.
5. Xem code và test ở trên; chạy kiểm thử liên quan rồi build/gói và kiểm tra app thật trước khi bàn giao. Chỉ push/phát hành phiên bản tiếp theo khi người dùng yêu cầu.
6. Lịch sử chi tiết trong source tại tag phát hành: [sửa Hàng đợi](https://github.com/minhpark89/viral-studio/blob/v0.7.6/CHECKPOINT_2026-11-02_QUEUE_HISTORY.md), [0.7.5](https://github.com/minhpark89/viral-studio/blob/v0.7.6/CHECKPOINT_2026-11-01_v0.7.5.md), [ảnh tin và chuẩn bị](https://github.com/minhpark89/viral-studio/blob/v0.7.6/CHECKPOINT_2026-11-01_NEWS_IMAGES_QUEUE.md).
