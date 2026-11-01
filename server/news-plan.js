import { z } from "zod";
import { requestJsonContent } from "./llm.js";
import { StudioError } from "./store.js";

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
  imageMediaIds:z.array(z.string().uuid()).min(1).max(8),
  selectedImageIds:z.array(z.string()).max(5).default([]),
  visualMode:z.enum(['photo','illustration','source-card']).default('photo'),
  resolution:z.union([z.literal(720),z.literal(1080)]).default(1080),
  brand:z.string().max(24).default("NEWS UPDATE"),
  variation:z.number().int().min(1).max(100).default(1),
  visualVariant:z.number().int().min(1).max(100).default(1),
});

export async function writeNewsNarration(store,research,{llm=requestJsonContent,variation=1,total=1}={}) {
  const output=await llm(store,
    "Use a four-sentence progression: fact-based curiosity hook, confirmed development with attribution, verified context or stakes, then what remains unknown or what to watch next. Keep the summary within 400 characters including spaces. Keep every claim grounded in the supplied report; never add urgency, predictions, quotes or invented detail. " +
    `Write a short American TV news teaser from the supplied verified report. Return JSON {headline,summary,imageQueries}. Headline: factual, maximum 70 characters. Summary: 45-65 spoken words in 3-4 short sentences. Build a clear progression: sentence one is a fact-based curiosity hook; sentence two states what happened; sentence three gives verified context or a response; sentence four explains what remains unknown or why viewers should follow the full report. The hook may create tension through an unresolved fact, but use no exaggeration, rhetorical question, fake urgency or unverified claim. Attribute allegations to the person or outlet making them. No invented facts, quotes, dates, predictions, directions or branding. Do not include a CTA; it is appended by the app. Image queries: 3–5 SHORT literal noun phrases, 2–4 words each, using the actual named subjects, places and objects in the report. Avoid generic technology, infrastructure, illustrations, flags or unrelated stock imagery.${total > 1 ? ` This is variation ${variation} of ${total}; change the opening wording and pacing while keeping every fact and image subject consistent.` : ""}`,
    {variation,total,headline:research.headline,script:research.script,articles:research.articles.map(({title,summary,source,url})=>({title,summary,source,url}))});
  // Models may exceed the requested length. Validate the response shape here,
  // then apply the provider's final 500-character budget below (including CTA).
  // Rejecting at 400 prevented that existing shortening step from ever running
  // and left every item in a News batch stuck at PREPARATION_FAILED.
  const parsed=z.object({headline:z.string().trim().min(5).max(100),summary:z.string().trim().min(45).max(16000),imageQueries:z.array(z.string().min(2).max(100)).min(1).max(6)}).parse(output);
  let summary = parsed.summary.replace(/\s+/g," ");
  const firstSentence = summary.split(/(?<=[.!?])\s+/u)[0] || summary;
  if (!/\b(?:but|however|unclear|unknown|not included|remains|leaves|what|why|still|yet)\b/i.test(firstSentence)) {
    summary = `The report puts ${parsed.headline.replace(/[.!?]+$/g, "")} in focus, but leaves the key details unanswered. ${summary}`;
  }
  // Some local models ignore the requested sentence count. Add a factual
  // close when the response is too short so the presenter has a real hook,
  // development, context and an open question instead of two flat sentences.
  if (summary.split(/\s+/).filter(Boolean).length < 38) {
    summary = `${summary} The available report leaves important details open, so the next confirmed update will matter.`;
  }
  const maxSummaryLength = 500 - NEWS_CTA.length - 1;
  if (summary.length > maxSummaryLength) summary = summary.slice(0, maxSummaryLength).replace(/\s+\S*$/u, "").trim();
  const narration=`${summary} ${NEWS_CTA}`;
  if(narration.length>500)throw new StudioError("The news script exceeds DreamFace's 500-character limit. Shorten the summary.","NEWS_SCRIPT_TOO_LONG",422);
  return {
    headline: parsed.headline,
    narration,
    imageQueries: parsed.imageQueries,
    source: sourceLabel(research.articles[0]?.source),
    sourceUrl: research.articles[0]?.url,
    variation: Math.max(1, Number(variation) || 1),
    visualVariant: Math.max(1, Number(variation) || 1),
  };
}

export async function rankNewsImages(store,research,candidates,{llm=requestJsonContent,allowIllustrations=false}={}) {
  if (!candidates.length) return [];
  try {
    const selected=await llm(store,
      'Select visuals for the supplied narration, not the broader RSS topic. Return JSON {selectedImageIds:[]}. Select at most 5 valid candidate IDs in visual story order. Judge the actual candidate title and description; a search query is not evidence that the image depicts that subject. Every candidate, including article images, must relate to a subject explicitly named in this report. Reject unrelated events, places, people not named in the report, avatars, near duplicates and misleading old event photos. Do not confuse Bitcoin with Bitcoin Cash or other coins. Never use screenshots/charts with unverified prices or data. ' +
      (allowIllustrations ? 'Context images of the exact named subject are allowed (for example a Bitcoin token for a Bitcoin report, a relevant building or product). These will be visibly labeled CONTEXT IMAGE, NOT EVENT FOOTAGE. They need not show the actual event. Reject generic hacking/network visuals and unrelated subjects. ' : 'Prefer photographs of the reported subjects/events. Reject generic stock, graphics and illustrations in this pass. ') +
      'Select fewer images when necessary; return an empty list if none are relevant. Do not invent IDs.',
      {headline:research.headline,narration:research.script,articles:research.articles?.map(({title,summary,publishedAt})=>({title,summary,publishedAt})),candidates:candidates.map(({id,title,query,description})=>({id,title,query,description}))});
    const ids=z.array(z.string()).max(5).parse(selected?.selectedImageIds);
    return [...new Set(ids)].map(id=>candidates.find(image=>image.id===id)).filter(Boolean);
  } catch (error) {
    throw new StudioError(`Không xác minh được ảnh phù hợp với tin. Hãy thử lại bước chuẩn bị. ${String(error.message).slice(0, 180)}`, 'IMAGE_RANKING_FAILED', 422);
  }
}
