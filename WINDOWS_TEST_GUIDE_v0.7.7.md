# Kiểm tra Viral Studio 0.7.7 trên nhiều PC

Bộ phát hành dành cho **Windows 10/11 x64**. Máy chạy EXE không cần cài Node.js, Python hay FFmpeg. App đóng gói FFmpeg/ffprobe và font; xuất H.264 bằng CPU. Tốc độ phụ thuộc CPU, RAM, ổ đĩa và độ phức tạp của video. Nên bắt đầu với 1 lượt xuất và 2 render threads, rồi tăng sau khi đo trên máy đó.

Các luồng tạo MC mới cần Internet, Chrome/Edge và phiên đăng nhập dịch vụ tương ứng. Bộ kiểm tra ngoại tuyến bên dưới chạy độc lập với các dịch vụ này.

## Tải và mở

Tải từ [GitHub Release v0.7.7](https://github.com/minhpark89/viral-studio/releases/tag/v0.7.7):

- `Viral.Studio.0.7.7.exe`: Portable, phù hợp thử riêng trên từng PC.
- `Viral.Studio.Setup.0.7.7.exe`: Installer.
- `Test-Render-Windows.ps1`: phép thử render ngoại tuyến.
- `SHA256SUMS.txt`: đối chiếu SHA-256 bằng `Get-FileHash`.

Đặt Portable trong thư mục riêng có quyền ghi, ví dụ `D:\Viral Studio 0.7.7`. App tự tạo `Viral Data` cạnh EXE. Từ 0.7.7, Portable dùng dữ liệu cạnh nó; nếu thư mục mới trống, app sẽ mở một workspace mới. Có thể mở **Ứng dụng → Mở thư mục dữ liệu** để kiểm tra chính xác vị trí đang dùng. Không chép chỉ EXE vào thư mục tạm hoặc thư mục bị hạn chế quyền ghi.

## Chạy cùng phép thử trên mỗi PC

Đặt `Test-Render-Windows.ps1` cạnh Portable. Mở PowerShell tại thư mục đó và chạy:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Test-Render-Windows.ps1
```

Hoặc chỉ định EXE đã cài:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Test-Render-Windows.ps1 -AppPath "C:\Users\TEN_USER\AppData\Local\Programs\Viral Studio\Viral Studio.exe" -OutputDirectory "D:\Viral Render Results"
```

Script in hash của EXE, tạo một thư mục kết quả mới và gọi bộ kiểm tra nằm trong chính app. Không cần đăng nhập, mạng, API key hay lượt DreamFace. Nó không mở hàng đợi hoặc đọc workspace đang sử dụng.

Phép thử gồm:

1. Kiểm tra hai công cụ đóng gói và ghi hash vào báo cáo.
2. Kiểm tra 8 dạng MC: 3:4, 9:16, 4:3, 16:9, vuông, nhỏ cần phóng lớn, pixel không vuông và kích thước lẻ. Đo khung MC để phát hiện cắt lỗi hoặc kéo méo.
3. Xuất hai video News tổng hợp 13 giây, dùng MC 540×720 và 1056×792, ba ảnh nền, chữ, hiệu ứng chuyển cảnh và âm thanh.
4. Kiểm tra 1080×1920, H.264/AAC, thời lượng, giải mã toàn bộ và tín hiệu âm thanh.
5. Xuất thêm timeline 5 giây, 480×854, có thay đổi tốc độ clip, chữ tiếng Việt, logo và nhạc lặp; kiểm tra codec, thời lượng và giải mã.

Kết quả nằm trong `Render Test Results\run-...`:

- `RESULT.txt`: PASS/FAIL.
- `report.json`: cấu hình máy, phiên bản, hash FFmpeg, từng phép thử và thời gian.
- `NEWS-540x720.mp4`, `NEWS-1056x792.mp4`: mở cả hai, phát và tua qua giây 10; phải thấy bố cục đầy đủ và nghe tiếng tone.
- `TIMELINE.mp4`: kiểm tra chữ tiếng Việt, logo và nhạc ở cả đầu lẫn cuối video.
- `progress.log`: bước đang chạy hoặc bước lỗi.

PASS xác nhận render cục bộ với các mẫu này. Nó không xác nhận đăng nhập, mạng hoặc trạng thái dịch vụ DreamFace/LLM. Nếu FAIL, giữ `report.json` và `progress.log` để xác định bước lỗi; không tiếp tục chạy lô lớn.

## Mang dữ liệu từ PC cũ

1. Đóng app trên máy nguồn để hoàn tất ghi dữ liệu; sao lưu `Viral Data`.
2. Chép **cả thư mục** `Viral Data` cạnh Portable trên PC mới, bao gồm `studio.json`, `media`, `exports`, `thumbs` và các thư mục còn lại cần giữ.
3. Mở 0.7.7. App tự nối lại các đường dẫn media, thumbnail và preview tìm thấy trong bản sao, dù đổi ổ đĩa hoặc tên tài khoản Windows. Trước khi sửa đường dẫn, app lưu `studio.json.before-portability.bak` trong bản sao.
4. Kiểm tra Thư viện, mở video cũ và thử xuất một video trước khi tăng số lượt đồng thời.

App không thể khôi phục file chưa được chép. Chỉ đổi tên `studio.json` hoặc chép riêng file này không mang theo media. Đường dẫn công cụ tuyệt đối đã mất sẽ dùng FFmpeg/ffprobe đóng gói. Các thiết lập hiệu năng đã lưu được giữ nguyên; trên PC yếu hơn, chỉnh về 1 lượt xuất / 2 threads trước khi chạy lô.

Phiên đăng nhập trình duyệt có thể cần đăng nhập lại trên Windows khác. Kiểm tra một luồng **LLM → MC mới DreamFace → News → phát video** riêng trên mỗi máy sau khi phép thử ngoại tuyến đạt. Khi thử render cục bộ, tắt tạo nội dung/tự đăng nếu không muốn gọi các dịch vụ đó. Retry bước ghép dùng lại video MC đã lưu khi có sẵn.

## Ghi kết quả giữa các máy

| PC | Windows / CPU / RAM | SHA-256 EXE giống nhau | 8 kiểm tra MC | 2 News + 1 timeline | Phát/tua/âm thanh | Luồng MC mới |
| --- | --- | --- | --- | --- | --- | --- |
| PC A | | | | | | |
| PC B | | | | | | |

So sánh `elapsedMs` để chọn mức song song phù hợp cho từng máy. Chưa nên dùng việc một PC xuất thành công một mẫu để kết luận mọi PC hoặc mọi nguồn video đều đã được kiểm chứng.
