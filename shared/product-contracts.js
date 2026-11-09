import { z } from "zod";

export const productStyles = [
  {
    id: "auto",
    label: "Luân phiên phong cách",
    direction: "Choose a distinct style for each variation.",
  },
  {
    id: "demo",
    label: "Demo tính năng",
    direction:
      "Close-up practical demonstration of source-supported features, clear proof without invented performance.",
  },
  {
    id: "ugc",
    label: "UGC đời thường",
    direction:
      "Natural handheld consumer demonstration in a believable everyday setting. No invented personal testimonial.",
  },
  {
    id: "cinematic",
    label: "Cinematic",
    direction:
      "Controlled cinematic lighting, deliberate camera motion, macro product details and premium composition.",
  },
  {
    id: "problem-solution",
    label: "Vấn đề → giải pháp",
    direction:
      "Show a relatable everyday problem and demonstrate the actual product addressing only verified capabilities.",
  },
  {
    id: "unboxing",
    label: "Khám phá sản phẩm",
    direction:
      "A product reveal and close inspection, without inventing packaging or included accessories.",
  },
  {
    id: "minimal",
    label: "Tối giản",
    direction:
      "Clean background, restrained motion, short captions, strong product silhouette.",
  },
  {
    id: "ai-showcase", label: "AI từ ảnh · giới thiệu sản phẩm",
    direction: "Animate the supplied real product photo with gentle camera movement, studio light and clean background. No hands, actors or invented hidden surfaces. Preserve artwork, text, shape and colors exactly.",
  },
  {
    id: "ai-room", label: "AI từ ảnh · tranh trong không gian",
    direction: "Place the supplied artwork in a plausible interior, gentle frontal camera push and detail crops. Preserve the artwork and lettering exactly; do not invent dimensions or imply the room/accessories are included.",
  },
  {
    id: "reference",
    label: "Theo video mẫu",
    direction:
      "Adapt observed pacing, hook structure and framing from the reference analysis to this product. Use original scenes and copy.",
  },
];
export const productRequestFields = {
  requestId: z.string().uuid(),
  projectId: z.string().uuid(),
  productUrl: z.string().url().or(z.literal("")).default(""),
  imageMediaId: z.string().uuid().nullable().default(null),
  notes: z.string().trim().max(3000).default(""),
  inspirationUrls: z.array(z.string().url()).max(3).default([]),
  researchEvidence: z.array(z.object({
    title: z.string().max(250), url: z.string().url(), platform: z.string().max(40),
    kind: z.enum(['trend','ad','video','product']), description: z.string().max(700),
    observedAt: z.string().datetime(), measurement: z.string().max(80), summary: z.string().max(900),
  })).max(12).default([]),
  noFilming: z.boolean().default(false),
  sampleVideoMediaId: z.string().uuid().nullable().default(null),
  style: z.enum(productStyles.map((s) => s.id)).default("auto"),
  styleNotes: z.string().trim().max(1500).default(""),
  duration: z.union([z.literal(5), z.literal(10), z.literal(15)]).default(15),
  ratio: z.enum(["9:16", "16:9"]).default("9:16"),
  resolution: z.enum(["480p", "720p"]).default("720p"),
  billingMode: z.enum(["free", "credits"]).default("free"),
  maxCredits: z.number().int().min(0).max(100).default(0),
  researchModel: z.string().trim().max(150).default(""),
  accountId: z.string().uuid().or(z.literal("auto")).default("auto"),
  autoRender: z.boolean().default(true),
  outputDirectory: z.string().trim().max(2048).default(''),
};
export const productStudioRequest = z
  .object(productRequestFields)
  .superRefine((v, c) => {
    if (!v.productUrl && !v.imageMediaId)
      c.addIssue({
        code: "custom",
        path: ["productUrl"],
        message: "Dán link hoặc tải một ảnh sản phẩm.",
      });
    if (v.billingMode === "credits" && v.maxCredits <= 0)
      c.addIssue({
        code: "custom",
        path: ["maxCredits"],
        message:
          "Đặt giới hạn credits cho một clip trước khi dùng chế độ trả phí.",
      });
    if (
      v.style === "reference" &&
      !v.sampleVideoMediaId &&
      !v.inspirationUrls.length
    )
      c.addIssue({
        code: "custom",
        path: ["style"],
        message:
          "Chọn video mẫu hoặc thêm link tham khảo để dùng phong cách theo mẫu.",
      });
  });
export const productScheduleSchema = z.object({
  enabled: z.boolean().default(false),
  time: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .default("08:00"),
  timezone: z
    .string()
    .max(80)
    .default("Asia/Bangkok")
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    }, "Múi giờ không hợp lệ."),
});
export const productCampaignSchema = z.object({
  request: productStudioRequest,
  quantity: z.number().int().min(1).max(100).default(1),
  schedule: productScheduleSchema.default({
    enabled: false,
    time: "08:00",
    timezone: "Asia/Bangkok",
  }),
  startNow: z.boolean().default(true),
});

export function productCreativeDirection(style = "auto", index = 0, noFilming = false) {
  const choices = productStyles.filter(
    (s) => noFilming ? ["ai-showcase", "ai-room", "minimal", "cinematic"].includes(s.id) : !["auto", "reference", "ai-showcase", "ai-room"].includes(s.id),
  );
  const selected =
    style === "auto"
      ? choices[index % choices.length]
      : productStyles.find((s) => s.id === style) || choices[0];
  return { ...selected, variation: index + 1 };
}
