# Nhóm Page và pool token — 0.9.1-local.1

Mở **Channels & Tokens → Nhóm phân phối**. Pool token phân công token phụ trách từng Page; nhóm Page quyết định Page nhận nội dung, giờ đăng và khoảng cách.

## 30 token cùng quản lý 100 Page

1. Trong tab **Token**, thêm đủ 30 token rồi **Đồng bộ tất cả token** để app xác minh quyền Page.
2. Sang **Nhóm phân phối → Pool token → Tạo pool**. Đặt tên, chọn **Luân phiên đều**, để **Giới hạn Page / token = 0**.
3. Phạm vi: **Tất cả Page thuộc các token đã chọn**. Tick **Chọn tất cả kết quả lọc** để chọn 30 token.
4. Bấm **Xem trước phân công**. Nếu cả 30 token có quyền hợp lệ trên cùng 100 Page, kết quả là **10 token × 4 Page + 20 token × 3 Page = 100 Page**. Bảng liệt kê tên từng Page do mỗi token phụ trách.
5. Bấm **Tạo pool**. Sau khi lưu, dùng **Xem phân công** để kiểm tra kết quả thực tế. **Sửa pool** cập nhật pool cũ, giữ nguyên liên kết của nhóm đang dùng pool.
6. Tạo / sửa nhóm Page, chọn pool vừa tạo ở **Pool token tự động**, đặt khung giờ và khoảng cách, bật **Auto Post** rồi lưu.

Số 0 ở giới hạn Page/token nghĩa là không đặt trần cứng. Nếu đặt 3 với 30 token, chỉ đủ 90 Page và 10 Page sẽ chưa được phân công; đặt 4 hoặc 0 để đủ chỗ. Token không có quyền hợp lệ với Page không được nhận Page đó. Quyền khác nhau có thể làm kết quả không đều.

## Chọn và sửa nhóm

- Danh sách có avatar, Page ID, số thứ tự và tình trạng giống **Page & avatar**. Avatar chưa có hoặc tải lỗi sẽ hiện chữ cái thay thế.
- Tick từng dòng; giữ Shift rồi bấm dòng khác để chọn một dải; hoặc giữ chuột trái và kéo qua các dòng. Kéo sát mép danh sách để cuộn tiếp.
- **Chọn tất cả kết quả lọc** chọn mọi mục đủ điều kiện trong bộ lọc, kể cả các dòng phải cuộn mới thấy. Các mục đã chọn ngoài bộ lọc được giữ lại. **Bỏ chọn tất cả** xóa toàn bộ lựa chọn.
- Trong **Page & avatar**, lọc theo tên / tình trạng / nhóm / token, rồi bấm **Tạo nhóm từ kết quả lọc** để mở nhóm mới với những Page sẵn sàng. Nếu đã tick một số Page thì dùng những Page đã tick.
- **Sửa nhóm & lịch** cho phép thêm Page mới, gỡ Page cũ và chỉnh lịch. **Xem Page trong nhóm** mở đúng bộ lọc của danh sách quản lý.

## Page bị lỗi, thêm lại và thay Page

App bỏ qua Page bị hạn chế, không công khai, chờ xử lý, lưu trữ, kiểm tra thất bại hoặc thiếu token/phân công hợp lệ. Các Page còn tốt tiếp tục nhận nội dung theo vòng luân phiên. Vị trí vòng luân phiên được lưu qua lần khởi động lại.

1. Bấm **Lọc Page lỗi** tại nhóm đăng. Page lỗi được đưa vào **Page chờ xử lý** và gỡ khỏi các nhóm đăng. Lịch và nút Auto Post của nhóm còn tốt được giữ nguyên.
2. Bài chưa đăng của Page bị gỡ được giữ trong kho kèm lỗi và Page cũ để đối chiếu. Nội dung, video và lịch sử đăng không bị xóa. Bài đang gửi phải hoàn tất trước khi gỡ Page. Video đã đăng không được trả kho để đăng lại.
3. Mở **Page & avatar**, lọc **Chờ xử lý** hoặc **Tất cả lỗi**, bấm tên Page để xem lỗi. Xử lý lỗi/quyền trên Facebook khi cần, đồng bộ token rồi **Kiểm tra lại**.
4. Sau khi kiểm tra đạt, chọn **Đưa về nhóm đăng**, chọn nhóm đích (hoặc các nhóm trước đó). Với Page từng bị hạn chế, xác nhận đã xử lý hạn chế để bỏ chặn trong app. Nhóm nhận lại Page và pool theo nhóm cập nhật phân công.
5. Với Page mới, thêm/đồng bộ Page rồi chọn trong **Sửa nhóm & lịch**. Pool **Theo một nhóm Page** tự cập nhật khi thành viên nhóm thay đổi. Pool **Chọn danh sách Page riêng** cần thêm Page vào phạm vi đó; có thể dùng **Tự chia Page** để tính lại phân công.

Bài đã trả kho cần được bạn kiểm tra và phân công lại; app không tự gửi lại bài lỗi. Các ô lịch trống còn ở tương lai được lấy nội dung hoàn chỉnh khác để nhóm tiếp tục đăng.

