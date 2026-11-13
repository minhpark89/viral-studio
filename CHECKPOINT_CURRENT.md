# Current local candidate: v0.15.3 — ảnh News và thử lại lỗi

Bắt đầu tại [CHECKPOINT_v0.15.3.md](CHECKPOINT_v0.15.3.md), [hướng dẫn](RELEASE_NOTES_v0.15.3.md) và [validation](RELEASE_VALIDATION_v0.15.3.json). Nhánh `fix/news-quality-0.15.3`, base `b8caa9535684b811f3fdf0f216b2b35345c39da4`. Bản đóng gói cục bộ, chưa push/publish/deploy; KAD22P5 vẫn dùng 0.15.2.

---

# Published baseline: v0.15.2 — News / Product thống nhất và ảnh V3

Bắt đầu tại [CHECKPOINT_v0.15.2.md](CHECKPOINT_v0.15.2.md), [validation](RELEASE_VALIDATION_v0.15.2.json) và [quy trình phiên bản sau](RELEASE_RUNBOOK.md). [Bộ cài/source chuẩn](https://github.com/minhpark89/viral-studio/releases/tag/v0.15.2). Manifest đi kèm release xác định commit và SHA-256 chính xác.

Bản này gồm Product 0.15.0, sửa lỗi máy mới từ 0.15.1 và ảnh V3 cover/nền mờ theo tỷ lệ. Dùng mốc này để sửa tiếp trên mọi PC; giữ dữ liệu và tài khoản riêng từng máy.

---

# Historical: v0.15.1 — Unified News / Product / Windows portability

Start at [CHECKPOINT_v0.15.1.md](CHECKPOINT_v0.15.1.md). This combines the 0.15.0 Product/News workspace with the verified KAD22P5 LLM and DreamFace fixes, bundled Windows prerequisite and automatic GPU/CPU selection for new workspaces. GitHub publication is a separate action; check the accompanying manifest and local Git commit rather than assuming a tag exists.

---

# Historical: v0.15.0 — News Studio / Product Studio

Mốc đồng bộ mới: [CHECKPOINT_v0.15.0.md](CHECKPOINT_v0.15.0.md), [release notes](RELEASE_NOTES_v0.15.0.md), [validation](RELEASE_VALIDATION_v0.15.0.json).

Source/tag và bộ cài: https://github.com/minhpark89/viral-studio/releases/tag/v0.15.0

Codex đang sửa lỗi News trên máy khác cần lưu commit/patch trước khi nâng cấp, ghép với source mới và chạy lại ca lỗi trên máy đó. Không chép source hoặc dữ liệu cũ đè cả bản mới. Các checkpoint bên dưới là lịch sử.

---

## Historical notes

# Checkpoint — Viral Studio v0.10.2 bản thử

Bắt đầu tại [CHECKPOINT_v0.10.2.md](CHECKPOINT_v0.10.2.md). Bản này tối ưu profile, truyền dữ liệu giao diện, đo dung lượng và lưu trữ tin đã đăng; sửa tiêu đề V3 và shutdown. [Hướng dẫn ổ dữ liệu/máy mới](HUONG-DAN-O-DU-LIEU-v0.10.2.md).

- Bản thử: tag `v0.10.2`, nhánh `release/v0.10.2`, [trang tải](https://github.com/minhpark89/viral-studio/releases/tag/v0.10.2).
- [Release notes](RELEASE_NOTES_v0.10.2.md), [validation](RELEASE_VALIDATION_v0.10.2.json), checksum đi cùng bộ cài.
- Bản ổn định trước: [v0.10.1](CHECKPOINT_v0.10.1.md). Máy phát triển vẫn giữ app/dữ liệu 0.10.1, kiểm tra bản mới trong workspace riêng.
- Token/cookie/profiles/dữ liệu người dùng không nằm trong source hoặc release. Không mở Store ghi thứ hai trên workspace đang chạy. Xem checkpoint phiên bản về archive/khôi phục trước khi rollback.
