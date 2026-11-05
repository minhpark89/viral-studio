# Viral Studio v0.10.0 — V3 News

V3 là style mặc định cho video tin tức mới. Vào **Dựng video → Render video tin tức → Style render tin tức** để chọn:

- **V3 chuẩn:** bố cục đã duyệt, ảnh có vùng riêng, MC cố định phía dưới, headline trắng và chữ phụ đỏ; zoom nhẹ xen ảnh tĩnh, hòa cảnh 0,3 giây.
- **V3 nhanh:** cùng bố cục và Full HD, giữ ảnh tĩnh với hòa cảnh để giảm thời gian xuất.
- **Kiểu cũ:** tiếp tục dùng bố cục trước V3.

Lựa chọn được nhớ theo project và đi cùng bản ghi render. Record có trước bản cập nhật giữ style cũ khi Retry, cùng MC/ảnh đã tạo; không tự gọi lại DreamFace.

Số ảnh tự động thường là 8, hoặc 6–10 theo thời lượng. Vẫn ưu tiên đúng nguồn và khác nhau; thiếu ảnh phù hợp thì dùng số thực tế. V3 không phủ MC/chữ lên vùng ảnh và không crop mất bố cục ảnh. Nguồn, credit và nhãn ảnh tư liệu được lấy từ dữ liệu từng tin. Không dùng nhãn duyệt thử hay logo nhà đài khác.

Phụ đề được căn offline theo lời MC; chữ giữ nguyên kịch bản đã duyệt. Bộ cài kèm mô hình tiếng Anh nên không phải cài thêm Python, Chrome hay tải model để render V3. Khi không căn được đủ tin cậy, app dùng thời gian ước lượng và ghi rõ ở kết quả Queue. Mô hình làm bộ tải lớn hơn khoảng 148 MB trước nén.

Giữ các chức năng research, product, quản lý Page/pool và dữ liệu cũ. Cài đè bằng Installer; bản Portable giữ dữ liệu cạnh EXE. Không bật hay tạo lịch đăng mới khi nâng cấp.

Tài liệu tiếp tục sửa lỗi: [CHECKPOINT_v0.10.0.md](https://github.com/minhpark89/viral-studio/blob/v0.10.0/CHECKPOINT_v0.10.0.md). Kiểm chứng và checksum đi kèm release. Tốc độ phụ thuộc CPU/GPU, số ảnh, thời lượng và số job đồng thời; phép đo lab trước đây không bao gồm bước căn phụ đề mới của app.
