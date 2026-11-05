import { z } from "zod";
import { productionRequestSchema } from "../shared/production-contracts.js";
import { defaultTimeline } from "../shared/contracts.js";
import { buildResearchAssemblyTimeline } from "../shared/research-assembly.js";
import { createResearchService } from "./research.js";
import { requestJsonContent } from "./llm.js";
import { searchImageQueries, downloadImageAsset, newsImageCandidates, newsImageKey } from "./image-search.js";
import { StudioError } from "./store.js";
import { newsPlanSchema, writeNewsNarration, rankNewsImages, additionalNewsImageQueries } from "./news-plan.js";
import { isPageAvatar, isMcImage } from "../shared/output-media.js";
import { mcForVideo } from "../shared/mc-rotation.js";
import { discoverArticleImages, newsVisualQueries } from './news-visuals.js';
import { createNewsSourceCard } from './news-render.js';
import { newsImageTarget } from '../shared/news-format.js';
import { newsImageFingerprint, sameNewsImage } from './news-image-fingerprint.js';

const productOutput = z.object({ productName: z.string().trim().min(1).max(200), productBrief: z.string().trim().min(1).max(4000), prompt: z.string().trim().min(20).max(16000) });

const VISUAL_VARIATION_DIRECTIVES = [
  "Open with a wide establishing shot, then make a slow left-to-right reveal.",
  "Open with a tight detail shot, then pull back to show the full product in use.",
  "Open with a top-down composition, then cut to a smooth handheld-style close-up.",
  "Open with a side profile and a gentle push-in, then finish on a clean hero frame.",
  "Open with a quick three-quarter angle, then use a measured orbit around the product.",
];

function productVariationDirective(index, total) {
  return `Render variation ${index} of ${total}. ${VISUAL_VARIATION_DIRECTIVES[(index - 1) % VISUAL_VARIATION_DIRECTIVES.length]} Keep the same verified content facts, but change the visual opening, shot order, camera path, background framing and pacing so this output is visibly different from the other variations.`;
}

function selectNewsVariant(ids, variation) {
  const source = [...new Set((ids || []).filter(Boolean))];
  if (source.length <= 1) return source;
  const offset = (Math.max(1, Number(variation) || 1) - 1) % source.length;
  const rotated = [...source.slice(offset), ...source.slice(0, offset)];
  return Math.max(1, Number(variation) || 1) % 2 === 0 ? rotated.reverse() : rotated;
}

function preparationMessage(error, fallback) {
  const message = String(error?.message || "").replace(/\s+/g, " ").trim();
  return message ? message.slice(0, 800) : fallback;
}

function touchPreparation(batch, item) {
  const at = new Date().toISOString();
  batch.updatedAt = at;
  if (item) item.updatedAt = at;
  return at;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function htmlText(value, max = 1200) {
  return decodeHtml(String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ").trim().slice(0, max);
}

function htmlMeta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`<meta\\b[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>|<meta\\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["'][^>]*>`, "i");
  const match = html.match(expression);
  return match?.[1] || match?.[2] || "";
}

async function articleFromUrl(fetchImpl, sourceUrl) {
  const response = await fetchImpl(sourceUrl, { headers: { accept: "text/html,application/xhtml+xml" } });
  if (!response.ok) throw new StudioError(`Could not load the news link (HTTP ${response.status}).`, "NEWS_SOURCE_FETCH_FAILED", 422);
  const html = (await response.text()).slice(0, 1_000_000);
  const title = htmlText(htmlMeta(html, "og:title") || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1], 500);
  const summary = htmlText(htmlMeta(html, "og:description") || htmlMeta(html, "description") || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || html, 4000);
  if (!title) throw new StudioError("The news link has no readable title.", "NEWS_SOURCE_EMPTY", 422);
  const source = new URL(sourceUrl).hostname.replace(/^www\./i, "");
  const candidateImage = htmlMeta(html, "og:image");
  let imageUrl = null;
  try {
    const parsed = new URL(candidateImage, sourceUrl);
    if (["http:", "https:"].includes(parsed.protocol)) imageUrl = parsed.toString();
  } catch { /* A missing or malformed og:image is fine; Wikimedia search can fill it. */ }
  return { title, summary, source, url: sourceUrl, publishedAt: null, imageUrl };
}

