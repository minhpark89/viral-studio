# Chạy thử Viral Studio 0.7.5 trên Windows

## Chọn bộ cài

- `Viral.Studio.Setup.0.7.5.exe`: cài/cập nhật app trên máy. Chờ các tác vụ đang chạy xong, đóng app rồi cập nhật; giữ thư mục `Viral Data` hiện tại.
- `Viral.Studio.0.7.5.exe`: Portable, chạy trực tiếp. Để thử riêng trên PC hiện tại hoặc PC khác, đặt EXE vào một thư mục có quyền ghi (ví dụ `D:\ViralStudio-Test`) và **tạo thư mục trống `Viral Data` bên cạnh trước lần mở đầu tiên**. Cách này dùng dữ liệu thử riêng.
- Mở app và kiểm tra phiên bản ở góc trên là **0.7.5**. FFmpeg/ffprobe đã đóng gói; không cần cài Node.js. Có Chrome/Edge trên máy hoặc chọn đường dẫn trình duyệt trong Cài đặt.
- Release không chứa dữ liệu, tài khoản hoặc API key của máy phát triển. Trên dữ liệu thử mới, cấu hình/Test LLM và đăng nhập profile DreamFace trước khi tạo video có MC. Lượt tạo MC dùng dịch vụ/tài khoản bạn đã cấu hình.

## Thử luồng chọn và xử lý tin

1. Research khoảng 10–20 tin bằng một chủ đề có nguồn mới. Mỗi nguồn mới tạo một tin riêng; số lượng thực tế phụ thuộc RSS.
2. Tại **Quản lý tin Research**, chọn trạng thái/ngày nguồn và tìm tiêu đề. Chọn từng tin, **Chọn trang này** hoặc **Chọn tất cả … tin theo bộ lọc**. Chọn qua trang khác vẫn giữ lựa chọn; đổi bộ lọc bắt đầu lựa chọn mới.
3. Dùng **Bỏ chọn tất cả** để làm lại. Thanh thao tác hiển thị số tin đã chọn và số tin/video sẽ render. Nếu chưa chọn, Render dùng các tin đủ điều kiện trong bộ lọc; Xóa luôn cần chọn rõ.
4. Thử **Xóa tin** trên một tin không cần dùng. Xác nhận hoặc hủy trong hộp thoại. Thử **Xóa … tin đã chọn** cho nhiều tin. Video và lịch sử bài đã đăng vẫn được giữ; tin đang chuẩn bị/render không bị xóa.
5. Chọn 2 tin chưa có video, cấu hình ảnh MC và **Số video mỗi tin**, rồi Render. Các tin đã có video/đang chạy được bỏ qua trong thao tác hàng loạt. Mỗi lượt tối đa 100 video; giao diện báo số tin còn lại nếu lựa chọn vượt giới hạn.
6. Muốn xử lý một tin: dùng nút Render ngay trên tin, hoặc mở **Chi tiết & MC** để chọn MC/số video/profile riêng. Tin đã có video có nút **Render lại**.
7. Mở **Hàng đợi → Đang xử lý**: thấy cả bước chuẩn bị nội dung/ảnh và bước tạo MC/xuất video. Lỗi nằm ở **Có lỗi**; nút **Thử lại bước chuẩn bị** dành cho lỗi trước khi tạo video.
8. Mở **Hoàn tất**, thử Play/tua và chọn đúng tệp trong thư mục. Nếu thiếu ảnh tin, video có ảnh minh họa được ghi nhãn hoặc thẻ tiêu đề/nguồn tin.

## Nếu cần báo lỗi

Ghi lại phiên bản, tiêu đề tin, thời điểm và thông báo ở Hàng đợi. Có thể đính kèm ảnh màn hình hoặc video mẫu. Giữ thư mục dữ liệu trên máy; không gửi công khai API key, cookie hay thông tin đăng nhập.

Checkpoint mã nguồn: `CHECKPOINT_2026-11-01_v0.7.5.md`. Bộ cài có mã SHA-256 trong `SHA256SUMS.txt`.
