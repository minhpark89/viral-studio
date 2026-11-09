// Heuristics prioritize research candidates, never infer orders or revenue.
export function productSignals(record, query = "") {
  const text =
    `${record.title || ""} ${record.description || ""}`.toLowerCase();
  const tokens = [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(
          (t) => t.length > 2 && !["the", "and", "for", "with"].includes(t),
        ),
    ),
  ];
  const words = new Set(text.split(/[^\p{L}\p{N}]+/u));
  const matches = tokens.filter(
    (t) => words.has(t) || (t.endsWith("s") && words.has(t.slice(0, -1))),
  );
  const relevance = tokens.length
    ? Math.round((matches.length * 100) / tokens.length)
    : 0;
  const shoppingCta = /\b(?:shop|buy|order|purchase)\b/i.test(
    record.callToAction || "",
  );
  const merchandise =
    /\b(?:canvas|portrait|wall art|art print|poster|blanket|mug|tumbler|jewelry|necklace|bracelet|t-shirt|shirt|hoodie|plaque|keychain|gift set|gift box|gift book|devotional|planner|calendar|bible cover|home decor|personalized|customized|unboxing|product demo|gift ideas|gifts for)\b/.test(
      text,
    );
  const landing = /\/(?:products?|collections?|shop|stores?|dp)\//i.test(
    record.productUrl || "",
  );
  const promotion =
    /\b(?:free shipping|shop now|buy now|order now|sale|discount|gift for|gifts for)\b/.test(
      text,
    );
  const sermon =
    /\b(?:sermon|was live|pastor|sunday service|worship service|church service|bible study|join us for worship)\b/.test(
      text,
    );
  const score =
    record.kind === "product"
      ? 100
      : Math.max(
          0,
          (shoppingCta ? 45 : 0) +
            (landing ? 25 : 0) +
            (merchandise ? 30 : 0) +
            (promotion ? 20 : 0) -
            (sermon && !shoppingCta && !landing ? 60 : 0),
        );
  const likelyProduct = record.kind === "product" || score >= 30;
  const reasons = [];
  if (shoppingCta) reasons.push(`CTA: ${record.callToAction}`);
  if (landing) reasons.push("Có đường dẫn listing / cửa hàng");
  if (merchandise) reasons.push("Tiêu đề hoặc mô tả nhắc đến vật phẩm");
  if (sermon && !likelyProduct)
    reasons.push(
      "Có dấu hiệu bài giảng / sinh hoạt, ít liên quan demo sản phẩm",
    );
  if (!reasons.length)
    reasons.push("Chưa đủ dấu hiệu xác định nội dung bán sản phẩm");
  return {
    likelyProduct,
    commerceScore: Math.min(100, score),
    relevance,
    reasons,
    label: likelyProduct
      ? "Ứng viên sản phẩm · cần đối chiếu"
      : "Tham khảo rộng · chưa rõ sản phẩm",
  };
}
export function prioritizeProducts(records, query) {
  return records
    .map((r) => ({ ...r, productSignals: productSignals(r, query) }))
    .sort(
      (a, b) =>
        Number(b.productSignals.likelyProduct) -
          Number(a.productSignals.likelyProduct) ||
        b.productSignals.relevance - a.productSignals.relevance ||
        b.productSignals.commerceScore - a.productSignals.commerceScore,
    );
}
