# Checkpoint v0.10.0 — V3 News mặc định

Người dùng đã duyệt mẫu V3 và yêu cầu tích hợp, cho chọn style, đặt V3 mặc định, phát hành bản tải về và lưu checkpoint. Ngày phát hành: 05/11/2026. Mọi lần sửa sau dùng version/tag mới, không thay asset của bản đã phát hành.

## Lấy đúng source và bộ cài

- Repository: https://github.com/minhpark89/viral-studio
- Release: https://github.com/minhpark89/viral-studio/releases/tag/v0.10.0
- Source cố định: tag `v0.10.0`; `git rev-parse "v0.10.0^{commit}"` cho commit.
- Installer: `Viral.Studio.Setup.0.10.0.exe`; Portable: `Viral.Studio.0.10.0.exe`.
- Checksum: `SHA256SUMS.txt`; manifest phát hành ghi commit và hash từng asset. `RELEASE_VALIDATION_v0.10.0.json` ghi phạm vi đã kiểm chứng.

## Bắt đầu session sau

1. Đọc file này và checkpoint local nếu có. Kiểm tra `git status`, version app và workspace đang hoạt động. Không mở Store ghi thứ hai vào workspace thật.
2. Windows x64, Node >=22.12; đã dùng Node 26.13.0. `npm ci`, `npm run setup:captions`, `npm run build`. Không nâng dependency khi chỉ tái hiện lỗi.
3. Tạo thư mục `STUDIO_DATA_DIR` thử riêng và `--user-data-dir` riêng khi chạy Electron/EXE. Đọc mới `.server-instance.json` trong workspace trước khi kiểm tra API; port thay đổi mỗi lần mở.
4. Source giữ FFmpeg/ffprobe trong `bin`. `setup:captions` tải whisper.cpp 1.7.6 và base.en theo SHA-256 trong `shared/news-caption-assets.json`, vào `runtime/news-captions` (không đưa binary/model này vào Git). Bản NSIS/Portable đã kèm tài nguyên đó dưới `resources/news-captions`.

```powershell
git clone https://github.com/minhpark89/viral-studio.git
cd viral-studio
git switch -c fix/v3-issue v0.10.0
npm.cmd ci
npm.cmd run setup:captions
npm.cmd run build
npm.cmd test
node tests/news-style-browser.mjs
```

## Hợp đồng style và bản đồ module

| Module | Trách nhiệm / điều phải giữ |
|---|---|
| `shared/news-format.js` | `newsRenderStyle`: `v3`, `v3-fast`, `classic`; mặc định `v3`. Ảnh auto: 8; mục tiêu 15/20/30s: 6/8/10. |
| `shared/production-contracts.js`, `server/news-plan.js`, `server/production.js` | Style đi từ request tới saved plan, job và production record. Category có enum; dateline chỉ dùng địa danh có trong nguồn; ngày footer là ngày report được cung cấp, không tự đặt ngày sự kiện. |
| `src/NewsVideoOptions.jsx` | Dropdown dùng ở Render và Research, nhớ theo project trong `studio-news-format:<projectId>`. Tùy chọn cũ thiếu style nhận V3, giữ độ dài/số ảnh. |
| `src/pages/ProductionPanel.jsx`, `Render.jsx`, `Manage.jsx` | Form render, giải thích V3 nhanh giữ Full HD, style và cảnh báo timing phụ đề trong Queue. Product không dùng style News. |
| `server/store.js` | Additive migration: job/batch/plan News cũ thiếu style được gán `classic`. Không đổi ID, presenter, media hoặc đưa bài đã đăng về nháp. |
| `server/news-render.js` | Dispatcher V3 hoặc renderer classic có sẵn. Kiểu cũ vẫn dùng direct/bounded theo RAM. |
| `server/news-v3-render.js` | Orchestrate font, captions, photo track, MC, chữ và audio; dùng encoder/import helpers thật. Render một pass, CQ18, 1080×1920/30fps. Hủy phải dừng tiến trình và dọn temp; giữ presenter cho Retry. |
| `server/news-v3-motion.js` | Scale/contain ảnh một lần rồi cache frame; perspective cubic dưới pixel, 4,5‰ zoom/giây, trần 1,8%; ảnh xen kẽ tĩnh. V3 nhanh bỏ zoom. Xfade 9 frame = 0,3s; không làm mất frame/tổng thời lượng. |
| `server/news-typography.js`, `news-render-common.js` | Fontkit đo đúng TTF đã bundle, không phụ thuộc Chrome; tự wrap/shrink trong giới hạn, không cắt mất headline/phụ đề. `drawtext` đọc textfile, expansion none. MC giữ display aspect ratio. |
| `server/news-captions.js` | CLI offline nhận dạng để lấy timing; align với script, không thay từ/nhân danh/số liệu theo ASR. Cache trên presenter với revision/size/mtime/script/duration; fallback có nhãn estimated. Không gửi audio ra ngoài. |
| `server/news-v3-editorial.js` | Header, source, date, headlines từ tin hiện tại; câu dài giữ headline chính. CTA tách tại đúng từ Read/See/Find kể cả script cũ thiếu dấu chấm. Ảnh nguồn và FILE/CONTEXT phân biệt; không tự tạo nhãn LIVE/BREAKING. |
| `server/image-search.js` | Giữ author/license/licenseUrl/date/context flag. V3 ghi credit ngoài ảnh và trong metadata MP4. |
| `server/render-self-test.js` | EXE chạy `--render-self-test=<thư mục mới>`; kiểm tra hình học, V3 mặc định, V3 nhanh, tiếng, thứ tự ảnh và runtime captions, không mở provider/scheduler. |

