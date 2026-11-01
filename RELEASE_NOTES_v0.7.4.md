# Viral Studio v0.7.4

- **Xoay vòng ảnh MC:** thêm nhiều ảnh, nhập số video liên tiếp cho mỗi ảnh, rồi tự quay về ảnh đầu. Áp dụng cho cả lô, xuyên qua các tin, và khi tạo nhiều phiên bản từ một tin. Ảnh MC độc lập với profile DreamFace; Retry giữ nguyên phân công.
- **Research 1–100 tin:** nhập trực tiếp số tin muốn lấy. Mỗi nguồn mới là một bản tin riêng; bỏ nguồn trùng và tin đã research. Chạy nền có tiến độ, dừng/tiếp tục và khôi phục sau khi mở lại app. Nếu thiếu nguồn mới trong ngày Mỹ, hiển thị số thực tế tìm được.
- **Render tới 100 video News/lượt:** chọn nhiều tin trong bộ lọc, số phiên bản mỗi tin và vòng MC. Tách điều khiển tác vụ AI và số video xuất song song; News và timeline dùng chung giới hạn FFmpeg.
- **Quản lý Research:** lọc theo lượt research, chưa render, đang xử lý, đã có video, lỗi, đã đăng; tìm kiếm, chọn hàng loạt và phân trang. Hiển thị ngày nguồn riêng với ngày lưu/ngày render.
- **Video hoàn tất:** nút Play phát và tua ngay trong app; hiển thị nguồn tin, MC, phiên bản và thời gian hoàn tất. Mở thư mục chọn đúng tệp video.
- **Kho media rõ ràng:** tách video cuối, ảnh MC, video MC thô và avatar Page. Avatar Page không lẫn vào đầu vào dựng video.
- **Sửa ảnh tin và khởi động:** cache ảnh tách theo bản tin, kiểm tra độ liên quan của cả ảnh bài viết và ảnh tìm kiếm; sửa lỗi giới hạn narration và khung đen trước màn hình tải trên Windows.

Chọn **Installer** để cài/cập nhật hoặc **Portable** để chạy trực tiếp. Giữ nguyên thư mục dữ liệu `Viral Data` khi cập nhật. File `SHA256SUMS.txt` đi kèm để kiểm tra bộ cài.

Nguồn RSS quyết định số tin mới có sẵn. Số video tạo MC chạy đồng thời còn phụ thuộc số profile DreamFace sẵn sàng và giới hạn tài khoản.
