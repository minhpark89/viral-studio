# Viral Studio 1.0.0 — News V4, Content và lịch Page

V4 trở thành bố cục mặc định cho video News mới: khung ảnh lớn hơn, MC và headline gọn, phụ đề rõ và ít khoảng trống. V3 chuẩn, V3 nhanh và kiểu cũ vẫn có trong bộ chọn; batch đã lưu giữ nguyên style khi tiếp tục hoặc thử lại.

## Thay đổi chính

- Đọc bài nguồn và tìm ảnh chính xác hơn, hỗ trợ ảnh AVIF, phân biệt ảnh ngữ cảnh, giữ thứ tự/chất lượng ảnh và xử lý thiếu ảnh trước bước tạo MC.
- Củng cố việc điền lời đọc, nhận kết quả DreamFace theo receipt, phục hồi MC đã tạo và phát hiện lời đọc bị thiếu ở đoạn cuối. Hàng đợi hiển thị lỗi chuẩn bị, kết quả cũ và các lựa chọn phục hồi rõ hơn.
- Content đếm video thực tế, chọn toàn bộ video chưa có Content theo bộ lọc và giữ đúng quan hệ giữa video, bài viết và bình luận đầu tiên.
- Tạo nhóm Page từ token, quản lý thành viên và chẩn đoán kết quả kiểm tra. Tùy chọn mỗi Page một bài/ngày tự bổ sung từ kho Content, giữ khoảng cách lịch và tránh đăng trùng.
- Khắc phục xung đột ghi file ngắn hạn trên Windows và lỗi HTTP runtime có thể làm ứng dụng ngừng phản hồi.
- Giữ các luồng Product Studio, Product Research, timeline thủ công, Output riêng và dữ liệu đã có.

## Tệp tải về

- `Viral.Studio.Setup.1.0.0.exe`: bộ cài Windows x64.
- `Viral.Studio.1.0.0.exe`: bản Portable Windows x64.
- `source-v1.0.0.zip`: source đúng commit phát hành.
- `SHA256SUMS.txt` và `RELEASE_MANIFEST_v1.0.0.json`: checksum, kích thước và source commit.
- Checkpoint, validation và script kiểm tra render để tiếp tục sửa hoặc xác minh trên môi trường khác.

Chờ tác vụ đang chạy hoàn tất và sao lưu dữ liệu sau khi đóng app trước khi nâng cấp. V4 là mặc định mới; các lựa chọn đã lưu của dự án/batch được giữ. Kết quả kiểm thử và phạm vi chưa kiểm nằm trong `RELEASE_VALIDATION_v1.0.0.json`; hướng dẫn sửa tiếp nằm trong `CHECKPOINT_v1.0.0.md`.
