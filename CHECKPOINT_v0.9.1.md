# Checkpoint v0.9.1 — tiếp tục sửa trên PC hiện tại hoặc PC khác

Chốt phát hành ngày 05/11/2026. Tài liệu này đi cùng tag `v0.9.1`, không phụ thuộc thư mục private của máy phát hành.

## Source và bản cài

- Repo: https://github.com/minhpark89/viral-studio
- Release: https://github.com/minhpark89/viral-studio/releases/tag/v0.9.1
- Tag cố định: `v0.9.1`; lấy commit bằng `git rev-parse "v0.9.1^{commit}"`. `main` là nhánh tiếp tục phát triển.
- Installer: `Viral.Studio.Setup.0.9.1.exe`, SHA-256 `0c4c554d76514d64171fb34eda2737f170e14a20d62bc8c42b0d331397087ed0`.
- Portable: `Viral.Studio.0.9.1.exe`, SHA-256 `3f3ee32c02bac0e02ec9481b1fb8a8ca9e9e2f58db6ad5cbccf85c0e020e6081`.
- Runtime `resources/app.asar`: SHA-256 `4e9f434a93bd71400a7d4112ea548bb0bd6acbb5f50fb85715d35d0df75b4325`.
- Đây là đúng bộ cài 0.9.1 đã chạy và cài thử ngày 04/11. Lượt phát hành bổ sung tài liệu tiếp tục công việc, không đổi runtime. Hash tải công khai được đối chiếu khi phát hành.
- Release có `SHA256SUMS.txt`, `RELEASE_VALIDATION_v0.9.1.json`, `RELEASE_MANIFEST_v0.9.1.json` và checkpoint này. Manifest ghi commit của tag và hash từng asset.

## Bắt đầu trên PC khác

Windows, Node.js >=22.12.0; `.node-version` ghi phiên bản Node của dự án. Kiểm thử phát hành chạy với Node 26.13.0. Dùng lockfile, không cập nhật dependency khi chỉ tái hiện lỗi.

```powershell
git clone https://github.com/minhpark89/viral-studio.git
cd viral-studio
git fetch origin --tags
git switch -c fix/091-issue v0.9.1
npm.cmd ci
npm.cmd run build
npm.cmd test
npx.cmd playwright install chromium
node tests/research-discovery-browser.mjs
node tests/page-groups-browser.mjs
```

`npm ci` cần thư mục `node_modules` vật lý khi đóng gói Electron. Build trước test vì các test HTTP cần `dist`. Hai bài browser tự tạo dữ liệu giả lập và chặn nguồn ngoài; không cần tài khoản thật. Chúng ghi bằng chứng ở `.verification` và thư mục `.maintenance` cạnh repo, nên chạy trong nơi có quyền ghi.

Mở source với một workspace thử mới:

```powershell
$env:STUDIO_DATA_DIR = Join-Path $env:TEMP ('Viral-Studio-091-QA-' + [guid]::NewGuid().ToString('N'))
npm.cmd run desktop -- --user-data-dir="$env:STUDIO_DATA_DIR\electron-profile"
```

Biến môi trường trên chỉ áp dụng terminal hiện tại. Mở terminal mới khi quay về workspace thật. Có thể dùng cùng `STUDIO_DATA_DIR` và `--user-data-dir` khi chạy EXE tải về để tái hiện lỗi trên runtime đóng gói.

## Bắt đầu trên PC đang dùng

1. Đọc checkpoint local ngoài repo nếu có, rồi `git status`, `git branch --show-current` và version hiển thị trong app. Trên PC phát hành, source chính vẫn là thư mục `studio`; checkpoint local ghi nơi cài, workspace, backup và bằng chứng riêng.
2. Dữ liệu source mặc định ở `.studio`; Portable dùng `Viral Data` cạnh EXE. Bản đã cài đọc `data-location.txt` UTF-16LE hoặc thư mục `Viral Studio.data/Viral Data` cạnh nơi cài. `STUDIO_DATA_DIR` có ưu tiên cao nhất. Xem `desktop/data-directory.cjs`.
3. Đọc mới `<workspace>/.server-instance.json` để biết PID/address đang sở hữu dữ liệu; port đổi mỗi lần mở. `GET /api/health` trả version và dataDir. Không khởi tạo một Store ghi thứ hai vào workspace đang chạy.
4. Khi sửa, tạo nhánh mới từ tag hoặc `main` đã cập nhật, giữ các thay đổi chưa commit. Lưu dữ liệu hiện tại trước thao tác sửa dữ liệu hoặc cài đè.

## Đã sửa trong 0.9.1

Research trước đây chỉ đọc một truy vấn, lọc từ nửa đêm Mỹ và có thể gọi lượt 23/50 là hoàn tất. Bản này tự mở rộng trong cùng chủ đề, giữ tin đã lưu, cho lấy tiếp phần thiếu và ghi checkpoint cả giai đoạn tìm nguồn.

