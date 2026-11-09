import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import { StudioError } from "./store.js";

export const productText = (value, limit = 4000) =>
  String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Math.min(0x10ffff, Number(n))),
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

export function publicAddress(address) {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19].includes(b))
    );
  }
  if (net.isIP(ip) === 6)
    return /^2[0-9a-f]{3}:/.test(ip) && !ip.startsWith("2001:db8:");
  return false;
}

// Every redirect is checked. Remote product pages cannot read localhost,
// link-local metadata, LAN addresses or a file on the user's machine.
function pinnedFetch(url, { headers, signal, addresses }) {
  return new Promise((resolve, reject) => {
    const request = (url.startsWith("https:") ? https : http).get(
      url,
      {
        headers,
        signal,
        lookup: (_host, options, done) => {
          if (options.all)
            done(
              null,
              addresses.map((row) => ({
                ...row,
                family: row.family || net.isIP(row.address),
              })),
            );
          else
            done(
              null,
              addresses[0].address,
              addresses[0].family || net.isIP(addresses[0].address),
            );
        },
      },
      (response) => {
        try {
          const resultHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers))
            if (value != null)
              resultHeaders.set(
                key,
                Array.isArray(value) ? value.join(", ") : value,
              );
          const encoding = response.headers["content-encoding"];
          const decoder =
            encoding === "gzip"
              ? createGunzip()
              : encoding === "deflate"
                ? createInflate()
                : encoding === "br"
                  ? createBrotliDecompress()
                  : null;
          if (decoder) {
            response.on("error", (error) => decoder.destroy(error));
            response.pipe(decoder);
          }
          resolve(
            new Response(
              [204, 205, 304].includes(response.statusCode)
                ? null
                : Readable.toWeb(decoder || response),
              {
                status: response.statusCode,
                headers: resultHeaders,
              },
            ),
          );
        } catch (error) {
          response.destroy();
          reject(error);
        }
      },
    );
    request.on("error", reject);
  });
}
export async function fetchProductResource(
  value,
  {
    fetchImpl = pinnedFetch,
    lookup = dns.lookup,
    signal,
    maxBytes = 3 * 1024 * 1024,
    accept = "text/html",
    redirects = 4,
  } = {},
) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new StudioError("Link sản phẩm không hợp lệ.", "PRODUCT_URL_INVALID");
  }
  for (let hop = 0; hop <= redirects; hop++) {
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      (url.port && !["80", "443"].includes(url.port))
    )
      throw new StudioError(
        "Chỉ hỗ trợ link web công khai HTTP/HTTPS.",
        "PRODUCT_URL_INVALID",
      );
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = net.isIP(host)
      ? [{ address: host }]
      : await lookup(host, { all: true });
    if (
      !addresses.length ||
      addresses.some((row) => !publicAddress(row.address))
    )
      throw new StudioError(
        "Không đọc địa chỉ nội bộ qua link sản phẩm.",
        "PRODUCT_URL_PRIVATE",
      );
    const timeout = AbortSignal.timeout(20000);
    const response = await fetchImpl(url.toString(), {
      redirect: "manual",
      addresses,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {
        accept,
        "user-agent":
          "Mozilla/5.0 (compatible; ViralStudio ProductResearch/1.0)",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel?.();
      if (hop === redirects || !response.headers.get("location"))
        throw new StudioError(
          "Link chuyển hướng quá nhiều.",
          "PRODUCT_FETCH_FAILED",
        );
      url = new URL(response.headers.get("location"), url);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel?.();
      throw new StudioError(
        `Trang nguồn trả HTTP ${response.status}. Có thể dùng ảnh sản phẩm thay thế.`,
        "PRODUCT_FETCH_FAILED",
        422,
      );
    }
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel?.();
      throw new StudioError(
        "Dữ liệu nguồn quá lớn.",
        "PRODUCT_SOURCE_TOO_LARGE",
      );
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > maxBytes)
        throw new StudioError(
          "Dữ liệu nguồn quá lớn.",
          "PRODUCT_SOURCE_TOO_LARGE",
        );
      chunks.push(chunk);
    }
    return {
      url: url.toString(),
      bytes: Buffer.concat(chunks),
      type: response.headers.get("content-type") || "",
    };
  }
}

