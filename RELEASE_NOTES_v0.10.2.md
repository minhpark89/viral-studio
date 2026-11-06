# Viral Studio 0.10.2 — bản thử tối ưu profile và dữ liệu

- Tạo nhiều profile gom metadata vào một lần lưu; kiểm tra toàn bộ proxy trước khi tạo và hoàn tác khi lưu thất bại. Giữ fsync và thông tin đăng nhập riêng từng profile.
- Giao diện nhận phần thay đổi thay vì tải lại toàn bộ snapshot mỗi lần profile/job đổi trạng thái. Khi mất kết nối, tải lại snapshot đầy đủ; tương thích các client SSE cũ. Chặn kết nối lại SSE trong lúc thoát để app đóng hết tiến trình.
- Đo dung lượng profile trong một lượt, giới hạn số thao tác đọc song song, gộp các yêu cầu đo đồng thời và giữ kết quả tối đa 30 giây. Nút Đo dung lượng bắt buộc đo lại. Kiểm tra an toàn trước khi dọn vẫn thực hiện mới, không dựa vào số đo cache.
- Thêm đường dẫn dữ liệu/dung lượng ổ đang dùng và cảnh báo gần đầy trong Cài đặt.
- Tự nén nội dung tin đã đăng hơn 30 ngày khi không còn media, bản nháp hoặc tác vụ cần xử lý. Giữ ID/nguồn chống trùng; khôi phục đầy đủ từ Research → Đã lưu trữ. Có tùy chọn tắt. Không xóa job, batch, publication hoặc backup.
- Sửa tiêu đề dài V3/V3 nhanh bị panel phụ đề che: kiểm tra chiều cao theo font thật và dành khoảng cách trước panel. Giữ nội dung chữ, vị trí ảnh, MC và chất lượng mã hóa.

Mẫu đo trên máy phát triển: tạo 50 profile cùng metadata khoảng 5,45 MB giảm từ 1,08 giây xuống 37 ms; đo 41 profile từ 9,5 giây xuống 1,1 giây; một cập nhật profile truyền khoảng 1,1 KB thay vì 3,45 MB. Đây là benchmark cục bộ, không phải cam kết tốc độ dịch vụ đăng nhập hoặc mọi máy.

Chọn `Viral.Studio.0.10.2.exe` (Portable) cho ổ riêng hoặc `Viral.Studio.Setup.0.10.2.exe` (Installer). Đọc `HUONG-DAN-O-DU-LIEU-v0.10.2.md`. Giữ nguyên thư mục dữ liệu khi nâng cấp; nên thử bằng workspace riêng trước. Bản 0.10.1 đã cài trên máy phát triển chưa bị thay thế.

Phạm vi kiểm chứng và SHA của chính bộ cài nằm trong `RELEASE_VALIDATION_v0.10.2.json` và `SHA256SUMS.txt`. Kiểm tra local render, UI và profile với fixture không thay thế kiểm chứng đăng nhập/quota/dịch vụ đăng bài trên từng tài khoản thật.
