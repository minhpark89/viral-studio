# Cài và thử Viral Studio 0.7.6 trên Windows

Release chính thức: https://github.com/minhpark89/viral-studio/releases/tag/v0.7.6

## 1. Chọn cách chạy

- **Cài dùng lâu dài:** tải `Viral.Studio.Setup.0.7.6.exe` và chạy bộ cài. Nếu cập nhật máy đang dùng, chờ tác vụ xong, đóng app và giữ nguyên thư mục dữ liệu hiện tại.
- **Thử riêng trên PC khác hoặc PC này:** tải `Viral.Studio.0.7.6.exe`, đặt vào thư mục có quyền ghi, ví dụ `D:\ViralStudio-Test-076`. Tạo thư mục trống **Viral Data** ngay cạnh EXE **trước lần mở đầu tiên**, rồi mở EXE. Đóng các cửa sổ Viral Studio khác trước khi thử.
- Kiểm tra phiên bản trên giao diện là **0.7.6**. FFmpeg/ffprobe đã đi kèm; không cần cài Node.js. Máy cần Chrome hoặc Edge; có thể chọn đường dẫn trình duyệt trong Cài đặt.
- Vào **Ứng dụng → Mở thư mục dữ liệu** để xác nhận đang dùng đúng dữ liệu thử. Nếu đã có dữ liệu quan trọng, đóng app rồi sao lưu toàn bộ thư mục này trước khi cập nhật/chuyển máy.

## 2. Chuẩn bị máy mới

1. Dữ liệu thử phải trống: không có tài khoản, media hoặc tin Research từ máy phát triển.
2. Trong **Cài đặt**, nhập endpoint, model và API key LLM đang dùng, rồi **Test LLM**. Đăng nhập profile DreamFace trên máy này và kiểm tra trạng thái sẵn sàng.
3. Nhập các ảnh MC muốn dùng. Nếu chỉ thử render, giữ chức năng tự đăng website/Facebook ở trạng thái tắt.
4. Nếu chuyển dữ liệu cũ sang máy khác, luôn giữ bản sao gốc. Đường dẫn file và phiên đăng nhập trình duyệt có thể phụ thuộc máy; kiểm tra media và đăng nhập lại dịch vụ cần thiết trước khi render. Bộ cài không tự mang theo tài khoản hay dữ liệu máy cũ.

## 3. Thử một tin trước

1. Research khoảng **5–10 tin** trong một chủ đề ngoài coin, sau đó thử thêm chủ đề coin nếu cần so sánh. Có thể nhập mục tiêu **1–100 tin**; số thực tế phụ thuộc nguồn hiện có và tin trùng sẽ được bỏ qua.
2. Chọn một tin chưa có video, nhập **1 video**, chọn MC rồi Render.
3. Mở **Hàng đợi → Đang xử lý**. Phải thấy bước chuẩn bị nguồn/lời đọc/ảnh trước bước tạo MC và xuất video. Các bước dùng dịch vụ ngoài có thể mất thời gian; xem trạng thái và lần cập nhật của đúng tin.
4. Nếu lỗi, mở **Có lỗi**: ghi nguyên văn thông báo, tiêu đề, ngày tạo và cập nhật. Dùng **Thử lại bước chuẩn bị** khi đó là lỗi trước khi có tác vụ video. Lần thử mới phải có thời gian mới và xuất hiện khi lọc **Hôm nay**.
5. Với dữ liệu có lỗi từ ngày trước, nhãn lỗi lịch sử phải hiện rõ; mở lại app không đổi ngày lỗi thành hôm nay. Máy có dữ liệu trống sẽ không có lịch sử này.
6. Mở **Hoàn tất**: Play, tua và nghe âm thanh. Kiểm tra tiêu đề/nguồn, MC và ảnh minh họa thuộc đúng tin. Nút mở thư mục phải chỉ đúng tệp. Nếu không tìm được ảnh phù hợp, video có thể dùng ảnh minh họa có nhãn hoặc thẻ tiêu đề/nguồn tin.

