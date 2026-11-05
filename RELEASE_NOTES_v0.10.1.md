# Viral Studio v0.10.1 — Render ngay trong Research

Chọn **Style render tin tức** ngay cạnh nút render trong **Research & News**. Mặc định vẫn là **V3 chuẩn**; có thêm **V3 nhanh** và **Kiểu cũ**. Render tất cả, render từng tin và LLM → Render đều dùng lựa chọn đang hiển thị.

- Style, font, độ dài và số ảnh dùng chung với **Dựng video**, lưu riêng theo dự án và giữ khi mở lại app. Phần thiết lập mở rộng chứa font, ảnh, MC và hiệu năng; các thao tác chính ở ngay bên ngoài.
- Gửi render xong vẫn ở Research, giữ bộ lọc và lựa chọn tin. **Lượt render từ Research** hiển thị tiến độ, style đã lưu, lỗi và video hoàn tất để xem ngay.
- Đổi style chỉ áp dụng cho lượt mới. Thử lại phần chuẩn bị lỗi giữ request cũ; tiến độ lấy lần chạy mới nhất để không đếm lại lỗi đã sửa.
- Khi chưa chọn tin, render hàng loạt áp dụng cho các tin phù hợp bộ lọc; tự bỏ qua tin đã có video hoặc đang chạy. Mỗi lượt tối đa 100 video.
- Nếu lưu thiết lập thất bại, app thông báo và yêu cầu lưu lại trước khi gửi render, tránh gửi nhầm cấu hình.

Giữ nguyên bộ dựng V3 đã duyệt, phụ đề offline và chất lượng xuất của 0.10.0. Bản này tập trung vào luồng quản lý Research; không phải thay đổi thuật toán tăng tốc render.

Đã kiểm chứng 435 test tự động, các luồng browser và EXE thực tế; mỗi bộ chẩn đoán GPU/Portable CPU đạt 11 ca. Chi tiết: [validation](https://github.com/minhpark89/viral-studio/blob/v0.10.1/RELEASE_VALIDATION_v0.10.1.json). Không gọi MC/LLM có phí hay đăng bài thật để kiểm thử.

Cài cập nhật bằng Installer hoặc tải Portable. Tài liệu tiếp tục sửa lỗi: [CHECKPOINT_v0.10.1.md](https://github.com/minhpark89/viral-studio/blob/v0.10.1/CHECKPOINT_v0.10.1.md). Checksum và source cố định đi kèm release.