export class ProductionService {
  constructor(store, queue, { fetchImpl = globalThis.fetch, research, llm, imageSearch = searchImageQueries, downloadImage = downloadImageAsset, sourceCard = createNewsSourceCard } = {}) {
    this.store = store;
    this.queue = queue;
    this.controller = new AbortController();
    this.fetch = (url, options = {}) => fetchImpl(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, this.controller.signal]) : this.controller.signal });
    this.research = research || createResearchService({ fetchImpl: this.fetch });
    this.llm = llm || ((system, input, options = {}) => requestJsonContent(store, system, input, {...options,fetchImpl:this.fetch,signal:this.controller.signal}));
    this.imageSearch = imageSearch;
    this.downloadImage = downloadImage;
    this.sourceCard = sourceCard;
    this.imageSearchCache = new Map();
    this.worker = null;
    this.newsMediaPromises = new Map();
    this.syncTimer = null;
    this.onStoreChange = () => {
      if (this.syncTimer) return;
      this.syncTimer = setTimeout(() => {
        this.syncTimer = null;
        this.syncLinkedJobs();
      }, 0);
    };
    store.on("change", this.onStoreChange);
    for (const batch of store.state.productionBatches) {
      let interrupted = false;
      for (const item of batch.items) {
        // Retry jobs retain the production identity and are appended to the
        // queue. The latest attempt is authoritative for this item's status.
        const job = store.state.jobs.findLast(job => job.production?.batchId === batch.id && job.production.itemIndex === item.index);
        if (job) {
          // Rebuild the production view from the authoritative job state on
          // every server start.  The old recovery path marked every linked
          // item as queued, including jobs that had already completed or
          // failed, so the UI could keep showing stale queued batches after a
          // restart and lose the actual render outcome.
          item.jobId = job.id;
          if (job.status === "completed") {
            item.status = "completed";
            item.error = null;
            item.errorCode = null;
          } else if (["failed", "cancelled"].includes(job.status)) {
            item.status = "failed";
            item.error = job.error || "The linked job failed.";
            item.errorCode = job.errorCode || "JOB_FAILED";
          } else if (job.status === "interrupted") {
            item.status = "interrupted";
            item.error = job.error || "The linked job was interrupted.";
            item.errorCode = job.errorCode || "JOB_INTERRUPTED";
            interrupted = true;
          } else {
            item.status = job.status === "preparing" ? "preparing" : "queued";
            item.error = null;
            item.errorCode = null;
          }
        }
        else if (["pending", "preparing"].includes(item.status)) { item.status = "interrupted"; interrupted = true; }
      }
      if (interrupted) batch.status = "interrupted";
      else if (batch.items.every(item => item.status === "completed")) batch.status = "completed";
      else if (batch.items.some(item => ["failed", "interrupted"].includes(item.status))) batch.status = batch.items.some(item => item.jobId && !["failed", "interrupted"].includes(item.status)) ? "partial" : "failed";
      else if (batch.items.some(item => item.status === "preparing")) batch.status = "preparing";
      else if (batch.items.some(item => item.status === "queued")) batch.status = "queued";
    }
    store.save();
  }

  syncLinkedJobs() {
    let changed = false;
    for (const batch of this.store.state.productionBatches) {
      let interrupted = false;
      for (const item of batch.items) {
        const job = this.store.state.jobs.findLast((candidate) => candidate.production?.batchId === batch.id && candidate.production.itemIndex === item.index);
        if (!job) continue;
        const nextStatus = job.status === "completed"
          ? "completed"
          : ["failed", "cancelled"].includes(job.status)
            ? "failed"
            : job.status === "interrupted"
              ? "interrupted"
              : ["preparing"].includes(job.status)
                ? "preparing"
                : "queued";
        const nextError = ["failed", "interrupted"].includes(nextStatus) ? job.error || "The linked job failed." : null;
        const nextCode = ["failed", "interrupted"].includes(nextStatus) ? job.errorCode || "JOB_FAILED" : null;
        if (item.jobId !== job.id || item.status !== nextStatus || item.error !== nextError || item.errorCode !== nextCode) {
          Object.assign(item, { jobId: job.id, status: nextStatus, error: nextError, errorCode: nextCode });
          touchPreparation(batch, item);
          changed = true;
        }
        interrupted ||= nextStatus === "interrupted";
      }
      const nextBatchStatus = interrupted
        ? "interrupted"
        : batch.items.every((item) => item.status === "completed")
          ? "completed"
          : batch.items.some((item) => ["failed", "interrupted"].includes(item.status))
            ? batch.items.some((item) => item.jobId && !["failed", "interrupted"].includes(item.status)) ? "partial" : "failed"
            : batch.items.some((item) => item.status === "preparing")
              ? "preparing"
              : batch.items.some((item) => item.status === "queued")
                ? "queued"
                : batch.status;
      if (batch.status !== nextBatchStatus) {
        batch.status = nextBatchStatus;
        changed = true;
      }
    }
    if (changed) this.store.save();
  }

  create(input) {
    const request = productionRequestSchema.parse(input);
    const existing = this.store.state.productionBatches.find(batch => batch.request.requestId === request.requestId);
    if (existing) {
      if (JSON.stringify(productionRequestSchema.parse(existing.request)) !== JSON.stringify(request)) throw new StudioError("This request was already used with different options.", "REQUEST_CONFLICT", 409);
      return existing;
    }
    this.store.require("projects", request.projectId);
    if (!this.store.state.settings.llm?.enabled) throw new StudioError("Enable and test the LLM in Settings first.", "LLM_DISABLED", 409);
    for (const researchId of new Set([request.researchId, ...request.researchIds].filter(Boolean))) {
      const research = this.store.require("researchResults", researchId);
      if (research.projectId !== request.projectId)
        throw new StudioError("Use research from this project.", "RESEARCH_PROJECT_MISMATCH", 409);
    }
    for (const id of request.references) {
      const media = this.store.require("media", id);
      if (media.kind !== "image" || media.projectId && media.projectId !== request.projectId) throw new StudioError("Use product images from this project.", "INVALID_REFERENCE");
    }
    if (request.accountId !== "auto" && this.store.require("accounts", request.accountId).provider !== "dreamface") throw new StudioError("Select a DreamFace profile.", "INVALID_ACCOUNT");
    for (const avatarId of new Set([request.avatarMediaId, ...request.mcRotation.map(entry => entry.avatarMediaId)].filter(Boolean))) {
      const avatar = this.store.require("media", avatarId);
      if (request.contentType !== "news" || avatar.kind !== "image" || isPageAvatar(avatar, this.store.state) || avatar.projectId && avatar.projectId !== request.projectId)
        throw new StudioError("Chọn ảnh MC trong thư viện của dự án này.", "INVALID_AVATAR_IMAGE", 422);
    }
    const batch = this.store.add("productionBatches", {
      projectId: request.projectId, request, status: "pending", sources: [], warnings: [],
      items: Array.from({length:request.count}, (_, index) => ({index,status:"pending",jobId:null,researchId:request.researchIds[index] || request.researchId,avatarMediaId:mcForVideo(request,index),error:null})),
    });
    this.kick();
    return batch;
  }

  retry(id) {
    const batch = this.store.require("productionBatches", id);
    let requested = false;
    for (const item of batch.items) {
      if (!item.jobId && ["failed", "interrupted"].includes(item.status)) {
        item.status = "pending";
        item.stage = 'Đang chờ chuẩn bị lại';
        item.error = null;
        item.errorCode = null;
        item.retryRequestedAt = touchPreparation(batch, item);
        item.preparationFinishedAt = null;
        requested = true;
      }
    }
    if (!requested) return batch;
    batch.error = null;
    batch.errorCode = null;
    if (batch.items.some(item => item.status === "pending")) batch.status = "pending";
    this.store.save();
    this.kick();
    return batch;
  }

  kick() {
    if (this.worker || this.controller.signal.aborted) return;
    this.worker = Promise.resolve().then(() => this.drain()).finally(() => { this.worker = null; });
  }

  async drain() {
    while (!this.controller.signal.aborted) {
      const batch = this.store.state.productionBatches.find(batch => batch.items.some(item => item.status === "pending"));
      if (!batch) return;
      const request = batch.request;
      batch.status = "preparing";
      batch.stage = 'Đang chuẩn bị nguồn tin';
      batch.preparationStartedAt = touchPreparation(batch);
      this.store.save();
      try {
        if (request.researchIds?.length && !batch.sources.length) {
          batch.sources = [...new Set(request.researchIds)].flatMap(id => this.store.require("researchResults", id).articles || []);
          this.store.save();
        } else if (request.sourceUrl && !batch.sources.length) {
          batch.sources = [await articleFromUrl(this.fetch, request.sourceUrl)];
          batch.warnings = [];
          this.store.save();
        } else if (request.researchId && !batch.sources.length) {
          const research = this.store.require("researchResults", request.researchId);
          batch.sources = research.articles || [];
          batch.warnings = research.warnings || [];
          this.store.save();
        } else if ((request.contentType === "news" || request.autoResearch) && !batch.sources.length) {
          const discovery = await this.research.discover({topic:request.topic,feeds:request.feeds,count:request.count,signal:this.controller.signal});
          batch.sources = discovery.articles;
          batch.warnings = discovery.warnings;
          if (!batch.sources.length) throw new StudioError('Chưa tìm thấy tin mới phù hợp sau khi mở rộng từ khóa.', 'NO_CURRENT_NEWS', 422);
          if (batch.sources.length < request.count) batch.warnings.push(`${batch.sources.length} current stories found; extra videos use different versions of these stories.`);
          this.store.save();
        }
        const work = async () => {
          while (!this.controller.signal.aborted) {
            const item = batch.items.find(item => item.status === "pending");
            if (!item) return;
            item.status = "preparing";
            item.stage = 'Đang chuẩn bị nội dung';
            item.error = null;
            item.errorCode = null;
            item.preparationStartedAt = touchPreparation(batch, item);
            this.store.save();
            try { await this.prepareItem(batch, item); }
            catch (error) {
              item.status = this.controller.signal.aborted ? "interrupted" : "failed";
              item.errorCode = error?.code || "PREPARATION_FAILED";
              item.error = preparationMessage(error, "Could not prepare this video. Check the sources and LLM, then retry.");
            }
            item.preparationFinishedAt = touchPreparation(batch, item);
            this.store.save();
          }
        };
        // Keep News preparation's LLM calls in order. The provider render
        // jobs still run concurrently once queued, while this avoids sending
        // two long JSON generations and the shared image ranking request at
        // the same time to a gateway that may reject one of them.
        await Promise.all(request.contentType === "news" ? [work()] : [work(), work()]);
      } catch (error) {
        for (const item of batch.items.filter(item => item.status === "pending")) {
          item.status = this.controller.signal.aborted ? "interrupted" : "failed";
          item.errorCode = error?.code || "RESEARCH_FAILED";
          item.error = preparationMessage(error, "Research failed. Check the source feed and try again.");
          item.preparationFinishedAt = touchPreparation(batch, item);
        }
        batch.errorCode = error?.code || "RESEARCH_FAILED";
        batch.error = preparationMessage(error, "Research failed. Check the source feed and try again.");
      }
      batch.status = this.controller.signal.aborted ? "interrupted" : batch.items.every(item => item.jobId) ? "queued" : batch.items.some(item => item.jobId) ? "partial" : "failed";
      touchPreparation(batch);
      this.store.save();
    }
  }

  async prepareItem(batch, item) {
    const request = batch.request;
    const stage = message => { item.stage = message; item.stageUpdatedAt = touchPreparation(batch, item); this.store.save(); };
    if (item.avatarMediaId === undefined) item.avatarMediaId = mcForVideo(request, item.index);
    let research = item.researchId
      ? this.store.require("researchResults", item.researchId)
      : request.researchId
        ? this.store.require("researchResults", request.researchId)
        : null;
    const source = research?.articles?.[item.index % (research.articles.length || 1)] || (batch.sources.length ? batch.sources[item.index % batch.sources.length] : null);
    if (research && !item.researchId) {
      item.researchId = research.id;
      this.store.save();
    }
    if (request.contentType === "news" && !research) {
      stage('Đang tổng hợp bản tin từ nguồn');
      research = await this.research.research({projectId:request.projectId,topic:source.title.slice(0,200),niche:`${request.topic} · video ${item.index + 1}`,language:"en",maxArticles:1},this.store,{articles:[source]});
      if (research.warnings?.some(warning=>warning.includes("LLM"))) throw new StudioError("Research LLM failed. Test the saved model, then retry.","LLM_FAILED",502);
      item.researchId = research.id;
      this.store.save();
    }
    let newsPlan = null;
    if (request.contentType === "news" && request.engine !== "preview") {
      const callLlm = (_store, system, input, options) => this.llm(system, input, options);
      let narration;
      stage('Đang viết lời đọc cho MC');
      try {
        narration = await writeNewsNarration(this.store, research, {
          llm: callLlm,
          variation: item.index + 1,
          total: request.count,
          newsDuration: request.newsDuration,
          newsImageCount: request.newsImageCount,
        });
      } catch (error) {
        // A transient gateway timeout or malformed JSON should not make a
        // whole News batch disappear. Retry one LLM generation before the
        // preparation item is marked failed and shown to the user.
        if (!["LLM_FAILED", "LLM_INVALID_RESPONSE"].includes(error?.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 1200));
        narration = await writeNewsNarration(this.store, research, {
          llm: callLlm,
          variation: item.index + 1,
          total: request.count,
          newsDuration: request.newsDuration,
          newsImageCount: request.newsImageCount,
        });
      }
      const sharedMedia = await this.prepareNewsMedia(batch, request, research, narration, callLlm, stage);
      newsPlan = newsPlanSchema.parse({
        ...narration,
        imageMediaIds: selectNewsVariant(sharedMedia.imageMediaIds, item.index + 1),
        selectedImageIds: sharedMedia.selectedImageIds,
        visualMode: sharedMedia.visualMode,
        variation: item.index + 1,
        visualVariant: item.index + 1,
        fontStyle: request.fontStyle,
        avatarMediaId: item.avatarMediaId,
      });
      item.title = newsPlan.headline;
      item.newsPlan = newsPlan;
      item.imagePreparation = sharedMedia.diagnostics;
      this.store.save();
    } else if (!item.prompt) {
      if (research) {
        item.title = research.headline;
        item.prompt = `Create a vertical news video for a US audience. Use American English narration and captions. Explain only the supplied verified facts. Use relevant editorial visuals and a professional presenter; do not impersonate a real broadcaster or use its logo.\n${research.headline}\n${research.script}\nSource: ${source?.source || ""}. ${productVariationDirective(item.index + 1, request.count)}`;
      } else {
        const generated = productOutput.parse(await this.llm(
          "Create one product video concept. Return productName, productBrief and prompt. If researching, select a real product or product category mentioned in the supplied report. If no product is supported, return an empty productName. Never invent prices, discounts, performance claims, customer experiences or availability. For a supplied product, use only the brief and reference images. Each variation must change the hook, shots, and pacing. Include a simple CTA without invented offers.",
          {productName:request.productName,productBrief:request.productBrief,source,variation:item.index+1,total:request.count,duration:request.duration,ratio:request.ratio},
        ));
        item.title = generated.productName;
        item.productBrief = generated.productBrief;
        item.prompt = `${generated.prompt}\nAll speech, captions and calls to action must be American English. Preserve the supplied product's appearance.\n${productVariationDirective(item.index + 1, request.count)}`;
      }
      this.store.save();
    }
    this.controller.signal.throwIfAborted();
    stage('Đang đưa video vào hàng đợi MC');
    const production = {
      batchId: batch.id,
      itemIndex: item.index,
      variation: item.index + 1,
      visualVariant: item.index + 1,
      variationPolicy: request.variationPolicy,
      autoCreateContent: request.autoCreateContent === true,
      presenterMode: request.mcRotation?.length ? "image-rotation" : item.avatarMediaId ? "selected-image" : request.contentType === "news" && request.accountId !== "auto" ? "same-account" : "auto-rotate",
      avatarMediaId: item.avatarMediaId,
      visualMode: newsPlan?.visualMode || null,
      contentType: request.contentType,
      researchId: item.researchId,
      topic: request.topic,
      sourceUrl: request.sourceUrl,
      fontStyle: request.fontStyle,
      title: item.title,
      productBrief: item.productBrief || request.productBrief,
      productUrl: request.productUrl,
      sources: source ? [source] : [],
    };
    let job;
    if (request.engine === "preview") {
      if (!research) throw new StudioError("Preview mode is available for researched news only.", "RESEARCH_REQUIRED", 422);
      let assets = (research.imageMediaIds || []).map(id=>this.store.state.media.find(media=>media.id===id)).filter(Boolean);
      if (!assets.length) {
        const found = await this.imageSearch(research.imageQueries,{fetchImpl:this.fetch,maxResultsPerQuery:4,maxResults:16});
        for (const image of newsImageCandidates(research.articles,found.images).slice(0,5)) {
          try { assets.push(await this.downloadImage({image,store:this.store,projectId:request.projectId,fetchImpl:this.fetch})); }
          catch { /* A failed image can be skipped if another valid one is available. */ }
        }
        this.store.patch("researchResults",research.id,{imageMediaIds:assets.map(media=>media.id),imageSearchResults:found.images});
      }
      if (!assets.length) throw new StudioError("No usable editorial images were found. Retry with another niche.","IMAGE_SEARCH_EMPTY",422);
      const variantAssets = selectNewsVariant(assets.slice(0, 5).map((asset) => asset.id), item.index + 1).map((id) => assets.find((asset) => asset.id === id)).filter(Boolean);
      const assembly = buildResearchAssemblyTimeline({...defaultTimeline(),quality:"draft"},variantAssets,research,undefined,{template:"news-short"});
      this.controller.signal.throwIfAborted();
      job = this.queue.enqueueRender({projectId:request.projectId,name:`News · ${item.title}`,timeline:assembly.timeline},{production});
    } else if (request.contentType === "news") {
      job = this.queue.enqueueNews({ projectId: request.projectId, accountId: request.accountId, name: `News · ${newsPlan.headline}`, plan: newsPlan, imageMediaIds: newsPlan.imageMediaIds, production });
    } else {
      job = this.queue.enqueueGeneration({projectId:request.projectId,provider:"dreamface",accountId:request.accountId,kind:"video",mode:request.references.length?"reference":"text",model:"DreamFace video",duration:request.duration,ratio:request.ratio,prompts:[item.prompt],references:request.references,autoAssemble:request.count === 1},{production})[0];
    }
    item.jobId = job.id;
    item.status = "queued";
    item.stage = 'Đã vào hàng đợi render';
    item.error = null;
  }

  async prepareNewsMedia(batch, request, research, narration, callLlm, stage = () => {}) {
    // A batch can contain different stories. Neither its cache nor its in-flight
    // promise may be shared between research IDs.
    const target = newsImageTarget(request.newsDuration, request.newsImageCount);
    const key = batch.id + ':' + research.id + ':' + target;
    const usable = media => media?.kind === 'image' && media.projectId === request.projectId
      && media.id !== request.avatarMediaId && !request.mcRotation?.some(entry => entry.avatarMediaId === media.id)
      && !isPageAvatar(media, this.store.state) && !isMcImage(media, this.store.state);
    const scoped = batch.newsMediaByResearch?.[research.id];
    if (scoped?.revision >= 5 && scoped.target === target && scoped.imageMediaIds?.length
      && scoped.imageMediaIds.every(id => usable(this.store.state.media.find(media => media.id === id)))) {
      return { imageMediaIds: [...scoped.imageMediaIds], selectedImageIds: [...scoped.selectedImageIds], visualMode: scoped.visualMode || 'photo', diagnostics: scoped.diagnostics };
    }
    const prior = this.newsMediaPromises.get(key);
    if (prior) return prior;
    const promise = (async () => {
      stage('Đang kiểm tra ảnh của bản tin');
      const savedIds = [...new Set([
        ...(research.imageMediaIds || []),
        ...(batch.newsImageResearchId === research.id ? batch.newsImageMediaIds || [] : []),
      ])];
      const saved = savedIds.map(id => this.store.state.media.find(media => media.id === id)).filter(media => usable(media) && media.visualRole !== 'source-card');
      let candidates = newsImageCandidates(research.articles, research.imageSearchResults || []);
      const addSavedCandidates = () => {
        for (const media of saved) {
          if (media.sourceImageUrl && candidates.some(image => image.imageUrl === media.sourceImageUrl)) continue;
          candidates.push({ id: 'media:' + media.id, mediaId: media.id, title: media.name || 'Saved research image', description: media.imageDescription || '', query: research.topic || research.headline, pageUrl: media.sourceUrl, imageUrl: media.sourceImageUrl });
        }
      };
      addSavedCandidates();
      const diagnostics = { target, attempts: [], searches: [], duplicates: 0, downloadErrors: [], warnings: [] };
      const queries = newsVisualQueries(research, narration);
      const merge = extra => { const seen = new Set(); candidates = [...extra, ...candidates].filter(image => { const key = newsImageKey(image); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 80); };
      const search = async searchQueries => {
        if (!searchQueries.length) return;
        stage('Đang tìm ảnh liên quan');
        try {
          const found = await this.imageSearch(searchQueries, { fetchImpl: this.fetch, maxResultsPerQuery: 8, maxResults: 48, cache: this.imageSearchCache });
          merge(newsImageCandidates([], found.images));
          diagnostics.searches.push({queries: searchQueries, found: found.images.length});
          diagnostics.warnings.push(...(found.warnings || []));
          this.store.patch('researchResults', research.id, { imageSearchResults: candidates.filter(image => image.imageUrl && !image.id.startsWith('article:')), imageSearchWarnings: diagnostics.warnings });
        } catch (error) { this.controller.signal.throwIfAborted(); diagnostics.warnings.push(error.message); }
      };
      if (candidates.filter(image => image.id.startsWith('article:')).length < target) {
        const source = await discoverArticleImages(research.articles, { fetchImpl: this.fetch });
        merge(newsImageCandidates(source.articles));
        diagnostics.warnings.push(...source.warnings);
      }
      const assets = [];
      const assetKeys = new Set();
      const selectedIds = [];
      const downloadFailed = new Set();
      const selectedCandidateIds = new Set();
      const contentHashes = new Set();
      const fingerprints = [];
      const reviewedContext = new Set();
      const select = async (allowIllustrations, reviewed = new Set()) => {
        stage(allowIllustrations ? 'Đang chọn ảnh minh họa đúng chủ thể' : 'Đang xác minh ảnh theo nội dung tin');
        // Keep a reserve and continue with unreviewed candidates when downloads
        // fail or different URLs decode to the same image. Never recycle rejects.
        for (let round = 0; round < 3 && assets.length < target; round++) {
        let ranked = [];
        const available = candidates.filter(image => !reviewed.has(image.id) && !selectedCandidateIds.has(image.id) && !downloadFailed.has(image.id) && !assetKeys.has(newsImageKey(image)));
        if (!available.length) break;
        try { ranked = await rankNewsImages(this.store, { ...research, headline: narration.headline, script: narration.narration }, available, { llm: callLlm, allowIllustrations, maxImages: target - assets.length + 6, alreadySelected: assets.map(media => ({title:media.name,description:media.imageDescription})), onReviewed: ids => ids.forEach(id => reviewed.add(id)), onWarning: warning => diagnostics.warnings.push(warning) }); }
        catch (error) { this.controller.signal.throwIfAborted(); diagnostics.warnings.push(error.message); }
        diagnostics.attempts.push({ mode: allowIllustrations ? 'illustration' : 'photo', candidates: available.length, selected: ranked.length });
        if (!ranked.length) break;
        for (const image of ranked) {
        if (assets.length >= target) break;
        selectedCandidateIds.add(image.id);
        const source = newsImageKey(image);
        if (downloadFailed.has(image.id)) continue;
        const cached = image.mediaId ? saved.find(media => media.id === image.mediaId)
          : this.store.state.media.find(media => usable(media) && image.imageUrl && media.sourceImageUrl && newsImageKey({imageUrl:media.sourceImageUrl}) === source);
        if (assetKeys.has(cached?.id || source || image.id)) continue;
        try {
          const media = cached || await this.downloadImage({ image, store: this.store, projectId: request.projectId, fetchImpl: this.fetch });
          if (!usable(media)) continue;
          if (media.contentHash && contentHashes.has(media.contentHash)) { diagnostics.duplicates++; assetKeys.add(source); continue; }
          const fingerprint = media.newsFingerprint?.revision === 1 ? media.newsFingerprint : await newsImageFingerprint(this.store,media,this.controller.signal);
          if (fingerprint) {
            this.store.patch('media',media.id,{newsFingerprint:fingerprint});
            if (fingerprints.some(prior=>sameNewsImage(prior,fingerprint))) { diagnostics.duplicates++;assetKeys.add(source);continue; }
            fingerprints.push(fingerprint);
          }
          if (media.contentHash) contentHashes.add(media.contentHash);
          assets.push(media); assetKeys.add(media.id); if (source) assetKeys.add(source);
          selectedIds.push(image.id);
          this.store.patch('media', media.id, { newsResearchIds: [...new Set([...(media.newsResearchIds || []), research.id])] });
        } catch (error) {
          this.controller.signal.throwIfAborted();
          downloadFailed.add(image.id);
          diagnostics.downloadErrors.push({ title: image.title, error: String(error.message).slice(0, 180) });
        }
        }
        }
      };
      await select(false);
      let visualMode = selectedIds.some(id => !id.startsWith('article:')) ? 'illustration' : 'photo';
      if (assets.length < target) {
        // Rejected cached candidates must trigger another search, even if their
        // count is high. Context imagery is labeled, never treated as event proof.
        await search(queries);
        await select(true, reviewedContext);
      }
      if (assets.length < target) {
        stage('Đang tìm thêm góc ảnh đúng chủ thể trong nguồn tin');
        try {
          const extraQueries = await additionalNewsImageQueries(this.store, research, narration, queries, {llm:callLlm});
          if (extraQueries.length) { await search(extraQueries); await select(true, reviewedContext); }
        } catch (error) { this.controller.signal.throwIfAborted(); diagnostics.warnings.push(`Không mở rộng được tìm ảnh: ${String(error.message).slice(0, 180)}`); }
      }
      if (selectedIds.some(id => !id.startsWith('article:'))) visualMode = 'illustration';
      if (!assets.length) {
        this.controller.signal.throwIfAborted();
        stage('Đang dựng thẻ tin từ tiêu đề và nguồn');
        assets.push(await this.sourceCard(this.store, research, this.controller.signal));
        visualMode = 'source-card';
      }
      let warning = visualMode === 'source-card' ? 'Không tìm được ảnh liên quan tải được; video dùng thẻ tin từ tiêu đề/nguồn và MC.'
        : visualMode === 'illustration' ? 'Video dùng ảnh minh họa đúng chủ thể, có nhãn CONTEXT IMAGE; không phải ảnh hiện trường.' : '';
      if (assets.length < target && visualMode !== 'source-card') warning += ` Chọn được ${assets.length}/${target} ảnh phù hợp; không chèn ảnh ngoài nội dung để đủ số.`;
      diagnostics.warnings = [...new Set(diagnostics.warnings)];
      if (assets.length < target && diagnostics.warnings.some(item => /Không kiểm tra được|Không xác minh được/.test(item))) warning += ' Một số ảnh chưa kiểm tra được vì lỗi LLM; có thể thử lại bước chuẩn bị để bổ sung ảnh.';
      if (warning) batch.warnings = [...new Set([...(batch.warnings || []), warning])];
      Object.assign(diagnostics, { visualMode, warning, downloaded: assets.length, updatedAt: new Date().toISOString() });
      const result = { imageMediaIds: assets.map(media => media.id), selectedImageIds: selectedIds, visualMode, diagnostics };
      batch.newsMediaByResearch = { ...batch.newsMediaByResearch, [research.id]: { ...result, target, revision: 5 } };
      this.store.patch('researchResults', research.id, { imageMediaIds: result.imageMediaIds, imagePreparation: diagnostics });
      this.store.save();
      return result;
    })();
    this.newsMediaPromises.set(key, promise);
    try { return await promise; }
    finally { this.newsMediaPromises.delete(key); }
  }

  async close() {
    this.controller.abort();
    await this.worker;
    this.store.off("change", this.onStoreChange);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.newsMediaPromises.clear();
    this.imageSearchCache.clear();
  }
}

export function mountProductionRoutes(app, store, queue, options = {}) {
  const service = new ProductionService(store,queue,options);
  app.post("/api/production/batches",(req,res)=>res.status(202).json(service.create(req.body)));
  app.post("/api/production/batches/:id/retry",(req,res)=>res.status(202).json(service.retry(req.params.id)));
  return service;
}
