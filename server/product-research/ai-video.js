// Source text describes a candidate; it cannot establish how footage was made.
export function aiVideoPlan(record) {
  if (!['video', 'ad'].includes(record.kind)) return null;
  const text = `${record.title || ''} ${record.description || ''}`.toLowerCase();
  const matches = text.match(/\b(?:ai[- ]generated|ai[- ]video|ai[- ]product|made with ai|created with ai|generative ai|cgi|3d animation|image[- ]to[- ]video)\b/g) || [];
  const photoStyle = /\b(?:product animation|product reveal|product showcase|mockup|slideshow|photo animation|motion design|stop motion)\b/.test(text);
  const filmed = /\b(?:unboxing|hands[- ]on|taste test|wear test|real customer|testimonial|try[- ]on)\b/.test(text);
  const art = /\b(?:canvas|portrait|wall art|art print|poster|painting|framed)\b/.test(text);
  const suitable = matches.length > 0 || photoStyle;
  return {
    suitable,
    evidence: matches.length ? 'source_mentions_ai' : photoStyle ? 'style_candidate' : 'unconfirmed',
    label: matches.length ? 'Nguồn nhắc AI / CGI · chưa xác minh' : photoStyle ? 'Có dấu hiệu phù hợp dựng từ ảnh' : 'Chưa đủ thông tin về cách dựng',
    matchedTerms: [...new Set(matches)],
    basis: 'Đánh giá từ tiêu đề / mô tả; chưa phân tích khung hình video.',
    style: art ? 'ai-room' : 'ai-showcase',
    recipe: art
      ? 'Ảnh tranh chính diện → đặt trong không gian nội thất → camera tiến chậm → cận chi tiết → CTA. Giữ nguyên hình tranh và chữ trên sản phẩm.'
      : 'Ảnh sản phẩm rõ nét → nền studio → chuyển động camera nhẹ → cận chi tiết → CTA. Chỉ dùng góc và đặc điểm có trong ảnh gốc.',
    limitation: filmed
      ? 'Mẫu có yếu tố trải nghiệm / cầm nắm. Chuyển thành giới thiệu sản phẩm; không dựng lời chứng thực hay kết quả dùng thử giả.'
      : 'Cần ảnh thật của đúng sản phẩm. Không suy ra mặt sau, phụ kiện, công dụng hoặc doanh số từ mẫu quảng cáo.',
  };
}
export function aiSearchQuery(keywords) {
  return `${keywords} product showcase`;
}