## Phạm vi và cách chia khác

| Lựa chọn | Cách dùng |
| --- | --- |
| Tất cả Page thuộc token đã chọn | Chia toàn bộ danh sách Page do các token đó quản lý. |
| Theo một nhóm Page | Tách pool theo nhóm/kênh. Khi thêm hoặc đưa Page về nhóm, pool cập nhật phạm vi và phân công. |
| Chọn danh sách Page riêng | Tick chính xác Page cần chia; những lần tự chia sau vẫn giữ phạm vi đã chọn. |
| Luân phiên đều | Ưu tiên token đang được phân công ít Page hơn, luân phiên giữa các token ngang tải. |
| Cân bằng, ưu tiên token ít dùng | Cân bằng số Page rồi ưu tiên token có lần sử dụng cũ hơn. |
| Ngẫu nhiên | Chọn ngẫu nhiên trong các token có quyền và còn chỗ; không bảo đảm số Page bằng nhau. Xem trước và khi lưu có thể khác nhau. |

Giới hạn và tình trạng Page luôn được kiểm tra. Bảng phân công phân biệt **thiếu quyền token**, **đầy giới hạn** và **Page cần xử lý**, thay vì luôn yêu cầu đồng bộ lại.

## Giờ đăng và khoảng cách

| Cài đặt | Ý nghĩa |
| --- | --- |
| Khung giờ + múi giờ | Mỗi khung giờ lấy một bài cho một Page, luân phiên các Page trong nhóm. |
| Giới hạn video/ngày cho cả nhóm | Giới hạn chung của nhóm, không phải mỗi Page. 0 = số khung giờ. Ví dụ 09:00, 15:00 và giới hạn 0 = tối đa 2 bài/ngày cho cả nhóm. Bài đã đăng được tính vào giới hạn. |
| Giữa hai lượt đăng trong nhóm | Khoảng cách tối thiểu giữa các lượt đăng của nhóm. |
| Cùng token | Khoảng cách tối thiểu khi dùng lại một token, kể cả token dùng ở nhóm khác. |
| Giữa các token trong pool | Khoảng cách giữa các lượt đăng trong cùng pool, kể cả các nhóm cùng dùng pool. Nếu không chọn pool, áp dụng trong nhóm. |
| Cùng Page | Khoảng cách trước khi đăng tiếp lên cùng Page, kể cả Page dùng ở nhóm khác hoặc đổi token. |

Khoảng cách tính bằng phút; 0 tắt điều kiện tương ứng. Lượt đăng phải chờ đủ tất cả điều kiện. Ví dụ đặt giữa lượt đăng 2 phút, cùng token 10 phút, giữa token 1 phút và cùng Page 60 phút: Page mới có thể đăng sau 2 phút nếu các điều kiện khác đã đủ; cùng token phải chờ ít nhất 10 phút, cùng Page ít nhất 60 phút. App lưu thời điểm đã dùng token/Page để việc mở lại app không dồn bài ngay một lúc. Đổi cấu hình không xóa thời gian chờ đã đặt cho lượt trước.

**Auto Post cần app đang chạy, còn nội dung hoàn chỉnh trong kho và còn Page/token đủ điều kiện.** Tắt Auto Post giữ lại các bài tự động đã hẹn và dừng gửi chúng cho tới khi bật lại. Lịch do người dùng chủ động đặt riêng vẫn giữ ý nghĩa riêng. Khoảng cách giúp điều tiết nhịp đăng; khi Meta hạn chế Page, app vẫn dừng Page đó để xử lý.

## Bản local và dữ liệu đang dùng

Bản 0.9.1-local.1 là bản sửa local, chưa push/publish/deploy và chưa thay app 0.8.9-local.1 đang mở. Không chạy các script migration/khôi phục JSON cũ. Khi cập nhật bản đang dùng, phải giữ workspace hiện tại và lịch sử đăng mới; đóng app cũ trước khi chạy bản mới để tránh kết nối nhầm server cũ.

Để dùng bản sửa với dữ liệu hiện tại trên máy này, sau khi các tác vụ đang chạy kết thúc, đóng app cũ và mở **`D:/DROPSHIP/APP Dropship/.maintenance/page-groups-20261104/package/Mo Viral Studio 0.9.1 local.cmd`**. Launcher dùng đúng `D:/DROPSHIP/Viral Studio Data/workspace`; không sao chép hay khôi phục dữ liệu cũ. Nếu app cũ còn chạy, launcher chỉ nhắc đóng app và dừng. Mở riêng EXE Portable sẽ mặc định dùng thư mục dữ liệu cạnh EXE, vì vậy dùng launcher khi muốn giữ workspace hiện tại.

Lúc kiểm tra chỉ đọc, pool 30 token hiện tại đang giữ **79 Page** nên chia **19 token × 3 + 11 token × 2**. Toàn bộ vault có 100 Page nhưng 4 Page báo lỗi. Bản sửa giữ nguyên phạm vi 79 Page cũ; muốn mở rộng, sửa phạm vi pool và xử lý Page lỗi trước. Không có cấu hình thực nào bị đổi trong quá trình kiểm thử.
