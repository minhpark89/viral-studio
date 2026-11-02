# Viral Studio 0.7.9-local.1 — GPU và profile

Bản cục bộ dựa trên 0.7.8, chưa phát hành lên GitHub. Bộ cài và Portable nằm trong `release/v0.7.9-local.1`. Khi đưa sang PC khác, dùng đúng bản mới này để có tính năng GPU/profile; link public 0.7.8 chưa chứa các thay đổi này.

## Dùng trên máy khác

1. Sao lưu dữ liệu rồi đóng app và profile trước khi cài. Máy này đã giữ backup riêng; không chép thư mục backup có tài khoản sang nơi công khai.
2. Chạy Installer hoặc Portable. Portable có thư mục dữ liệu riêng cạnh EXE; đừng chạy nhầm bản riêng rồi tưởng mất tài khoản. Muốn chuyển dữ liệu, chép toàn bộ workspace khi các trình duyệt đã đóng; đường dẫn media được kiểm tra và chuyển lại trên máy đích. Phiên đăng nhập mã hóa bởi Windows/Chrome có thể cần đăng nhập lại trên PC khác.
3. Mở **Cài đặt → GPU & bộ mã hóa** hoặc bấm trạng thái GPU trên thanh đầu. App nhận lại GPU trên chính máy đang chạy, thử mã hóa/giải mã file 1080×1920 rồi chọn NVENC, AMF hoặc QSV hoạt động.
4. NVIDIA: bấm **Tìm bản NVIDIA phù hợp**. Chỉ hiển thị phiên bản cụ thể khi dữ liệu chính thức của NVIDIA liệt kê đúng model và Windows; nếu chưa khớp, dùng trang chọn driver của hãng. AMD/Intel có liên kết driver chính thức khi encoder chưa hoạt động. Việc hỗ trợ encode còn tùy GPU, driver và bộ FFmpeg.
5. Cài driver theo đề xuất rồi **Kiểm tra GPU** lại. Nếu hãng yêu cầu khởi động lại, hoàn thành trước khi render. Cấu hình mặc định yêu cầu GPU hoạt động; lỗi GPU được báo trước bước tạo MC mới, giữ MC/ảnh đã có để thử lại. Có thể chủ động chọn CPU tương thích trong cài đặt khi cần.

GPU xử lý mã hóa video. Chữ, hiệu ứng và âm thanh vẫn có phần chạy CPU, nên mức sử dụng GPU thấp không có nghĩa app dùng encoder CPU. Job/output lưu tên encoder thực tế; app không âm thầm chuyển từ chế độ yêu cầu GPU sang CPU.

Máy RTX 3060 hiện tại đã kiểm tra thực tế với driver WHQL 621.01. AMF/QSV đã có nhánh lựa chọn và kiểm tra lỗi tự động, nhưng chưa được thử trên card AMD/Intel vật lý trong lượt này. Không hứa mọi GPU đều có bộ mã hóa tương thích.

## Giữ profile gọn

**Tối ưu dung lượng profile** bật mặc định và có hiệu lực từ lần mở profile tiếp theo:

- Giới hạn HTTP cache 64 MiB, media cache 32 MiB; dọn Code Cache vượt 32 MiB và các shader cache được liệt kê vượt 16 MiB trước khi mở.
- Hạn chế mô hình AI cục bộ của Chrome tải nền; dọn các thư mục mô hình có thể tái tạo đã tồn tại.
- Giữ cache nhỏ để giảm tải lại. Không xóa cookie, mật khẩu, Local Storage, IndexedDB, Service Worker, Session Storage, Sessions, Preferences, Local State hoặc extension.
- Bỏ qua profile đang mở/chạy tác vụ và trường hợp không xác minh được tiến trình. Không đi qua junction/symlink trong vùng cache.

Nút **Dọn cache profile đang đóng** dọn toàn bộ cache trong danh sách cho phép. Lần tải đầu có thể chậm hơn khi cache được tạo lại. Các giới hạn áp dụng cho từng loại cache, không phải trần cứng cho toàn bộ profile; dữ liệu trang web và phiên đăng nhập vẫn tăng theo nhu cầu.

## Kiểm tra trên EXE của từng PC

Chạy PowerShell từ thư mục có script:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Test-Render-Windows.ps1 -AppPath '.\Viral.Studio.0.7.9-local.1.exe' -Gpu
```

`-Gpu` yêu cầu GPU thật, kiểm tra hình học MC, News 5/10 ảnh đúng thứ tự, âm thanh, giải mã toàn bộ đầu ra và timeline. Không có tham số này thì chạy chẩn đoán CPU tương thích. Kết quả trong `Render Test Results`, gồm `report.json`, `RESULT.txt` và video mẫu. Không gọi tài khoản/provider và không dùng credit. Với máy yếu, giữ mặc định 1 lượt render/2 threads rồi tăng dần sau khi đo.

Nếu thiếu GPU/driver phù hợp, bài kiểm tra GPU sẽ báo FAIL để xử lý đúng nguyên nhân; không dùng PASS của bài CPU để kết luận GPU hoạt động.
