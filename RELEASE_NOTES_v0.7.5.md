# Viral Studio v0.7.5

- **Chọn tin nhanh:** danh sách Research mặc định thu gọn, chọn từng tin, cả trang hoặc toàn bộ tin theo bộ lọc; bỏ chọn tất cả. Giữ lựa chọn khi sang trang/đổi số tin mỗi trang, xóa lựa chọn khi đổi bộ lọc.
- **Xóa từng tin hoặc nhiều tin:** nút nằm ngay trên mỗi tin và thanh thao tác sát danh sách. Xóa hàng loạt trong một yêu cầu, báo số tin đã xóa và số tin đang xử lý được giữ lại. Giữ video, media và lịch sử bài đã đăng.
- **Render theo lựa chọn:** render các tin đủ điều kiện đã chọn, hoặc các tin trong bộ lọc nếu chưa chọn. Hiển thị số tin/video sẽ tạo; bỏ qua tin đã có video hoặc đang chạy. Render nhanh một tin dùng cấu hình MC của cả lô; mở **Chi tiết & MC** để cấu hình riêng.
- **Ảnh bản tin:** sửa thứ hạng Wikimedia, tìm lại khi cache không còn ảnh liên quan, dùng truy vấn ngắn và tải ảnh gốc khi thumbnail lỗi. Ảnh minh họa có nhãn rõ; khi thiếu ảnh phù hợp, tiếp tục bằng thẻ tiêu đề/nguồn tin và MC.
- **Hàng đợi:** hiện cả bước chuẩn bị nguồn, lời đọc và ảnh. Lỗi trước khi tạo tác vụ cũng hiện ở **Có lỗi**, có nút thử lại.
- Giữ các tính năng của 0.7.4: xoay vòng ảnh MC theo số video, Research 1–100 tin, giới hạn render song song, Play/tua ngay trong app và tách avatar Page khỏi media dựng video.

**Máy đang dùng:** tải `Viral.Studio.Setup.0.7.5.exe` để cập nhật. Giữ thư mục dữ liệu hiện tại.

**Chạy thử độc lập/PC khác:** tải `Viral.Studio.0.7.5.exe`, đặt trong thư mục riêng và tạo thư mục trống `Viral Data` bên cạnh trước khi mở. Bản phát hành không kèm tài khoản hay dữ liệu cá nhân; cấu hình LLM và đăng nhập DreamFace trên máy thử. Có sẵn FFmpeg/ffprobe; dùng Chrome/Edge trên máy.

Xem `WINDOWS_TEST_GUIDE_v0.7.5.md` đi kèm để thử chọn/xóa/render và kiểm tra dữ liệu. `SHA256SUMS.txt` chứa mã kiểm tra tệp.

Kiểm thử: 259 kiểm thử tự động đạt; kiểm thử trình duyệt cho chọn/xóa/render, Research, Hàng đợi; kiểm thử bộ đóng gói và Portable với dữ liệu trống. Quá trình kiểm thử không gửi thêm yêu cầu tạo MC trả phí hoặc đăng bài lên tài khoản thật.
