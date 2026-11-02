import { z } from "zod";
import { MAX_NEWS_VIDEOS } from "./mc-rotation.js";
import { newsDurationSchema, newsImageCountSchema } from './news-format.js';

export const productionRequestSchema = z.object({
  requestId: z.string().uuid(),
  projectId: z.string().uuid(),
  contentType: z.enum(["news", "product"]),
  autoCreateContent: z.boolean().default(false),
  autoResearch: z.boolean().default(true),
  researchId: z.string().uuid().nullable().default(null),
  researchIds: z.array(z.string().uuid()).max(MAX_NEWS_VIDEOS).default([]),
  topic: z.string().trim().max(200).default(""),
  sourceUrl: z.string().url().or(z.literal("")).default(""),
  productName: z.string().trim().max(200).default(""),
  productBrief: z.string().trim().max(4000).default(""),
  productUrl: z.string().url().or(z.literal("")).default(""),
  count: z.number().int().min(1).max(MAX_NEWS_VIDEOS).default(1),
  engine: z.enum(["dreamface", "preview"]).default("dreamface"),
  accountId: z.string().uuid().or(z.literal("auto")).default("auto"),
  avatarMediaId: z.string().uuid().nullable().default(null),
  mcRotation: z.array(z.object({ avatarMediaId: z.string().uuid(), count: z.number().int().min(1).max(MAX_NEWS_VIDEOS) })).max(50).default([]),
  references: z.array(z.string().uuid()).max(10).default([]),
  feeds: z.array(z.string().url()).max(12).default([]),
  duration: z.union([z.literal(5), z.literal(10)]).default(5),
  ratio: z.enum(["9:16", "16:9"]).default("9:16"),
  variationPolicy: z.enum(["visual-unique"]).default("visual-unique"),
  fontStyle: z.enum(["news", "viral", "minimal"]).default("news"),
  newsDuration: newsDurationSchema.default('auto'),
  newsImageCount: newsImageCountSchema.default('auto'),
}).superRefine((value, context) => {
  if ((value.contentType === "news" || value.autoResearch) && value.topic.length < 2 && !value.sourceUrl)
    context.addIssue({code:"custom",path:["topic"],message:"Enter a news or product niche."});
  if (value.contentType === "product" && !value.autoResearch && !value.productName)
    context.addIssue({code:"custom",path:["productName"],message:"Enter the product name."});
  if (value.contentType === "product" && value.engine !== "dreamface")
    context.addIssue({code:"custom",path:["engine"],message:"Product videos use DreamFace."});
  if (value.contentType === "product" && value.count > 50)
    context.addIssue({code:"custom",path:["count"],message:"Product batches support up to 50 videos."});
  if (value.researchIds.length && (value.contentType !== "news" || value.researchId || value.researchIds.length !== value.count))
    context.addIssue({code:"custom",path:["researchIds"],message:"Choose one research record per news video; use researchId or researchIds."});
  if (value.mcRotation.length && (value.contentType !== "news" || value.avatarMediaId))
    context.addIssue({code:"custom",path:["mcRotation"],message:"Choose MC rotation or a single MC image for news videos."});
  if (value.productUrl && !/^https?:\/\//i.test(value.productUrl))
    context.addIssue({code:"custom",path:["productUrl"],message:"Use an HTTP or HTTPS product URL."});
  if (value.sourceUrl && !/^https?:\/\//i.test(value.sourceUrl))
    context.addIssue({code:"custom",path:["sourceUrl"],message:"Use an HTTP or HTTPS news URL."});
});
