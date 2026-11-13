# Viral Studio 0.15.3 — ảnh News, biến thể và thử lại lỗi

Trong **Hàng đợi → Có lỗi**, chọn từng video rồi bấm **Thử lại N mục đã chọn**. Để trống lựa chọn và bấm **Thử lại tất cả đang lọc** để xử lý toàn bộ kết quả đang hiển thị. Bộ lọc dự án, News/Product, thời gian và từ khóa đều giới hạn phạm vi thao tác. Lần thử cũ đã có lần thay thế không được tạo lại. Có bộ lọc **Thiếu ảnh** riêng cho lỗi trước bước tạo MC.

Video đã có MC sẽ dùng lại tệp MC để dựng. Yêu cầu có mã tác vụ DreamFace được đưa vào bước tìm lại kết quả. Yêu cầu đã gửi nhưng chưa xác nhận kết quả, hoặc MC bị mất tệp, được báo **cần kiểm tra**; thao tác hàng loạt không tự gửi thêm yêu cầu MC trong trường hợp này. Hàng đợi đang tạm dừng vẫn giữ trạng thái tạm dừng.

News mới mặc định cần ít nhất **6 ảnh thật** trước khi tạo MC. Thiếu ảnh sẽ dừng ở bước chuẩn bị và giữ lời đọc đã viết. Có thể chọn **Tìm thêm ảnh**, **Dùng số ảnh hiện có**, hoặc chủ động **Cho phép dùng thẻ tin**. Thẻ tin được đếm riêng, không ghi là ảnh minh họa thật. Tùy chọn được lưu theo dự án trong News Studio.

Với video đã xuất, mở chi tiết tác vụ và chọn **Tìm thêm ảnh và dựng lại**. App đọc lại nguồn, bổ sung ảnh và dựng một kết quả mới, giữ MC và lời đọc. Video cũ vẫn còn. Lượt bổ sung này không tự tạo hoặc đăng bài Content.

Link Google News được giải ra bài báo gốc để đọc nội dung và thu thập ảnh. Hai bản của cùng tin có hướng mở khác nhau; lời đọc trùng bị viết lại tối đa một lần rồi báo lỗi nếu vẫn quá giống. Kho ảnh chung ưu tiên mỗi bản có ít nhất 50% ảnh khác và cảnh mở khác khi đủ ảnh. Nếu nguồn hạn chế, app ghi rõ cảnh báo. Đã sửa trường hợp chỉ có hai ảnh bị quay lại cùng thứ tự và cho V3 xen chuyển động theo số biến thể.

App hiển thị thời gian từng bước: đọc nguồn, viết lời dẫn, tìm ảnh, chờ hàng đợi, tạo MC, phụ đề và dựng video. Hai tin độc lập có thể chuẩn bị cùng lúc; các bản của cùng một tin vẫn xử lý lần lượt để so sánh với bản trước. Lỗi gửi MC có thêm dấu hiệu yêu cầu/mã tác vụ và thông báo nhà cung cấp đã lược thông tin nhạy cảm.

Bản này được đóng gói cục bộ trên nhánh `fix/news-quality-0.15.3`, chưa phát hành GitHub và chưa cài thay bản 0.15.2 trên KAD22P5. Chi tiết kiểm chứng và giới hạn nằm trong `CHECKPOINT_v0.15.3.md` và `RELEASE_VALIDATION_v0.15.3.json`.
