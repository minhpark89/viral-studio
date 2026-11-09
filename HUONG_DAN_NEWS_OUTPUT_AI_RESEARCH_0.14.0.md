# Viral Studio 0.14.0 — Output News và mẫu video AI

Đã cài bản mới và mở trên PC. Icon Desktop: **Viral Studio 0.14.0 - News Product Research**. Giữ thư mục dữ liệu, API key và lịch sử của bản dùng thử; dữ liệu News gốc không thay đổi.

## Chọn folder News

Vào **Dựng video → Render video tin tức → Output News · Chọn nơi lưu video**.

- **Chọn thư mục…** mở hộp thoại Windows; áp dụng riêng đợt sắp tạo.
- **Đặt làm mặc định News** lưu lựa chọn cho các đợt News mới, kể cả đợt tạo từ Research & News.
- **Mở thư mục Output** mở folder hiện chọn.
- **Về mặc định của app** đưa News về `Viral Data\exports`.
- Xuất timeline thủ công: bấm **Xuất video**, chọn folder trong cửa sổ xuất.

Product giữ mặc định riêng `Viral Data\exports\products\final`; clip Product ở `exports\products\clips`. Nếu chủ động chọn cùng folder thì hai loại MP4 sẽ nằm cùng chỗ. Đợt mới lưu cố định đường dẫn lúc tạo; đổi mặc định không chuyển các file cũ hay đổi đợt đã tạo trong bản này.

## Research có lưu không, có nặng máy không?

Research đa nguồn tự lưu theo dự án trong `Viral Data\product-research\research.sqlite`; không nhét lịch sử vào dữ liệu News. Mở lại app vẫn còn kết quả, mẫu đã chọn và lịch theo dõi. Giao diện hiện 40 lần quét gần nhất; dữ liệu cũ vẫn lưu trong database.

- Lưu thông tin nguồn, link và số liệu nguồn có cung cấp.
- Ảnh xem trước tải khi xuất hiện trên màn hình; video chỉ tải khi bấm xem.
- Cache preview giới hạn khoảng **512 MB**, thay file cũ khi đầy. Mỗi video tải tối đa 64 MB; tối đa 4 lượt tải đồng thời. Xem nhiều video vẫn dùng RAM/mạng; render có chi phí tài nguyên riêng.
- Mở **Lưu trữ Research · tự lưu trên máy** để xem dung lượng thực tế và bấm **Cập nhật dung lượng**.
- **Dọn cache Research** dọn ảnh/video xem trước và phản hồi API tạm của workspace. Giữ lịch sử, mẫu đã lưu, key, số lượt API đã dùng và MP4 đã xuất. Cache có thể tải lại; quét lại sau khi dọn có thể dùng lượt API. Đợi các lần quét/tải preview xong trước khi dọn.
- Lịch sử không tự xóa, nên database sẽ tăng theo số lần quét. Sao lưu toàn thư mục `Viral Data` khi app đã đóng nếu cần mang lịch sử sang máy khác.

## Làm video khi không có hàng để quay

1. Vào **AI Research · US → Tìm mẫu AI từ ảnh · tối đa 2 lượt**.
2. Nhập tên/ngách, ví dụ `Jesus wall art` hoặc `Christian gifts`. Meta Ads dùng từ khóa này để tìm quảng cáo cùng ngách.
3. Ô **Từ khóa mẫu AI / cách dựng** dùng riêng cho video TikTok, Instagram, Facebook. Mặc định `product animation CGI`; có thể thử `AI product video`, `wall art mockup` hoặc từ khóa cụ thể. Mẫu kỹ thuật có thể thuộc ngách khác để học cách dựng.
4. Bấm **Quét**. Chỉ chọn preset chưa gọi API; mỗi nguồn Meta Ads/social tối đa một lượt khi chưa có cache. Thiếu kết quả thì app báo trống, không âm thầm gọi thêm lượt.
5. Xem video hoặc mở nguồn; lọc **Chỉ mẫu có dấu hiệu dựng từ ảnh / AI**. Mỗi mẫu có lý do, gợi ý dựng từ ảnh và hạn chế.
6. Tích mẫu → **Lưu mẫu** hoặc **Sang Product Studio**. Chế độ **Không có hàng để quay** và hướng dựng được chuyển theo.
7. Thêm link có ảnh hoặc tải ảnh rõ nét của đúng sản phẩm. Chọn **AI từ ảnh · giới thiệu sản phẩm** hay **AI từ ảnh · tranh trong không gian**, số lượng, folder và lịch hằng ngày nếu muốn.
8. Product Studio dùng LLM đọc ảnh và DreamFace render. Có thể đưa video mẫu đã tải vào để phân tích hình ảnh thực tế. Lịch hằng ngày cần máy và app đang mở, profile còn lượt; 15 giây theo luồng miễn phí hiện dùng 3 cảnh × 5 giây mỗi video.

### Hiểu đúng nhãn mẫu

- **Nguồn nhắc AI / CGI · chưa xác minh**: tiêu đề/mô tả nhắc kỹ thuật này. CGI/3D cũng có thể được làm bằng phần mềm dựng thủ công; không có nghĩa đã xác nhận AI tạo video gốc.
- **Có dấu hiệu phù hợp dựng từ ảnh**: suy luận từ mô tả kiểu showcase/mockup/animation, chưa phân tích khung hình.
- **Chưa đủ thông tin về cách dựng**: chưa có bằng chứng; vẫn có thể mở xem và chọn học cách bố trí nếu phù hợp.

Tìm kiếm không chứng minh video viral, doanh thu hay tỷ lệ chuyển đổi. Bản mới đã thử nguồn thật với `product animation CGI`: 5 mẫu gồm 1 TikTok, 2 Instagram, 2 Facebook; 4 mẫu có metadata nhắc CGI/3D. Các mẫu này là tham khảo kỹ thuật, không phải quảng cáo đã xác nhận đúng sản phẩm của store.

Với tranh Jesus hoặc quà tặng có chữ, cần kiểm tra hình tranh, chữ, màu và chi tiết trên video trước khi đăng. Chưa có ảnh/link hai sản phẩm thật nên chưa nghiệm thu video DreamFace của chính store.

## Kiểm chứng

- Bộ test backend: 510 bài đã qua; các kiểm tra bổ sung cho tìm kiếm trống/cache và dữ liệu cuối đã qua riêng.
- Đã xuất MP4 News thật vào folder được chọn; Product vẫn vào folder riêng.
- Đã kiểm tra lưu đường dẫn từng đợt, chọn/hủy folder, lưu mặc định, mở folder qua IPC Desktop, chuyển nguồn tham khảo sang Product và lưu lịch 3 video/ngày trong workspace thử riêng.
- Bản Desktop đã đóng gói vượt qua kiểm tra dọn cache, mở lại Research, giữ mẫu đã chọn và chặn đọc lịch sử khác dự án. Bản cài thực tế giữ API key và 6 lần quét; 5 mẫu mới được thêm từ cache, bộ đếm lượt API không tăng ở bước này.
- Không dùng credits DreamFace, không đăng bài, không push/deploy.

Log và dữ liệu kiểm chứng: `.maintenance\news-output-ai-research-0140` và `studio\.verification\news-ai-desktop-*`.