| Phần | Module chính | Điều phải giữ khi sửa |
| --- | --- | --- |
| Tìm nguồn và từ khóa | `server/research-discovery.js`, `server/research.js` | Giữ neo chủ đề, nguồn có thật, thời gian đăng và chống trùng. Độ phủ nguồn không phải lượt xem/chia sẻ viral. |
| Batch, hủy và tiếp tục | `server/research-batches.js` | Lưu candidate trước khi soạn; giữ item index/resultId; chỉ completed khi đủ số. Lượt cũ thiếu thành partial, không tự research lại khi nâng cấp. |
| Form và tiến độ | `src/pages/Research.jsx`, `src/ResearchBatchProgress.jsx`, `src/pages/research.css` | Tiến độ theo target, truy vấn/từ khóa có thể xem, nút tìm tiếp phần thiếu. |
| Giới hạn và nội dung | `shared/research-contracts.js`, `shared/mc-rotation.js`, `server/production.js` | Research 1–1.000; render News vẫn tối đa 100. Không gọi LLM/render khi không có nguồn; hủy phải truyền tới tìm nguồn. |
| Chọn Page, sửa nhóm/pool | `src/pages/GroupMemberPicker.jsx`, `GroupDialog.jsx`, `Management.jsx`, `Pages.jsx`, `Social.jsx` | Tick/Shift/kéo, chọn toàn bộ kết quả lọc, giữ lựa chọn ẩn và ID khi sửa pool. |
| Credential và phân phối | `server/page-routing.js`, `meta.js`, `management.js`, `social.js`, `social-scheduler.js` | Không dùng credential ngoài pool; giữ phạm vi Page cũ, phân công, cursor và khoảng cách Page/token/nhóm qua restart. Không đưa bài đã đăng về nháp. |

- Độ mới mặc định 24 giờ liên tục; tùy chọn 72/168 giờ, không tự nới cửa sổ thời gian. Không lấy tin tương lai hoặc lặp nguồn để đủ số.
- Discovery tăng lượt tìm theo count, tối đa 160 truy vấn; dừng khi đủ hoặc không thêm tin sau 4 lượt liên tiếp và đã thử ít nhất 12 truy vấn. Mỗi feed tối đa 150 mục, timeout 12 giây, mỗi lượt tối đa 3 nguồn song song.
- Nếu đã có 23/50, bấm **Tìm tiếp phần thiếu (27 tin)**. `/api/research/batches/:id/retry` chỉ bổ sung phần thiếu và retry item lỗi; các result đã lưu giữ nguyên.
- Tìm kiếm có thể hết nguồn hoặc timeout. Khi đó báo số thực tế và cho thử lại; không cam kết tạo đủ tin khi không có nguồn hợp lệ.
- Hướng dẫn lịch đăng/pool: [HUONG-DAN-NHOM-PAGE-POOL.md](HUONG-DAN-NHOM-PAGE-POOL.md).

## Kiểm chứng đã có

- **424/424 test tự động**, gồm hủy/restart, refill 23 → 50 giữ 23 bản ghi, tin cũ/trùng/sai chủ đề/tương lai, cửa sổ qua nửa đêm, RSS lỗi và 1.000 nguồn giả lập.
- Browser Research: 23/50 → bổ sung 27 → 50/50, từ khóa/truy vấn, layout mobile; không ghi dịch vụ ngoài.
- Browser nhóm/pool: 100 Page/30 token, tick/Shift/kéo, chọn qua bộ lọc, sửa pool giữ ID/phạm vi, lịch và layout mobile.
- Windows unpacked, Portable thực tế và bản NSIS đã cài đều chạy; bản cài giữ nguyên dữ liệu hiện hành. Hai bộ cài có cùng runtime hash ở trên.
- Một lần kiểm tra RSS trực tiếp ngày 04/11/2026 với chủ đề `donal trump wars` và loại tin đã có tìm đủ 50 tin qua 4 truy vấn. Đây là kết quả tại thời điểm kiểm tra, không phải cam kết nguồn ngày sau giống nhau.
- Đối chiếu lại source/runtime, dependency/binary, installer metadata và checksum trước upload; kiểm tra tải công khai sau publish. Xem validation/manifest đi cùng release.

Các lệnh kiểm tra tập trung khi sửa:

```powershell
node --test tests/research-discovery.test.js tests/research-batches.test.js tests/research.test.js tests/production.test.js
node --test tests/page-groups.test.js tests/social-cadence.test.js tests/social.test.js
```

## Nếu gặp lỗi

- Ghi version + commit/hash EXE, hệ điều hành/Node, bước tái hiện, điều mong đợi/thực tế và lỗi hiển thị.
- Research: giữ request topic/count/windowHours, batch status, discovery queries/suggestions, warnings/error và trạng thái items. Không xóa tin cũ để thử lại. Loại token, khóa LLM, cookie và proxy credentials khỏi log đính kèm.
- Nhóm/pool: kiểm tra Page membership, scope, pool assignment, binding fingerprint/verification, schedule config và nhật ký khoảng cách. Chỉ dùng fixture để test tự động đăng; không bật Auto Post trên workspace thật để tái hiện.
- Code rollback: dùng source/tag hoặc bộ cài trước. Không restore `studio.json` cũ một mình sau khi người dùng đã làm việc mới vì có thể mất ID bài đã đăng hoặc làm sống lại đường dẫn media đã dọn. Backup dữ liệu không nằm trên GitHub.
- Khi fix xong, chạy kiểm thử phù hợp và kiểm tra EXE thật trước bàn giao. Bản tiếp theo dùng version/tag mới, không ghi đè asset/tag v0.9.1 đã phát hành.
