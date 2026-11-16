// A read check cannot test publishing or determine who unpublished a Page.
export function pageDiagnostic(page) {
  const verification = page.verification || {};
  const publishing = page.publishingHealth || {};
  const details = publishing.blocked ? publishing.details : verification.details;
  const base = { checkedAt: verification.checkedAt || null, details: details || null };
  if (publishing.blocked) return { ...base, level: 'error', title: 'Page đang bị hạn chế đăng', message: publishing.message || 'Meta đã từ chối một lần đăng trên Page.', action: 'Mở Facebook bằng tài khoản quản trị, xem Trạng thái tài khoản / Chất lượng Page và xử lý yêu cầu được hiển thị. Kiểm tra đọc thành công chưa chứng minh quyền đăng đã được khôi phục.' };
  if (verification.status === 'error') {
    const kind = details?.kind;
    const action = kind === 'authentication' ? 'Kết nối lại token còn hiệu lực rồi kiểm tra lại Page.'
      : kind === 'permission' ? 'Kiểm tra quyền quản trị Page và các quyền của token trong Meta, sau đó đồng bộ lại Page.'
      : kind === 'rate_limit' ? 'Chờ hết giới hạn lượt gọi của Meta rồi kiểm tra lại.'
      : 'Kiểm tra kết nối mạng và thông báo bên dưới rồi thử lại. Lỗi kiểm tra chưa đủ để kết luận token đã hết hạn.';
    return { ...base, level: 'error', title: 'Chưa kiểm tra được Page', message: verification.message || 'Không nhận được kết quả kiểm tra.', action };
  }
  if (page.isPublished === false || verification.status === 'unpublished') return {
    ...base, level: 'warning', title: 'Page không công khai',
    message: 'Kết nối đọc Page thành công, nhưng Facebook trả is_published=false. Đây là trạng thái hiển thị của Page.',
    action: 'Mở Facebook bằng tài khoản quản trị, kiểm tra trạng thái công khai/kích hoạt Page và Trạng thái tài khoản / Chất lượng Page. API không cho biết nguyên nhân chi tiết. Sau khi xử lý trên Facebook, bấm Kiểm tra lại.',
  };
  if (verification.status === 'unknown') return { ...base, level: 'warning', title: 'Chưa xác định được trạng thái công khai', message: 'Đọc được Page nhưng Meta không trả trường is_published; chưa thể kết luận Page công khai hay không.', action: 'Kiểm tra trực tiếp Page trên Facebook rồi thử lại.' };
  if (verification.status === 'passed') return { ...base, level: 'success', title: 'Kết nối đọc Page thành công', message: 'Facebook xác nhận Page đang công khai. Kiểm tra này không đăng bài thử và chưa xác nhận quyền đăng.', action: '' };
  return { ...base, level: 'info', title: 'Chưa kiểm tra Page', message: 'Bấm Kiểm tra lại để đọc trạng thái hiện tại từ Facebook.', action: '' };
}
