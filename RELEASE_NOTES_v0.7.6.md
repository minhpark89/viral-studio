# Viral Studio v0.7.6

- **Phân biệt lỗi cũ trong Hàng đợi:** mỗi lượt chuẩn bị hiện ngày tạo và lần cập nhật; lỗi lưu từ trước hôm nay có nhãn rõ. Mở lại ứng dụng không làm lỗi cũ biến thành lượt chạy mới.
- **Lọc đúng lần xử lý:** bộ lọc thời gian và thứ tự Hàng đợi dùng hoạt động thực tế. Thử lại tin cũ sẽ xuất hiện trong công việc hôm nay, vẫn giữ ngày tạo ban đầu.
- **Thử lại đúng tin:** tiếp tục dùng nút **Thử lại bước chuẩn bị** trên tin bị lỗi. Bấm lại khi tin đã được đưa vào hàng đợi không tạo thêm tác vụ trùng.
- Giữ đầy đủ chức năng 0.7.5: chọn/xóa/render nhiều tin Research, ảnh tin dự phòng, tiến độ chuẩn bị, xoay vòng MC theo số video nhập, Research 1–100 tin, giới hạn xuất video song song, Play/tua và tách avatar Page khỏi media dựng video.

Lỗi HTTP 503 trong lần kiểm tra vừa rồi là các lượt lưu từ 27/10. Kết nối LLM và chuẩn bị lại đúng tin đã thành công bằng cấu hình hiện tại. Bản này giúp quản lý lịch sử và thử lại rõ ràng; nếu dịch vụ bên ngoài lỗi trong một yêu cầu mới, Hàng đợi vẫn hiển thị lỗi của yêu cầu đó.

## Tải và thử trên PC khác

- **Cài/cập nhật:** tải [Viral.Studio.Setup.0.7.6.exe](https://github.com/minhpark89/viral-studio/releases/download/v0.7.6/Viral.Studio.Setup.0.7.6.exe). Đóng app sau khi các tác vụ xong, giữ thư mục dữ liệu hiện tại rồi cập nhật.
- **Portable:** tải [Viral.Studio.0.7.6.exe](https://github.com/minhpark89/viral-studio/releases/download/v0.7.6/Viral.Studio.0.7.6.exe). Đặt trong thư mục có quyền ghi, tạo thư mục trống **Viral Data** bên cạnh EXE trước khi mở để dùng dữ liệu thử riêng.
- Trên máy mới, cấu hình/Test LLM và đăng nhập DreamFace. Đã có FFmpeg/ffprobe; không cần Node.js. Dùng Chrome/Edge trên máy.
- [Hướng dẫn thử trên Windows](https://github.com/minhpark89/viral-studio/releases/download/v0.7.6/WINDOWS_TEST_GUIDE_v0.7.6.md) có các bước kiểm tra và mẫu báo lỗi.
- [Checkpoint 0.7.6](https://github.com/minhpark89/viral-studio/releases/download/v0.7.6/CHECKPOINT_2026-11-02_v0.7.6.md) ghi lại thay đổi, kết quả kiểm chứng và cách tiếp tục ở phiên sau. Có mã kiểm tra tệp trong `SHA256SUMS.txt`.

Bản sửa nền đã đạt 262 kiểm thử tự động. Sau đổi phiên bản, 14 test production/history, 7 kiểm tra Hàng đợi và 7 kiểm tra media trên Electron đóng gói đều đạt. Đã chạy đúng EXE Portable 0.7.6 với dữ liệu trống và kiểm tra hash archive/FFmpeg/metadata.

Bản phát hành không kèm dữ liệu, profile đăng nhập hoặc API key của máy phát triển. Kiểm thử PC mới được mô phỏng bằng Portable với dữ liệu trống trên máy hiện tại; việc thử trên PC thứ hai sẽ do người dùng thực hiện. Kiểm thử không gửi thêm yêu cầu tạo MC trả phí hoặc đăng bài.
