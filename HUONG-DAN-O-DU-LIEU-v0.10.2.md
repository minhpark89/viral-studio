# Dùng Viral Studio 0.10.2 trên máy khác và ổ riêng

Bản thử 0.10.2 dành cho Windows x64. Chọn **Portable** nếu muốn đặt app và dữ liệu làm việc trong một thư mục trên ổ riêng. Bộ cài Installer cũng đi kèm để dùng như ứng dụng Windows thông thường.

1. Tạo thư mục, ví dụ `E:\ViralStudio`. Chép `Viral.Studio.0.10.2.exe` vào đó rồi mở. Không chạy trực tiếp từ thư mục Downloads nếu muốn dữ liệu nằm trên E.
2. Portable tự tạo `E:\ViralStudio\Viral Data`. Profile, cookie, media, render tạm, metadata và kho tin nằm tại đây. Giữ nguyên thư mục này khi thay EXE bằng phiên bản mới. Không ghi đè workspace đã có bằng dữ liệu cũ.
3. Vào **Cài đặt → Ổ dữ liệu & tin đã dùng**, kiểm tra đường dẫn và dung lượng trống. Menu **Ứng dụng → Mở thư mục dữ liệu** mở đúng thư mục đang dùng.
4. Kiểm tra **GPU & bộ mã hóa**. Nếu máy không có GPU/driver phù hợp, chọn **CPU · chế độ tương thích**. Bộ cài có FFmpeg, font và runtime căn phụ đề offline; không cần cài Node.js hoặc FFmpeg riêng. Chrome hoặc Edge cần được cài cho các profile đăng nhập dịch vụ.
5. Bắt đầu bằng một profile và một video, render đồng thời 1. Đối chiếu hình, âm thanh, caption rồi tăng lên 2 nếu máy đáp ứng. Không suy rộng tốc độ đo trên máy phát triển sang mọi máy khác.

Với Installer, chọn thư mục cài trên ổ riêng, ví dụ `E:\Viral Studio`. Cài mới mặc định để dữ liệu tại thư mục bên cạnh app: `E:\Viral Studio.data\Viral Data`. Khi nâng cấp một bản đã có, installer giữ đường dẫn dữ liệu cũ; đổi thư mục cài không tự di chuyển toàn bộ dữ liệu. Luôn xem đường dẫn thực trong Cài đặt. Windows và bộ giải nén Portable vẫn có thể dùng thư mục tạm/cache hệ thống trên C; phần dữ liệu làm việc lớn thuộc thư mục đã nêu.

**Kiểm tra offline trên máy mới:** đặt `Test-Render-Windows.ps1` cạnh Portable, mở PowerShell tại đó và chạy:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Test-Render-Windows.ps1 -AppPath .\Viral.Studio.0.10.2.exe
```

Thêm `-Gpu` để kiểm tra GPU. Lệnh chỉ áp dụng execution policy cho tiến trình kiểm thử; không đổi policy máy. Test dùng dữ liệu tổng hợp, không gọi DreamFace/LLM, không đăng bài và không dùng quota. Kết quả trong `Render Test Results`; mở các MP4 và `RESULT.txt` để kiểm tra trực tiếp. CPU và GPU dùng đầu vào thử khác nhau nên không so thời gian hai lượt với nhau.

**Dữ liệu và dung lượng:** giữ tối ưu profile bật. 50–100 profile và khoảng 100 clip 30–60 giây/ngày có thể dự trù 200 GiB với hàng chờ/dự phòng 7 ngày và khoảng trống làm việc; mức thực tế phụ thuộc video và số ngày tồn hàng. Đây không phải cấu hình giữ video 7 ngày: video/MC/ảnh đủ điều kiện vẫn được dọn khi Meta và bình luận đầu tiên thành công.

Tin đã đăng hơn 30 ngày được nén vào `Viral Data\history\research` khi không còn media, bản nháp hay tác vụ cần xử lý; ID và nguồn chống trùng vẫn hiện trong lịch sử. Xem **Research → Đã lưu trữ → Khôi phục tin** để lấy lại đầy đủ nội dung văn bản. Có thể tắt tự lưu trữ trong Cài đặt. Job/batch/publication vẫn giữ để bảo toàn retry và lịch sử; bản này không tự xóa backup/build của người dùng.

Muốn chuyển dữ liệu giữa máy, đóng app và tác vụ trên máy nguồn rồi sao lưu **toàn bộ** thư mục dữ liệu, bao gồm `history`, `.private`, `profiles` và `studio.json`. File media được nối lại theo thư mục mới; cookie Chrome có thể cần đăng nhập lại trên máy khác. Không trộn hai workspace đang phát sinh dữ liệu. Dùng workspace mới để thử bản này trước khi chuyển công việc chính.

Gói tải chỉ chứa phần mềm và tài liệu, không chứa tài khoản, token, cookie hay workspace của máy phát triển. EXE hiện chưa có chữ ký số thương mại. Đối chiếu tên phiên bản và SHA-256 trong `SHA256SUMS.txt` nếu Windows yêu cầu kiểm tra nguồn tải.
