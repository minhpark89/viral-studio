import { z } from "zod";
import { requestJsonContent } from "./llm.js";
import { StudioError } from "./store.js";
import { NEWS_MAX_IMAGES, newsDurationSchema, newsImageCountSchema, newsScriptBudget } from '../shared/news-format.js';

export const NEWS_CTA="Read the full story through the link in the first comment.";
function sourceLabel(value) {
  const cleaned = String(value || "News report")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&amp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "News report").slice(0, 100);
}

export const newsPlanSchema=z.object({
  headline:z.string().trim().min(5).max(100),
  narration:z.string().trim().min(60).max(500),
  source:z.string().max(100).default("News report"),
  sourceUrl:z.string().url().optional(),
  fontStyle:z.enum(["news","viral","minimal"]).default("news"),
  avatarName:z.string().min(1).max(100).default("Alex"),
  avatarMediaId:z.string().uuid().nullable().default(null),
  voiceName:z.string().min(1).max(100).default("Grace"),
  imageQueries:z.array(z.string().min(2).max(100)).max(6).default([]),
  contextImageQueries:z.array(z.string().min(2).max(100)).max(6).default([]),
  imageMediaIds:z.array(z.string().uuid()).min(1).max(NEWS_MAX_IMAGES),
  selectedImageIds:z.array(z.string()).max(NEWS_MAX_IMAGES).default([]),
  newsDuration:newsDurationSchema.default('auto'),
  newsImageCount:newsImageCountSchema.default('auto'),
  estimatedSeconds:z.number().min(1).max(60).optional(),
  visualMode:z.enum(['photo','illustration','source-card']).default('photo'),
  resolution:z.union([z.literal(720),z.literal(1080)]).default(1080),
  brand:z.string().max(24).default("NEWS UPDATE"),
  variation:z.number().int().min(1).max(100).default(1),
  visualVariant:z.number().int().min(1).max(100).default(1),
});

const narrationOutput = z.object({headline:z.string().trim().min(5).max(100),summary:z.string().trim().min(20).max(16000),imageQueries:z.array(z.string().min(2).max(100)).min(1).max(6),contextImageQueries:z.array(z.string().min(2).max(100)).max(6).default([])});
const wordCount = text => text.trim().split(/\s+/u).filter(Boolean).length;

