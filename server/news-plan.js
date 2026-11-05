import { z } from "zod";
import { requestJsonContent } from "./llm.js";
import { StudioError } from "./store.js";
import { NEWS_MAX_IMAGES, newsDurationSchema, newsImageCountSchema, newsScriptBudget, newsRenderStyleSchema, DEFAULT_NEWS_RENDER_STYLE } from '../shared/news-format.js';

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
  newsRenderStyle:newsRenderStyleSchema.default(DEFAULT_NEWS_RENDER_STYLE),
  category:z.string().trim().max(24).default('U.S. NEWS'),
  location:z.string().trim().max(70).default(''),
  reportDate:z.string().max(40).default(''),
  estimatedSeconds:z.number().min(1).max(60).optional(),
  visualMode:z.enum(['photo','illustration','source-card']).default('photo'),
  resolution:z.union([z.literal(720),z.literal(1080)]).default(1080),
  brand:z.string().max(24).default("NEWS UPDATE"),
  variation:z.number().int().min(1).max(100).default(1),
  visualVariant:z.number().int().min(1).max(100).default(1),
});

const narrationOutput = z.object({headline:z.string().trim().min(5).max(100),summary:z.string().trim().min(20).max(16000),category:z.enum(['U.S. NEWS','U.S. POLITICS','BUSINESS','TECHNOLOGY','SCIENCE','HEALTH','WORLD NEWS','SPORTS','WEATHER']).catch('U.S. NEWS'),location:z.string().trim().max(70).catch(''),imageQueries:z.array(z.string().min(2).max(100)).max(6).default([]),contextImageQueries:z.array(z.string().min(2).max(100)).max(6).default([])});
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
  const visualInstruction = ' Also return contextImageQueries: 2–4 short queries for labeled context photos, distinct from event-photo searches. Use the exact full name of a named person plus portrait, or the exact city and state plus city view. Do not include rally/campaign/crowd/event terms in context queries. Only include subjects explicitly named in the source. Do not invent a venue or search only a first name. If the source has no concrete visual subjects, return empty imageQueries and contextImageQueries; the app can show a factual source card.';
  const identityInstruction = ' Also return category (one of U.S. NEWS, U.S. POLITICS, BUSINESS, TECHNOLOGY, SCIENCE, HEALTH, WORLD NEWS, SPORTS, WEATHER) and location. For location, copy a short exact place name present in the source or return an empty string; never infer a dateline, date, live status or breaking-news status.';
  let parsed = narrationOutput.parse(await llm(store, instruction + visualInstruction + identityInstruction, input));
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
    category: parsed.category,
    location: parsed.location && JSON.stringify(input).toLowerCase().includes(parsed.location.toLowerCase()) ? parsed.location : '',
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

export async function additionalNewsImageQueries(store, research, narration, previousQueries, {llm=requestJsonContent}={}) {
  const articles = (research.articles || []).slice(0, 3).map(({title,summary,source}) => ({title,summary,source}));
  const selected = await llm(store,
    'Find up to four concrete visual subjects explicitly named in these news sources for an additional context-photo search. Return JSON {subjects:[{name,kind}]}, kind is person, place, organization or object. Copy each name exactly from the source; preserve full names and location qualifiers. Prefer the specific island, city, person, organization or product over a broad country or generic object. Do not describe the event or add photo, portrait, scene, view, attack, crowd or disaster keywords. Do not invent venues, expand ambiguous initials, truncate person names or treat a cited publisher as a subject. Avoid generic people, victims, emergency responders, offices and unrelated stock photos. Return an empty array if no concrete subjects exist.',
    {headline:research.headline,articles,narration:narration.narration,previousQueries}, {maxTokens:700,timeoutSeconds:Math.min(45,Number(store.state?.settings?.llm?.timeoutSeconds)||90)});
  const subjects = z.array(z.object({name:z.string().trim().min(3).max(100),kind:z.enum(['person','place','organization','object'])})).max(4).parse(selected?.subjects);
  const normalize = value => ' ' + String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim() + ' ';
  const sourceText = normalize([research.headline,...articles.flatMap(article => [article.title,article.summary])].join(' '));
  const titleText = normalize([research.headline,...articles.map(article => article.title)].join(' '));
  const publishers = ['BBC','CBS','CNN','Reuters','Associated Press',...articles.map(article => article.source).filter(Boolean)].map(normalize);
  const seen = new Set(previousQueries.map(normalize));
  return subjects.filter(({name,kind}) => {
    const key=normalize(name);
    if (!sourceText.includes(key) || seen.has(key) || (kind==='person' && key.trim().split(' ').length < 2)) return false;
    if (publishers.some(publisher => (publisher.includes(key) || key.includes(publisher)) && !titleText.includes(key))) return false;
    seen.add(key); return true;
  }).map(({name}) => name);
}