function meta(html, key) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = Object.fromEntries(
      [...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((m) => [
        m[1].toLowerCase(),
        m[2],
      ]),
    );
    if (
      (attrs.property || attrs.name || "").toLowerCase() === key.toLowerCase()
    )
      return productText(attrs.content);
  }
  return "";
}
function walk(value, visit, depth = 0) {
  if (!value || typeof value !== "object" || depth > 35) return;
  visit(value);
  for (const child of Object.values(value))
    if (child && typeof child === "object") walk(child, visit, depth + 1);
}
export function parseProductPage(html, url) {
  const products = [];
  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  ))
    try {
      walk(JSON.parse(match[1]), (node) => {
        if (
          []
            .concat(node["@type"] || [])
            .some((t) => /^(?:https?:\/\/schema.org\/)?Product$/i.test(t))
        )
          products.push(node);
      });
    } catch {}
  const product = products[0] || {};
  const rawImage = [].concat(product.image || [])[0];
  let imageUrl =
    typeof rawImage === "string"
      ? rawImage
      : rawImage?.url || meta(html, "og:image");
  try {
    imageUrl = imageUrl ? new URL(imageUrl, url).toString() : null;
  } catch {
    imageUrl = null;
  }
  return {
    url,
    name: productText(
      product.name ||
        meta(html, "og:title") ||
        html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
      200,
    ),
    description: productText(
      product.description ||
        meta(html, "og:description") ||
        meta(html, "description"),
    ),
    brand: productText(product.brand?.name || product.brand, 150),
    sku: productText(product.sku, 100),
    imageUrl,
    extractedFrom: products.length
      ? "Product structured data"
      : "Page title and description",
    checkedAt: new Date().toISOString(),
  };
}

export function assignedJson(html, variable) {
  const marker = new RegExp(`(?:var\\s+)?${variable}\\s*=\\s*`, "g");
  let match;
  while ((match = marker.exec(html))) {
    const start = marker.lastIndex;
    if (html[start] !== "{") continue;
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
        continue;
      }
      if (c === '"') quoted = true;
      else if (c === "{") depth++;
      else if (c === "}" && !--depth) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  return null;
}
const ytText = (value) =>
  productText(
    value?.simpleText || value?.runs?.map((x) => x.text).join("") || value,
    800,
  );
export function youtubeVideoId(value) {
  try {
    const u = new URL(value);
    if (u.hostname === "youtu.be")
      return /^[\w-]{11}$/.test(u.pathname.slice(1))
        ? u.pathname.slice(1)
        : null;
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    const id =
      u.searchParams.get("v") ||
      u.pathname.match(/\/(?:shorts|embed)\/([\w-]{11})/)?.[1];
    return /^[\w-]{11}$/.test(id || "") ? id : null;
  } catch {
    return null;
  }
}
export function parseVideoSearch(html) {
  const data = assignedJson(html, "ytInitialData"),
    result = new Map();
  walk(data, (node) => {
    const short = node.shortsLockupViewModel;
    if (short) {
      const command = short.onTap?.innertubeCommand;
      const id =
        command?.reelWatchEndpoint?.videoId ||
        youtubeVideoId(
          "https://www.youtube.com" +
            command?.commandMetadata?.webCommandMetadata?.url,
        );
      if (id)
        result.set(id, {
          id,
          url: `https://www.youtube.com/watch?v=${id}`,
          title: productText(
            short.overlayMetadata?.primaryText?.content ||
              short.accessibilityText?.split(",")[0],
            300,
          ),
          channel: "",
          viewsText: productText(
            short.overlayMetadata?.secondaryText?.content ||
              short.accessibilityText?.match(/, (.*?) - play Short/)?.[1],
            100,
          ),
          publishedText: "",
          durationText: "Short",
          thumbnailUrl:
            short.thumbnail?.sources?.at(-1)?.url ||
            command?.reelWatchEndpoint?.thumbnail?.thumbnails?.at(-1)?.url ||
            null,
          description: "",
          observedAt: new Date().toISOString(),
        });
    }
    const lock = node.lockupViewModel;
    if (lock?.contentId && /^[-\w]{11}$/.test(lock.contentId)) {
      const rows = lock.metadata?.lockupMetadataViewModel;
      result.set(lock.contentId, {
        id: lock.contentId,
        url: `https://www.youtube.com/watch?v=${lock.contentId}`,
        title: productText(rows?.title?.content, 300),
        channel: "",
        viewsText: productText(
          JSON.stringify(
            rows?.metadata?.contentMetadataViewModel?.metadataRows || [],
          ).match(/[\d.,]+(?: thousand| million|[KM])? views/)?.[0],
          100,
        ),
        publishedText: "",
        durationText: "",
        thumbnailUrl:
          lock.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url ||
          null,
        description: "",
        observedAt: new Date().toISOString(),
      });
    }
    const v = node.videoRenderer;
    if (!v?.videoId || !/^[-\w]{11}$/.test(v.videoId)) return;
    result.set(v.videoId, {
      id: v.videoId,
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      title: ytText(v.title),
      channel: ytText(v.ownerText),
      viewsText: ytText(v.viewCountText),
      publishedText: ytText(v.publishedTimeText),
      durationText: ytText(v.lengthText),
      thumbnailUrl: v.thumbnail?.thumbnails?.at(-1)?.url || null,
      description: ytText(v.detailedMetadataSnippets?.[0]?.snippetText),
      observedAt: new Date().toISOString(),
    });
  });
  return [...result.values()];
}

