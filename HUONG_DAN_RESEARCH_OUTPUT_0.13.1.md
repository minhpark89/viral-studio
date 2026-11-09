# Research sản phẩm và Output — 0.13.1

Ngày kiểm tra: 09/11/2026. Bản này dùng lại key SerpApi, workspace và profile Product đã lưu trên PC. Không thay đổi pipeline News, cấu hình News hay nơi xuất News. Không publish/deploy/push hoặc đăng bài lên mạng xã hội.

Mở icon Desktop **Viral Studio 0.13.1 - Product Research**. File chạy tại `D:\DROPSHIP\Viral Studio Test 0.11.0\Viral.Studio.0.13.1.exe`. Shortcut Product 0.13.0 đã được nâng lên bản mới; EXE cũ và bản sao dữ liệu trước nâng cấp vẫn được giữ để khôi phục nếu cần.

## Key hiện dùng được gì?

Trong **AI Research · US → Research đa nguồn**, chọn **Tìm sản phẩm & mẫu quảng cáo**, nhập ngách tiếng Anh rồi bấm **Quét nguồn đã chọn**. Bộ này chọn Google Shopping, Meta Ads và video ngắn social, tối đa **3 lượt SerpApi**, ít hơn nếu có cache. Không chọn YouTube trong bộ này. Nút bộ nguồn chỉ đổi lựa chọn, chưa gọi API.

| Nguồn | Kết quả | Không thể suy ra |
|---|---|---|
| Google Shopping US | Listing sản phẩm, ảnh, shop, giá niêm yết, điểm sao/số đánh giá nếu nguồn cung cấp, link listing | Đơn bán, doanh thu hoặc lợi nhuận của shop |
| Meta Ad Library | Quảng cáo Facebook/Instagram, Page, CTA, ngày bắt đầu, trạng thái tại lần quét, trang đích, ảnh/video mẫu | Doanh thu, ROAS, số đơn; việc chạy quảng cáo không chứng minh bán tốt |
| Google Short Videos | Video TikTok, Instagram, Facebook đã được Google lập chỉ mục; kênh, ảnh, thời lượng/đoạn preview nếu có | Viral được xác minh, số xem trực tiếp hoặc cơ cấu khách xem US |
| Google Trends | Mức quan tâm tìm kiếm 0–100 theo thời gian | Sản phẩm cụ thể bán chạy hay doanh thu |

Với ngách `Christian gifts`, bài giảng và hoạt động nhà thờ có thể lẫn vào kết quả quảng cáo. App ưu tiên CTA mua hàng, trang listing/cửa hàng và nội dung nói về vật phẩm; có nút **Chỉ mẫu có dấu hiệu sản phẩm**. Đây là bộ lọc gợi ý dựa trên nội dung, không xác nhận chính xác SKU hoặc hiệu quả bán hàng. Có thể tắt lọc để xem lại toàn bộ mẫu. Số phần trăm khớp từ khóa chỉ là mức trùng từ khóa, không phải xác suất thành công.

Mở tab **Sản phẩm**, **Quảng cáo** hoặc **Video** để tránh chỉ xem biểu đồ. Bấm **Xem video mẫu trong app** trên quảng cáo có video. Video social có thể chỉ có đoạn preview hoặc link gốc; app ghi rõ phần nào xem được. CDN hết hạn hoặc bị chặn sẽ có thông báo để mở nguồn/quét lại. Preview tối đa 64 MB/video, ảnh tối đa 4 MB; cache riêng Product tối đa khoảng 512 MB.

Chọn mẫu rồi bấm **Sang Product Studio**. Các nguồn đi cùng yêu cầu kịch bản; vẫn cần link/ảnh đúng sản phẩm store để giữ hình dạng và thông tin sản phẩm. Bản này chưa coi metadata là đã phân tích toàn bộ video. Tải video mẫu trong Product Studio nếu cần phân tích cảnh và nhịp dựng.

Để có chuỗi doanh số TikTok Shop, dùng nguồn doanh số riêng như FastMoss với quyền API tương ứng; SerpApi không thay thế nguồn đó. Để khẳng định viral cần thu thập số liệu video có nguồn và các mốc đo, không dùng số lượt xem viết trong snippet tìm kiếm.