export async function rankNewsImages(store,research,candidates,{llm=requestJsonContent,allowIllustrations=false,maxImages=NEWS_MAX_IMAGES,alreadySelected=[],onReviewed=()=>{},onWarning=()=>{}}={}) {
  if (!candidates.length) return [];
  // Attribution in a narration does not make a publisher's studio or logo a
  // subject of the story. Keep those images only for stories about that outlet.
  const words=value=>' '+String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()+' ';
  const subject=words([research.headline,...(research.articles||[]).map(article=>article.title)].join(' '));
  const publishers=[...new Set(['BBC','CBS','CNN','NBC','ABC News','Reuters','Associated Press','Sky News','Fox News',...(research.articles||[]).map(article=>article.source).filter(source=>source&&!/^(?:news report|source report|google news|unknown)$/i.test(source))])];
  const originalCount=candidates.length;
  candidates=candidates.filter(image=>!publishers.some(publisher=>words(image.title).includes(words(publisher))&&!subject.includes(words(publisher))));
  if(candidates.length<originalCount)onWarning(`Đã bỏ ${originalCount-candidates.length} ảnh hãng tin không phải chủ thể của bản tin.`);
  if (!candidates.length) return [];
  const sourceWords=words([research.headline,research.script,...(research.articles||[]).flatMap(article=>[article.title,article.summary])].join(' '));
  if (/\b(?:strikes?|attacks?|bombing|war|missiles?|crash|explosion|shooting|flooding)\b/.test(sourceWords)) {
    // A facility merely located in the named city/island must not imply it was
    // the target or scene. Broad landscape/coast/satellite context stays valid.
    const facilities=[/\b(?:airport|airfield|airbase|terminal)\b/i,/\b(?:aircraft|airplane|airliner|jet|avro|boeing|airbus)\b/i,...['hospital','school','church','mosque','military base','oil refinery'].map(name=>new RegExp('\\b'+name+'\\b','i'))];
    const before=candidates.length;
    candidates=candidates.filter(image=>!facilities.some(pattern=>pattern.test(image.title+' '+image.description)&&!pattern.test(sourceWords)));
    if(candidates.length<before)onWarning(`Đã bỏ ${before-candidates.length} ảnh cơ sở/phương tiện không được nguồn tin xác nhận.`);
  }
  if (!candidates.length) return [];
  const result = []; let succeeded = false; let lastError; let splitRetryUsed = false;
  // Keep each model request small. Dozens of long Commons descriptions and
  // URLs used to exhaust the configured gateway timeout before any selection.
  const review = async chunk => {
    const selected=await llm(store,
      `Select visuals for the supplied narration, not the broader RSS topic. Return JSON {selectedImageIds:[]}. Select up to ${maxImages-result.length} valid candidate IDs in visual story order. Prefer varied views of the actual named people, places and objects over many similar portraits. Judge the actual candidate title, caption, date and description; a search query or article headline alone is not evidence that an image depicts that event. Every candidate, including article images, must relate to a subject explicitly named in this report. Reject unrelated events, places, people not named in the report, avatars, near duplicates and misleading old event photos. An old rally with the same politician is not the current rally. Prefer a clearly identified portrait or location as labeled context instead. Do not confuse Bitcoin with Bitcoin Cash or other coins. Never use screenshots/charts with unverified prices or data. ` +
      (allowIllustrations ? 'Context images of the exact named subject are allowed (for example a Bitcoin token for a Bitcoin report, a relevant building or product). These will be visibly labeled CONTEXT IMAGE, NOT EVENT FOOTAGE. They need not show the actual event. Reject generic hacking/network visuals and unrelated subjects. ' : 'Prefer photographs of the reported subjects/events. Reject generic stock, graphics and illustrations in this pass. ') +
      'For place context, prefer general geography, coastlines, skylines and landscapes of the exact named place. Do not introduce an unnamed facility, vehicle, landmark or person merely located there: an airport/airplane in an island attack story can falsely suggest the target. Avoid unrelated activities, disasters, tourist attractions as the main subject and near-identical satellite views. Publisher attribution is not a story subject: do not select publisher offices, studios or logos merely because a source is cited. For people who share a name, the candidate caption must match the organization or role in the report; reject an unconfirmed identity. Select fewer images when necessary; return an empty list if none are relevant. Do not invent IDs.',
      {headline:research.headline,narration:research.script,articles:research.articles?.slice(0, 3).map(({title,publishedAt})=>({title,publishedAt})),alreadySelected:[...alreadySelected,...result].map(({title,description})=>({title,description:String(description||'').slice(0,140)})),candidates:chunk.map(({id,title,articleTitle,description,publishedAt})=>({id,title:String(title || '').slice(0,180),articleTitle,description:String(description || '').slice(0,350),publishedAt}))}, {maxTokens:800,timeoutSeconds:Math.min(45,Number(store.state?.settings?.llm?.timeoutSeconds)||90)});
    const ids=z.array(z.string()).max(100).parse(selected?.selectedImageIds);
    succeeded = true;
    const approved = [...new Set(ids)].map(id=>chunk.find(image=>image.id===id)).filter(image=>image && !result.some(prior=>prior.id===image.id));
    const chosen = approved.slice(0,maxImages-result.length);
    // Approved overflow remains available if earlier downloads fail.
    onReviewed(chunk.filter(image=>!approved.includes(image)||chosen.includes(image)).map(image=>image.id));
    result.push(...chosen);
  };
  for (let offset = 0; offset < candidates.length && result.length < maxImages; offset += 6) {
    const chunk = candidates.slice(offset, offset + 6);
    try { await review(chunk);
    } catch (error) {
      lastError = error;
      onWarning(`Không kiểm tra được một nhóm ảnh: ${String(error.message).slice(0, 180)}`);
      // One bounded split retry recovers a slow/malformed group without ever
      // approving unverified images or retrying every group indefinitely.
      if (!splitRetryUsed && chunk.length > 1) {
        splitRetryUsed = true;
        for (let index=0;index<chunk.length && result.length<maxImages;index+=3) {
          try { await review(chunk.slice(index,index+3)); }
          catch (retryError) { lastError=retryError; onWarning(`Không kiểm tra được nhóm ảnh dự phòng: ${String(retryError.message).slice(0,180)}`); }
        }
      }
    }
  }
  if (!succeeded) throw new StudioError(`Không xác minh được ảnh phù hợp với tin. Hãy thử lại bước chuẩn bị. ${String(lastError?.message || '').slice(0, 180)}`, 'IMAGE_RANKING_FAILED', 422);
  return result;
}
