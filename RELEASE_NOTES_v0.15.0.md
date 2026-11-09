# Viral Studio v0.15.0 — News Studio và Product Studio

Mở app vào **News Studio**. Luồng tin tức tự động và các cài đặt thường dùng nằm cùng một khu vực, cạnh **Product Studio**.

- **Research & chọn tin**: tìm tin, giữ bộ lọc/lựa chọn khi đổi tab nội bộ, chọn tin và gửi render; xem tiến độ và video ngay trong News Studio.
- **Tạo video tự động**: nhập chủ đề hoặc link bài viết, số lượng, MC/profile và tùy chọn Content. Bản ghi render trở lại đúng News Studio.
- **Cài đặt News**: folder Output, style V3/V3 nhanh/Kiểu cũ, font, độ dài, số ảnh, LLM, tốc độ và đăng nhập DreamFace. Style lưu theo dự án; folder mặc định, LLM và hiệu năng dùng theo workspace hiện có.
- **Kịch bản / Dựng video** chuyển xuống nhóm **Công cụ thủ công**. Dựng video chỉ còn timeline, có chọn xuất News/Product và folder tương ứng.
- Giữ các tính năng Product của bản dùng thử: tạo nhiều video từ link/ảnh, lịch hằng ngày, mẫu tham khảo AI/CGI, Research nhiều nguồn, lịch sử lưu trên máy và cache preview có giới hạn.
- News/Product có folder mặc định độc lập; mỗi đợt mới giữ đường dẫn lúc tạo. Có thể chọn folder riêng cho lượt trong News Studio hoặc lưu làm mặc định.

## Cài trên máy khác và tiếp tục sửa lỗi

Tải **Installer** để cập nhật bản cài đặt, hoặc **Portable** để dùng app cạnh thư mục dữ liệu riêng. Giữ nguyên `Viral Data`, các profile và cấu hình của máy đó; không lấy dữ liệu/tài khoản trên máy build chép đè sang máy chạy News.

Bản này xuất phát từ source 0.10.2 và bao gồm các thay đổi Product/Research/Output đã làm tới 0.14.0. Các lỗi riêng trên máy News đang được Codex khác sửa **chưa được nhận là đã sửa** trong bản 0.15.0. Trước khi nâng cấp, lưu commit/patch của các sửa đổi đó; merge/cherry-pick vào source mới, chạy test rồi phát hành phiên bản tiếp theo.

Xem [CHECKPOINT_v0.15.0.md](CHECKPOINT_v0.15.0.md) để tiếp tục, [RELEASE_VALIDATION_v0.15.0.json](RELEASE_VALIDATION_v0.15.0.json) để đối chiếu kiểm chứng và `SHA256SUMS.txt` trong release để kiểm tra file tải.