## Chọn folder Output Product

**Product Studio → Output Product · Chọn nơi lưu video** nằm ngay phía trên form sản phẩm:

1. Bấm **Chọn thư mục…** để mở hộp thoại Windows.
2. Folder vừa chọn áp dụng cho đợt này.
3. Muốn dùng cho các đợt Product sau, bấm **Đặt làm mặc định Product**.
4. **Mở thư mục Output** mở đúng nơi lưu. **Về mặc định của app** bỏ lựa chọn mặc định tùy chỉnh.

Nếu mở app bằng trình duyệt web, trình duyệt không cung cấp hộp thoại chọn đường dẫn tuyệt đối cho server. App sẽ hướng dẫn nhập đường dẫn đầy đủ, ví dụ `D:\Video Product`, hoặc mở bản Desktop để chọn folder.

Với timeline thủ công: **Dựng video → Render video sản phẩm → Xuất video** cũng có bộ chọn folder. Xuất nhanh Product dùng mặc định Product đã lưu, hoặc lựa chọn Product của cửa sổ xuất trong phiên đó. Đường dẫn được chốt khi đưa job vào hàng đợi; đổi mặc định sau đó không chuyển các job đang chờ sang chỗ khác. App kiểm tra khả năng ghi trước khi tạo job.

Đường dẫn mặc định trên bản dùng thử PC này:

- Product thành phẩm: `D:\DROPSHIP\Viral Studio Test 0.11.0\Viral Data\exports\products\final`
- Clip Product: `D:\DROPSHIP\Viral Studio Test 0.11.0\Viral Data\exports\products\clips`
- News: MP4 nằm trực tiếp trong `D:\DROPSHIP\Viral Studio Test 0.11.0\Viral Data\exports`

Product có thư mục con riêng và nhãn media riêng. Nếu tự chọn chính thư mục News làm output Product thì file sẽ nằm chung thư mục đã chọn; app không tự đổi nơi News lưu. Có phần **Product và News lưu ở đâu?** để nhìn rõ đường dẫn hiện tại. Video đã xuất giữ nguyên vị trí; bản cập nhật không di chuyển/xóa chúng.

## Kiểm chứng thực tế

- Key người dùng gọi được Meta Ads, Google Shopping và Google Short Videos. Google Shopping trả 20 listing với ngách `Christian gifts`. Một trang Meta trả 30 quảng cáo, bộ lọc ưu tiên được 6 ứng viên có dấu hiệu bán sản phẩm, gồm tranh canvas, chăn và quà tặng. Đây chưa phải sản phẩm được xác nhận bán chạy.
- Một truy vấn Google Short Videos `Christian gifts` trả 3 link TikTok, 3 Instagram, 1 Facebook được chấp nhận. Danh sách đổi theo thời điểm; thị trường US ở đây là ngữ cảnh tìm kiếm.
- Video quảng cáo tranh canvas từ nguồn Meta được tải/phát thật trong app. Kiểm tra UI dùng dữ liệu đã thu thập, không gọi thêm API chỉ để chạy bài test.
- Đã dùng 9 lượt API cho kiểm tra và điều chỉnh truy vấn trong lượt sửa này; bộ đếm ở workspace từ 1 lên 10. Giới hạn người dùng giữ nguyên 20/ngày, 250/tháng. Các lần quét lại cùng tham số trong một giờ dùng cache.
- 504 kiểm thử backend đạt. Có kiểm thử render MP4 thật vào folder Product đã chọn, chốt đường dẫn job, nguồn thiếu số liệu, cache, lọc thương mại, URL riêng tư, MIME preview và HTTP range.
- Giao diện web và bản Electron đóng gói đã kiểm tra hộp thoại folder, lưu/reset mặc định, chọn folder xuất từ timeline, nhãn nguồn và phát preview. 24 module News/Meta/Social/website cùng file workspace News gốc đối chiếu hash: 25/25 không đổi.

Tài liệu API: [Google Shopping](https://serpapi.com/google-shopping-api), [Meta Ad Library](https://serpapi.com/meta-ad-library-api), [Google Short Videos](https://serpapi.com/google-short-videos-api).
