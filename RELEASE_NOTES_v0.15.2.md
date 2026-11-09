# Viral Studio v0.15.2 — News + Product thống nhất, ảnh V3 đầy khung hơn

Gộp Product Studio/Research từ 0.15.0 với các sửa lỗi đã kiểm chứng trên KAD22P5 và tối ưu cách trình bày ảnh V3.

- Ảnh ngang phù hợp lấp đầy khung; ảnh dọc/vuông, source card và ảnh tài liệu nhận diện qua metadata giữ trọn hình, với nền mờ từ chính ảnh đó. Bố cục V3, MC và phụ đề được giữ.
- Ưu tiên ảnh ngang rõ và đa dạng trong các ảnh đúng chủ thể; không dùng ảnh không liên quan để đủ số lượng.
- Sửa DreamFace profile mới chưa tải My Image, LLM hết output budget và thiếu Visual C++ runtime trên Windows mới. Giữ nguyên Product multimodal/tiếng Việt.
- Máy mới tự kiểm GPU thực tế và dùng CPU khi cần. Các lựa chọn GPU/CPU đã lưu không bị đổi.
- Installer và Portable cùng kèm runtime caption và bộ cài Microsoft được kiểm hash/chữ ký. Diagnostic offline kiểm cả ảnh ngang và dọc.

Chọn `Viral.Studio.Setup.0.15.2.exe` để cài, hoặc `Viral.Studio.0.15.2.exe` để chạy Portable. Giữ `Viral Data` riêng của từng máy. Video đã xuất không tự thay đổi; muốn có cách trình bày mới cần render lại. Job đã lưu ba ảnh vẫn dùng ba ảnh nếu chỉ retry render.

Kiểm chứng: 532/532 backend tests; News Studio và Product Research chạy trong EXE; 11/11 render CPU và 11/11 Intel QSV trên KAD22P5. Đã dựng và xem lại video 15 giây bằng ảnh/MC có sẵn, kiểm decode toàn bộ và đối chiếu trước/sau. Không gọi thêm dịch vụ tạo MC trả phí hay đăng video cho các kiểm tra này.

Checkpoint đầy đủ: [CHECKPOINT_v0.15.2.md](https://github.com/minhpark89/viral-studio/blob/v0.15.2/CHECKPOINT_v0.15.2.md). Kết quả kiểm thử và giới hạn: `RELEASE_VALIDATION_v0.15.2.json`; source commit/checksum: `RELEASE_MANIFEST_v0.15.2.json`, `SHA256SUMS.txt`. Các phiên bản sau bắt đầu từ `CHECKPOINT_CURRENT.md` và `RELEASE_RUNBOOK.md`.
