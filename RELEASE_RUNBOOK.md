# Quy trình phát hành và checkpoint Viral Studio

## Nguồn chuẩn

Đọc `CHECKPOINT_CURRENT.md`, manifest của release hiện hành và checkpoint phiên bản trước. So sánh `git status`, `git log`, `git ls-remote origin refs/heads/main`; giữ patch chưa commit của người đang làm. Dùng source tag/commit cùng bộ cài. Không ghép bằng cách đè toàn bộ file News/Product từ bản cũ. Tăng version khi thay EXE đã giao, đồng bộ `package.json`, `package-lock.json` và `scripts/Test-Render-Windows.ps1`.

## Mỗi checkpoint phải có

- Version/ngày, base tag/commit, phạm vi News/Product/desktop bị đổi và phần cần giữ tương thích.
- Triệu chứng, nguyên nhân có bằng chứng, cách tái hiện, mã lỗi, file đã sửa và test chống tái diễn.
- Kết quả thực tế: số test pass/fail, renderer/CPU/GPU, máy/OS, duration/resolution/fps/audio, ảnh/frame kiểm bằng mắt. Phân biệt unit mock, source test, packaged test và máy thật.
- Giới hạn chưa kiểm; không ghi “mọi PC đều chạy” chỉ từ một máy.
- Các đường dẫn EXE/data/backup/diagnostic, trạng thái nâng cấp, cách rollback và cảnh báo mất bản ghi nếu phục hồi state cũ.
- Việc còn lại. Giữ checkpoint cũ như lịch sử; chỉ cập nhật `CHECKPOINT_CURRENT.md` trỏ tới bản mới. Manifest đính kèm ghi source commit chính xác để tránh vòng lặp tự ghi hash vào commit.

## Kiểm chứng trước phát hành

1. `npm ci`; `npm run setup:captions`; `npm run setup:windows`. Dùng Node >=22.12. Kiểm SHA-256 và Authenticode Microsoft của VC++ installer. Không dùng DLL tải rời không rõ nguồn.
2. Chạy test phù hợp với thay đổi; release thống nhất chạy `npm test`. Khi chạm frontend, chạy bộ browser liên quan. Khi chạm News/Product chung, chạy cả packaged `node tests/news-studio-desktop.mjs` và `node tests/product-research-desktop.mjs`.
3. `npm run pack:release` (script dùng `--publish never`). Chạy packaged CPU diagnostic, và GPU diagnostic trên máy GPU thật nếu có; lưu `report.json`/`RESULT.txt`. Khi sửa hình ảnh, xem frame/video thật và kiểm toàn bộ decode, không chỉ exit code.
4. Nếu nâng cấp máy người dùng: kiểm jobs/batches idle, đóng app bình thường, backup state sau khi app flush, rồi thay EXE. Portable có tiến trình wrapper còn dọn thư mục tạm sau khi server đã đóng: đợi wrapper nhả EXE trước khi thay, không chỉ đợi mất `.server-instance.json`. Nếu file còn bị khóa, giữ backup và thử lại sau khi wrapper thoát; không đè snapshot ban đầu. So sánh ID các collection và cấu hình cần giữ qua API/state đã lọc; không in key/cookie. Không dùng Force kill để vượt qua job đang chạy.
5. Commit code/checkpoint/validation, chạy `git diff --check`, kiểm worktree sạch. Tạo `source-vX.Y.Z.zip` từ `git archive HEAD`, không zip cả working directory.
6. Tạo manifest gồm version, sourceCommit, baseCommit, thời gian, tên/size/hash từng artifact. Tạo SHA256SUMS cho mọi file phát hành. Loại dữ liệu người dùng, profiles, key, token, ảnh/video kiểm chứng riêng, logs riêng và `.verification` khỏi source/release.

## Đưa lên GitHub khi đã được yêu cầu

Chỉ push/phát hành khi người dùng yêu cầu rõ trong phiên làm việc. Không cần xin lại cùng quyền đã được cấp. Fetch trước khi push, hợp nhất thay đổi mới nếu có; không force-push để ghi đè PC khác.

Push commit lên main bằng fast-forward, tạo tag mới duy nhất. Tạo draft release, upload Installer, Portable, blockmap, source ZIP, checkpoint/current/runbook, release notes, validation, manifest, SHA256SUMS, diagnostic script và thông báo third-party. Dùng notes file giữ đúng xuống dòng; chỉ publish sau khi đủ assets.

Sau publish, kiểm tag trỏ đúng commit, release không còn draft, version và kích thước/hash assets khớp manifest. Tải lại ít nhất Portable và đối chiếu SHA-256. Ghi URL release/checkpoint vào bàn giao và marker version máy đã nâng cấp. Không đổi binary dưới tag/version đã công bố; sửa tiếp bằng version mới.

Phát hành phần mềm lên GitHub không đồng nghĩa đăng video lên website/social. Bài render kiểm chứng dùng workspace riêng, tắt automation, không gọi provider trả phí nếu đã có media/receipt có thể tái sử dụng.
