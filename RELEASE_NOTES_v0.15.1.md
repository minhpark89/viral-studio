# Viral Studio 0.15.1 — bản thống nhất News và Product

Kế thừa toàn bộ News Studio, Product Studio, Product Research và thư mục Output độc lập của 0.15.0, đồng thời ghép các sửa lỗi đã kiểm chứng trên DESKTOP-KAD22P5.

- DreamFace: profile mới tải lịch sử My Image trước khi tạo ảnh MC; giữ receipt để tránh gửi trùng.
- LLM: khi hết giới hạn output, thử lại một lần với giới hạn lớn hơn trong cùng thời gian chờ. Giữ đầy đủ ảnh và ngôn ngữ tiếng Việt của Product.
- Windows x64: Installer và Portable kèm Microsoft Visual C++ Runtime được kiểm checksum/chữ ký. Nếu thiếu DLL, app chạy bộ cài đi kèm, xin quyền Windows và kiểm tra lại; không tự reboot.
- Máy mới mặc định chọn GPU đã kiểm tra hoạt động, hoặc dùng CPU. Lựa chọn GPU/CPU đã lưu vẫn được giữ.
- Bố cục, nền và chuyển cảnh V3 giữ như 0.15.0. Việc tối ưu ảnh dọc để giảm nền trống chưa nằm trong bản này.

Kiểm chứng: 528/528 backend; ba bộ browser; News Studio và Product Research trong EXE; 11/11 render CPU và 11/11 render Intel QSV trên KAD22P5. Nâng cấp máy thật giữ nguyên các ID dự án, tài khoản, media, job, tin và bài viết; key LLM không đổi. Chi tiết, giới hạn kiểm thử và hướng dẫn tiếp tục nằm trong `CHECKPOINT_v0.15.1.md` và `RELEASE_VALIDATION_v0.15.1.json`.

Dùng Installer để cài mới/cập nhật bản cài, hoặc Portable bên cạnh dữ liệu riêng. Giữ `Viral Data` của từng PC; không chép profile/key/dữ liệu máy build sang máy chạy. Windows có thể yêu cầu quyền Administrator một lần khi cài Visual C++ còn thiếu. Bộ cài này dành cho Windows 10/11 x64; kết nối DreamFace/LLM vẫn cần tài khoản và mạng hoạt động.