## Kích thước bố cục đã duyệt

Ảnh: x=0, y=272, w=1080, h=720. MC: x=64, y=1064, 240×300. Headline: x=338, y=1124, tối đa 4 dòng; phụ đề: x=90, y=1428 trong panel y=1408..1540. Mọi text/credit/MC nằm ngoài ô ảnh. Header NEWS UPDATE, category của tin; chữ phụ đỏ `#ff687b`, tab đỏ `#b91e37`, nền navy `#101f34`. Không còn VIRAL NEWS / ARCHIVE / DESIGN REVIEW của mẫu thử.

## Kiểm tra và chẩn đoán

Bản phát hành đã qua 432/432 test tự động, browser test chọn/lưu/gửi ba style và toàn bộ workspace. EXE đóng gói kiểm tra 11 ca trên NVIDIA RTX 3060; Portable kiểm tra 11 ca ở chế độ CPU. Hai bộ này dùng thời lượng và số ảnh khác nhau nên không dùng để so tốc độ GPU/CPU. 101 file runtime/frontend/font trong ASAR khớp source đã kiểm tra; model và thư viện offline khớp hash. Cài nâng cấp thực tế giữ nguyên dữ liệu, tài khoản và thiết lập; chỉ bổ sung `classic` cho các record News cũ. Chi tiết nằm trong `RELEASE_VALIDATION_v0.10.0.json`.

```powershell
node --test tests/news-v3.test.js tests/news-narration.test.js tests/production.test.js tests/queue.test.js
node tests/news-style-browser.mjs
node tests/workspaces-browser.mjs
npm.cmd run pack:release
```

Test runtime trên EXE: `scripts/Test-Render-Windows.ps1` hoặc `Viral Studio.exe --render-self-test=<empty-folder> --render-self-test-gpu`. Nếu không có GPU phù hợp, chủ động chọn CPU / bỏ flag GPU. NVIDIA đã kiểm tra trên RTX 3060; không suy diễn đã thử phần cứng AMD/Intel.

Khi báo lỗi, ghi version/commit/EXE hash, style, số ảnh thực tế, font, GPU/CPU, hình/tỷ lệ MC, bước tái hiện và message/code. Output media có `newsRenderStyle`, `newsRenderMetrics`, `newsCaptionTiming`, `newsCaptionWarning`, `newsLayout` (text-fit, shots và transitions), `newsPhotoCredits`. Cần căn lại phụ đề: kiểm tra `presenter.newsCaptionCache`, revision/key và resource manifest; không xóa presenter hay tạo MC mới để sửa lỗi local render.

Giới hạn: ASR tiếng Anh có thể không khớp giọng/âm thanh; script vẫn giữ nguyên và timing chuyển sang estimated có cảnh báo. Ảnh thiếu/không đúng nội dung không được tự bù ảnh sai. Nguồn ảnh nhỏ không thể tự tăng chi tiết. V3 có thể dùng ít hơn số ảnh mục tiêu để giữ đủ thời gian nhìn ảnh. Ngày report khác ngày chụp ảnh; chỉ hiện thông tin thời gian có trong dữ liệu.

## Rollback và dữ liệu

Giữ bộ cài 0.9.1 và backup dữ liệu/runtime của PC trước nâng cấp. Đổi style sang Kiểu cũ nếu chỉ cần bố cục trước. Khi rollback phần mềm, không restore một file `studio.json` cũ lên dữ liệu đã phát sinh thêm sau đó: có thể mất ID bài đã đăng/media mới hoặc khôi phục tham chiếu đã dọn. Token, cookie, profile và backup không được đưa lên GitHub.

File checkpoint local ngoài repo ghi nơi cài, data pointer, backup và bằng chứng riêng của PC phát hành. Bản này không gọi DreamFace/LLM hay đăng bài thật để kiểm thử; kiểm tra dùng workspace riêng và MC checkpoint đã có.
