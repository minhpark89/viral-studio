# Viral Studio 0.9.0

Theo dõi dữ liệu thật từ Meta trong mục Tổng quan Meta và quản lý dung lượng thư viện dễ hơn khi sản xuất nhiều video.

## Thay đổi

- Thêm Tổng quan Meta: người theo dõi hiện tại, lượt xem và tương tác theo 7/28 ngày báo cáo đã hoàn tất; biểu đồ, tìm kiếm, lọc Page/nhóm/trạng thái và phân trang. Các Page cần xem xét hoặc bị hạn chế đăng vẫn được theo dõi khi quyền đọc hợp lệ.
- Dùng bộ nhớ đệm, gộp yêu cầu làm mới, tối đa ba tác vụ đồng thời và một Page mỗi token; gộp lượt đọc chỉ số, lưu cache theo đợt và tôn trọng giới hạn Meta. Phân biệt số 0 thực tế với dữ liệu thiếu, cũ hoặc không được hỗ trợ. Lượt xem không được ghi thành Reach.
- Thư viện có chọn tất cả kết quả đang lọc trong dự án hiện tại, kể cả các trang sau; phân trang 48 mục, thống kê dung lượng, xem trước và xác nhận xóa hàng loạt, kèm lý do giữ lại file còn dùng.
- Mở rộng tự dọn sau khi video và bình luận đầu tiên đăng thành công: xóa ảnh minh họa tin tức hết dùng bên cạnh video thành phẩm và video MC trung gian. Kiểm tra lại khi mở app và mỗi năm phút.
- Giữ media còn dùng bởi bản nháp, timeline, tác vụ chưa hoàn tất hoặc đầu ra khác; giữ ảnh MC dùng lại, ảnh đại diện và clip nhập thủ công. Lịch sử đăng, liên kết bài viết và nội dung nguồn vẫn được lưu.
- Bao gồm các sửa lỗi cuộn trang, quản lý Page/bài đăng, kiểm tra tài khoản, khôi phục hạn mức, ảnh tin tức và tối ưu profile từ các bản trước.

## Cập nhật và tiếp tục xử lý lỗi

Installer dùng để cập nhật ứng dụng đã cài; Portable dùng vùng dữ liệu riêng cạnh EXE. Không đóng gói tài khoản, token, profile trình duyệt, media hoặc dữ liệu workspace.

Xem CHECKPOINT_v0.9.0.md để biết mã nguồn, kiểm chứng và cách tiếp tục ở session sau. SHA256SUMS.txt dùng để kiểm tra các file tải về. Ảnh/video đã được dọn không thể khôi phục chỉ bằng cách hạ phiên bản hoặc chép lại metadata cũ.