## 4. Thử chọn nhiều tin và xoay vòng MC

1. Research quản lý tin: thử checkbox từng tin, **Chọn trang này**, **Chọn tất cả … tin theo bộ lọc**, **Bỏ chọn tất cả**. Chuyển trang vẫn giữ lựa chọn; đổi bộ lọc bắt đầu lựa chọn mới.
2. Chọn vài tin thử không cần giữ và dùng Xóa. Hủy một lần, xác nhận một lần. Tin đang chuẩn bị/render được giữ lại; xóa tin không xóa video hay lịch sử bài đăng hiện có.
3. Chọn **4 tin đủ điều kiện**, **1 video mỗi tin**, **2 ảnh MC**, nhập **2 video mỗi MC**. Kết quả dự kiến theo thứ tự lô: MC A, A, B, B; lô dài hơn lặp lại vòng này.
4. Kiểm tra thanh thao tác báo đúng số tin/video trước Render. Khi chưa chọn, Render dùng tin đủ điều kiện trong bộ lọc. Tin đang chạy hoặc đã có video được bỏ qua trong thao tác hàng loạt; muốn tạo thêm phiên bản của một tin dùng **Render lại** trên tin đó.
5. Chọn giới hạn xuất video nhỏ, ví dụ **2**. Giới hạn này áp dụng ở bước FFmpeg xuất video; số tin đang chuẩn bị hoặc chờ dịch vụ MC không phải số video đang xuất. Luồng AI được cấu hình riêng.
6. Kiểm tra mỗi video thuộc đúng nguồn tin và MC đã phân. Cùng một tin có nhiều phiên bản là hợp lệ. Avatar Page phải nằm riêng với ảnh MC/media dựng video.
7. Chỉ tăng lên lô lớn sau khi luồng một tin và lô nhỏ đều đạt. Mỗi lượt News tối đa 100 video.

## 5. Lưu checkpoint kết quả trên máy thử

Tạo tệp `TEST_RESULT_v0.7.6.md` riêng trên máy thử và điền mẫu sau. Gửi kèm `CHECKPOINT_2026-11-02_v0.7.6.md` cho phiên hỗ trợ tiếp theo; checkpoint phát hành giữ nguyên để đối chiếu.

```text
Phiên bản: 0.7.6
Máy / Windows / CPU / RAM / GPU:
Ngày giờ và múi giờ:
Bộ chạy: Installer / Portable
Đường dẫn EXE:
Thư mục dữ liệu (Ứng dụng → Mở thư mục dữ liệu):
Dữ liệu mới hay chuyển từ máy cũ:
LLM Test: đạt / lỗi (model, không ghi API key)
DreamFace: sẵn sàng / lỗi
Chủ đề / tiêu đề / URL nguồn tin:
Số tin / số video mỗi tin / ảnh MC và số video mỗi MC:
Luồng AI / giới hạn xuất video:
Bước tái hiện và kết quả mong muốn:
Thông báo lỗi nguyên văn:
Ngày tạo / cập nhật trên thẻ Hàng đợi:
Kết quả Play / tua / âm thanh / đúng tin và MC:
Ảnh màn hình hoặc video mẫu:
```

Không đưa API key, cookie hoặc mật khẩu vào báo cáo công khai. Giữ dữ liệu gốc trên máy để đối chiếu. Nếu Hàng đợi hiển thị HTTP 503, cần kiểm tra thời điểm và thử kết nối hiện tại; không tự coi mọi lỗi lịch sử là một lỗi mới.

## Kiểm tra tệp tải về nếu cần

`SHA256SUMS.txt` chứa SHA-256 của các tệp phát hành. Trong PowerShell, chạy `Get-FileHash -Algorithm SHA256 -LiteralPath '.\Viral.Studio.0.7.6.exe'` hoặc thay bằng tên bộ cài rồi so sánh với dòng tương ứng.
