# Checkpoint v0.15.0 — Đồng bộ News Studio / Product Studio

## Mục tiêu và phạm vi

Người dùng muốn News Studio cạnh Product Studio, gom Research/luồng News tự động/cài đặt vào cùng nơi và để Kịch bản/Dựng video làm thủ công. Yêu cầu đẩy source cùng bản cài lên GitHub để Codex trên máy News nhận làm nền rồi ghép các bản sửa lỗi của máy đó.

- Repo: https://github.com/minhpark89/viral-studio
- Release/tag cố định: `v0.15.0`.
- Nền local trước bản này: commit `673ff57` (0.10.2 preview), sau đó là các thay đổi Product/Research/News Output tới 0.14.0 và UI News Studio mới.
- Không có chẩn đoán cụ thể về lỗi 0.10.1 trên máy khác trong phiên này. Không mặc định xem chúng đã được sửa.

## Cấu trúc UI mới

| Module | Vai trò |
|---|---|
| `src/main.jsx` | News Studio mặc định; sidebar chia Studio và Công cụ thủ công; điều hướng legacy Research hoặc batch-focus vào News Studio. |
| `src/pages/NewsStudio.jsx` | Research / tự động / cài đặt; giữ Research đã mount khi đổi tab để không mất bộ lọc/tin đã chọn; đường dẫn Output dùng chung cho lượt mới. |
| `src/pages/NewsStudioSettings.jsx` | Output, style theo dự án, LLM, hiệu năng, DreamFace và lối vào cài đặt toàn app. |
| `src/LlmConnectionSettings.jsx` | Form LLM dùng API hiện có; key trống giữ key cũ; test dùng đúng giá trị chưa lưu trên form. Không ghi key vào localStorage. |
| `src/pages/Research.jsx` | Chế độ embedded cho News Studio; single/bulk/LLM→Render giữ cơ chế cũ và truyền folder News đang chọn. |
| `src/pages/ProductionPanel.jsx` | Luồng News tự động nhận folder từ News Studio; gửi xong mở đúng bản ghi tự động. |
| `src/pages/Render.jsx` | Chỉ timeline thủ công; chọn loại đầu ra News/Product. Không chứa batch tự động hoặc Product Studio. |
| `src/pages/ProductOutput.jsx`, `server/news-output.js`, `server/product-output.js` | Chọn/lưu/mở folder độc lập; kiểm tra ghi trước khi tạo đợt. |
| `server/product-*`, `server/product-research/*`, `shared/product-contracts.js` | Các tính năng Product/Research được ghép từ bản dùng thử trước. |

Giữ nguyên endpoint/sơ đồ project News và engine MC/V3 trong thay đổi UI này. Tuy nhiên **so với 0.10.1**, source còn chứa bản nền 0.10.2 và thay đổi Output trong `queue.js`, `production.js`, `media.js`, `render.js`, `news-render.js`, `news-v3-render.js`. Khi ghép bản sửa News, phải kiểm tra các file này thay vì chép cả thư mục cũ đè lên.

## Các hành vi cần giữ khi merge

1. `project.newsVideoOptions` là nguồn lưu style/font/duration/images, độc lập từng dự án. Hook `useNewsVideoOptions` tuần tự hóa lưu và chặn render khi chưa lưu/lỗi.
2. Request đợt News giữ style đã chọn; retry không lấy style hiện tại để thay đợt cũ. Giữ progress theo retry mới nhất và lịch sử output đã dọn.
3. `batch.outputDirectory` / `job.production.newsOutputDirectory` giữ đường dẫn đợt. Product dùng trường/setting riêng. Không đổi đường dẫn file cũ khi thay mặc định.
4. Research Product dùng SQLite riêng; preview có giới hạn. Dọn cache không xóa history/key/quota/MP4. Không suy ra doanh thu hay viral từ Trends/ads/metadata.
5. Product daily/batch vẫn giữ số lượng, input ảnh/listing, cách dựng không quay hàng và folder. Chưa có ảnh/link sản phẩm thật của store để nghiệm thu chất lượng DreamFace cho Jesus art/gifts.
6. Không tự đăng bài hoặc gọi provider trả phí để kiểm thử UI. Cơ chế auto Content/website đã có từ trước vẫn theo cấu hình người dùng.

## Quy trình cho Codex trên máy News

1. Trước nâng cấp: lưu commit riêng hoặc `git diff --binary` cho các sửa lỗi chưa commit, ghi lại ID job/batch lỗi, sao lưu dữ liệu khi app đã đóng. Giữ các profile/cookie/key riêng trên máy đó.
2. `git fetch origin --tags`. Tạo nhánh sửa tiếp dựa trên `origin/main` hoặc tag `v0.15.0`; merge/cherry-pick các commit sửa News đã lưu. Không reset hard/chép source 0.10.1 đè cả repo.
3. Nâng cấp executable bằng Installer hoặc thay Portable, giữ `Viral Data` của máy News. App installer và portable có cơ chế chọn data root khác nhau; kiểm tra vị trí dữ liệu trước khi chạy. Không chạy hai instance với cùng data root trong lúc đổi bản.
4. Chạy `npm test`, `npm run build`, `node tests/news-studio-browser.mjs`, `node tests/news-style-browser.mjs`, `npm run test:workspaces`. Cần `npm ci`, Chrome/Playwright tương ứng và FFmpeg đi kèm repo.
5. Đóng gói, chạy `node tests/news-studio-desktop.mjs` / `node tests/product-research-desktop.mjs` trên `release/win-unpacked`; chạy `scripts/Test-Render-Windows.ps1` trên chính máy đang lỗi để kiểm tra GPU/CPU và đường dẫn runtime.
6. Kiểm tra lại ca lỗi thực tế bằng dữ liệu/profile của máy đó, tránh submit trùng job đang chờ. Phát hành phiên bản mới hơn 0.15.0, không sửa tag 0.15.0.

`tests/news-studio-browser.mjs` và `tests/news-studio-desktop.mjs` tự tạo workspace thử riêng. Một số test Product live-capture cũ là bài chẩn đoán tùy chọn, yêu cầu fixture `.maintenance` trên máy phát triển; không phải điều kiện để chạy bộ backend `npm test` trên máy mới.

## Kiểm chứng và giới hạn

Chi tiết trong `RELEASE_VALIDATION_v0.15.0.json`. Bộ backend 511 bài đã qua; luồng UI News/Manual/Product, migration style cũ, LLM từ form và layout 390/900/1440 px đã được kiểm tra. Bộ thử UI dùng dữ liệu giả/captured và không tạo MC, mua credits hoặc đăng bài thật. Các sự cố riêng trên máy kia cần kiểm chứng lại sau khi ghép bản sửa.