export function fitNewsSummary(value, budget) {
  const text = value.split(NEWS_CTA).join('').replace(/\s+/g, ' ').trim();
  const seen = new Set(); const chosen = [];
  for (const { segment } of new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)) {
    const sentence = segment.trim();
    if (!/[.!?]["'”’)]?$/u.test(sentence)) continue;
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    const next = [...chosen, sentence].join(' ');
    if (next.length > budget.characters || wordCount(next) > budget.words) break;
    chosen.push(sentence); seen.add(key);
  }
  return chosen.join(' ');
}

export async function writeNewsNarration(store,research,{llm=requestJsonContent,variation=1,total=1,newsDuration='auto',newsImageCount='auto'}={}) {
  const budget = newsScriptBudget(newsDuration);
  const summaryBudget = { characters: budget.characters - NEWS_CTA.length - 1, words: budget.words - wordCount(NEWS_CTA) };
  const instruction = `Write a concise American English news summary for a short clip that leads viewers to the full article in the first comment. Return JSON {headline,summary,imageQueries}. Headline: factual, maximum 70 characters. Summary: 1–3 complete short sentences, approximately ${Math.max(15, summaryBudget.words - 5)}–${summaryBudget.words} words and no more than ${summaryBudget.characters} characters including spaces. State the main confirmed development first, then one useful detail or context explicitly supported by the source. Attribute allegations. Summarize only; do not retell the full article, create suspense, invent uncertainty or add filler to reach a duration. Do not invent facts, dates, quotes, reactions, stakes or promises of future updates. No CTA; the app appends it once. Image queries: 4–6 distinct literal noun phrases using only named people, exact locations and objects actually mentioned in this report. Keep full names and place qualifiers; do not broaden to unrelated people or events. A short source can use fewer queries. ${total > 1 ? `This is variation ${variation} of ${total}; vary wording, never the verified facts.` : ''}`;
  const input = {variation,total,headline:research.headline,script:research.script,articles:(research.articles || []).map(({title,summary,source,url})=>({title,summary,source,url}))};
  const visualInstruction = ' Also return contextImageQueries: 2–4 short queries for labeled context photos, distinct from event-photo searches. Use the exact full name of a named person plus portrait, or the exact city and state plus city view. Do not include rally/campaign/crowd/event terms in context queries. Only include subjects explicitly named in the source. Do not invent a venue or search only a first name.';
  let parsed = narrationOutput.parse(await llm(store, instruction + visualInstruction, input));
  let summary = fitNewsSummary(parsed.summary, summaryBudget);
  // Never cut the end off a sentence or append invented context. Ask once for
  // a shorter complete fact if even the first sentence exceeds the budget.
  if (!summary) {
    parsed = narrationOutput.parse(await llm(store, instruction + visualInstruction + ' Your previous first sentence exceeded the budget. Rewrite it as one short complete factual sentence.', { ...input, previousSummary: parsed.summary }));
    summary = fitNewsSummary(parsed.summary, summaryBudget);
  }
  if (!summary) throw new StudioError('Không viết được câu tóm tắt hoàn chỉnh trong thời lượng đã chọn. Hãy chọn thời lượng dài hơn hoặc thử lại.', 'NEWS_SCRIPT_TOO_LONG', 422);
  const narration=`${summary} ${NEWS_CTA}`;
  return {
    headline: parsed.headline,
    narration,
    newsDuration,
    newsImageCount,
    estimatedSeconds: Math.max(15, Math.round(wordCount(narration) / 2.35 * 10) / 10),
    imageQueries: parsed.imageQueries,
    contextImageQueries: parsed.contextImageQueries,
    source: sourceLabel(research.articles[0]?.source),
    sourceUrl: research.articles[0]?.url,
    variation: Math.max(1, Number(variation) || 1),
    visualVariant: Math.max(1, Number(variation) || 1),
  };
}

export async function rankNewsImages(store,research,candidates,{llm=requestJsonContent,allowIllustrations=false,maxImages=NEWS_MAX_IMAGES,onWarning=()=>{}}={}) {
  if (!candidates.length) return [];
  const result = []; let succeeded = false; let lastError;
  // Keep each model request small. Dozens of long Commons descriptions and
  // URLs used to exhaust the configured gateway timeout before any selection.
  for (let offset = 0; offset < candidates.length && result.length < maxImages; offset += 12) {
    const chunk = candidates.slice(offset, offset + 12);
    try {
    const selected=await llm(store,
      `Select visuals for the supplied narration, not the broader RSS topic. Return JSON {selectedImageIds:[]}. Select up to ${maxImages} valid candidate IDs in visual story order. Prefer varied views of the actual named people, places and objects over many similar portraits. Judge the actual candidate title, caption, date and description; a search query or article headline alone is not evidence that an image depicts that event. Every candidate, including article images, must relate to a subject explicitly named in this report. Reject unrelated events, places, people not named in the report, avatars, near duplicates and misleading old event photos. An old rally with the same politician is not the current rally. Prefer a clearly identified portrait or location as labeled context instead. Do not confuse Bitcoin with Bitcoin Cash or other coins. Never use screenshots/charts with unverified prices or data. ` +
      (allowIllustrations ? 'Context images of the exact named subject are allowed (for example a Bitcoin token for a Bitcoin report, a relevant building or product). These will be visibly labeled CONTEXT IMAGE, NOT EVENT FOOTAGE. They need not show the actual event. Reject generic hacking/network visuals and unrelated subjects. ' : 'Prefer photographs of the reported subjects/events. Reject generic stock, graphics and illustrations in this pass. ') +
      'Select fewer images when necessary; return an empty list if none are relevant. Do not invent IDs.',
      {headline:research.headline,narration:research.script,articles:research.articles?.slice(0, 3).map(({title,publishedAt})=>({title,publishedAt})),alreadySelected:result.map(({title})=>title),candidates:chunk.map(({id,title,description,publishedAt})=>({id,title:String(title || '').slice(0,180),description:String(description || '').slice(0,240),publishedAt}))});
    const ids=z.array(z.string()).max(100).parse(selected?.selectedImageIds);
    succeeded = true;
    result.push(...[...new Set(ids)].map(id=>chunk.find(image=>image.id===id)).filter(image=>image && !result.some(prior=>prior.id===image.id)).slice(0, maxImages - result.length));
    } catch (error) {
      lastError = error;
      onWarning(`Không kiểm tra được một nhóm ảnh: ${String(error.message).slice(0, 180)}`);
    }
  }
  if (!succeeded) throw new StudioError(`Không xác minh được ảnh phù hợp với tin. Hãy thử lại bước chuẩn bị. ${String(lastError?.message || '').slice(0, 180)}`, 'IMAGE_RANKING_FAILED', 422);
  return result;
}