export function parseVideoPage(html, id) {
  const player = assignedJson(html, "ytInitialPlayerResponse") || {},
    v = player.videoDetails || {},
    micro = player.microformat?.playerMicroformatRenderer || {};
  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: productText(v.title, 300),
    channel: productText(v.author, 150),
    views: Number.isFinite(Number(v.viewCount)) ? Number(v.viewCount) : null,
    durationSeconds: Number(v.lengthSeconds) || null,
    publishedAt: micro.publishDate || null,
    description: productText(v.shortDescription, 5000),
    thumbnailUrl: v.thumbnail?.thumbnails?.at(-1)?.url || null,
    captionTrack:
      player.captions?.playerCaptionsTracklistRenderer?.captionTracks?.find(
        (t) => t.languageCode === "en",
      ) ||
      player.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0] ||
      null,
    storyboardSpec:
      player.storyboards?.playerStoryboardSpecRenderer?.spec || null,
  };
}

export async function researchProductVideos(
  query,
  {
    signal,
    fetchResource = fetchProductResource,
    sourceUrls = [],
    selectVideos,
    categoryQuery,
    limit=6,
    searchQueries,
    stage=()=>{},
  } = {},
) {
  const warnings = [],
    found = new Map();
  const searches = searchQueries||[
    `${query} product review shorts`,
    `${categoryQuery || query} viral product review shorts`,
    `${categoryQuery || query} product demonstration ad`,
  ];
  const outcomes = await Promise.allSettled(
    searches.map(async (q) => {
      const r = await fetchResource(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en&gl=US`,
        { signal },
      );
      return parseVideoSearch(r.bytes.toString());
    }),
  );
  for (const row of outcomes)
    if (row.status === "fulfilled")
      for (const video of row.value) found.set(video.id, video);
    else warnings.push(row.reason.message);
  for (const url of sourceUrls) {
    const id = youtubeVideoId(url);
    if (id)
      found.set(id, {
        id,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: "",
      });
  }
  // A high count is a signal for investigation, not proof that a video is viral.
  const explicit = new Set(sourceUrls.map(youtubeVideoId).filter(Boolean));
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);
  const weight = (v) => {
    if (explicit.has(v.id)) return 1000;
    const text = v.viewsText || "";
    const n =
      (Number(text.replace(/[^\d.]/g, "")) || 0) *
      (/(?:\d[\d.]*M\b|million)/i.test(text)
        ? 1e6
        : /(?:\d[\d.]*K\b|thousand)/i.test(text)
          ? 1e3
          : 1);
    const relevance =
      terms.filter((t) => (v.title || "").toLowerCase().includes(t)).length /
      Math.max(1, terms.length);
    return (
      relevance * 20 + Math.log10(1 + n) + (v.durationText === "Short" ? 2 : 0)
    );
  };
  let ranked = [...found.values()].sort((a, b) => weight(b) - weight(a));
  if (selectVideos && ranked.length) {
    const chosen = await selectVideos(ranked.slice(0, 50));
    const ids = [...new Set([...explicit, ...chosen])];
    ranked = ids.map((id) => found.get(id)).filter(Boolean);
  } else
    ranked = ranked.filter(
      (v) =>
        explicit.has(v.id) ||
        !/(?:without electricity|aquariums?|blow molding|manufactur|factory|homemade|craft project)/i.test(
          v.title || "",
        ),
    );
  ranked = ranked.slice(0,Math.max(1,Math.min(20,limit)));
  const videos = [];
  for (const hit of ranked) {
    stage(`Đang đọc video ${videos.length+1}/${ranked.length}`);
    signal?.throwIfAborted();
    try {
      const r = await fetchResource(hit.url + "&hl=en", { signal });
      const detail = parseVideoPage(r.bytes.toString(), hit.id);
      const video = {
        ...hit,
        ...Object.fromEntries(
          Object.entries(detail).filter(([, v]) => v !== null && v !== ""),
        ),
        transcript: [],
        evidence: ["search metadata"],
        limitations: [],
      };
      if (detail.title) video.evidence.push("watch page metadata");
      if (detail.captionTrack?.baseUrl)
        try {
          const u = new URL(detail.captionTrack.baseUrl);
          u.searchParams.set("fmt", "json3");
          const captions = JSON.parse(
            (
              await fetchResource(u.toString(), {
                signal,
                accept: "application/json",
                maxBytes: 1024 * 1024,
              })
            ).bytes.toString(),
          );
          video.transcript = (captions.events || [])
            .filter((x) => x.segs)
            .slice(0, 160)
            .map((x) => ({
              startSeconds: (x.tStartMs || 0) / 1000,
              text: productText(x.segs.map((s) => s.utf8).join(""), 400),
            }));
          if (video.transcript.length) video.evidence.push("timed captions");
        } catch {
          video.limitations.push("Không đọc được phụ đề công khai.");
        }
      if (!video.transcript.length)
        video.limitations.push(
          "Không xác minh lời nói/hook từ phụ đề; phân tích nội dung phải ghi rõ phần suy luận.",
        );
      delete video.captionTrack;
      videos.push(video);
    } catch (e) {
      videos.push({
        ...hit,
        transcript: [],
        evidence: ["search metadata"],
        limitations: [e.message],
        storyboardSpec: null,
      });
    }
  }
  if (!videos.length)
    warnings.push(
      "Không lấy được video tham khảo công khai. Có thể thử lại hoặc thêm link YouTube; không tạo số liệu viral giả.",
    );
  return {
    query,
    searches,
    videos,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}
