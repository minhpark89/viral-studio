import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { StudioError } from "../store.js";
import { fetchProductResource } from "../product-sources.js";

export class ResearchPreview {
  constructor(root, { fetchResource = fetchProductResource } = {}) {
    this.root = path.resolve(root, "product-research", "previews");
    this.fetchResource = fetchResource;
    this.controller = new AbortController();
    this.pending = new Map();
  }
  async load(record, kind) {
    this.controller.signal.throwIfAborted();
    if (!["image", "video"].includes(kind))
      throw new StudioError("Loại xem trước không hợp lệ.");
    const url =
      kind === "image"
        ? record.thumbnailUrl
        : record.mediaUrl || record.previewClipUrl;
    if (!url)
      throw new StudioError(
        "Nguồn chưa có ảnh / video xem trước. Mở link gốc để xem.",
        "RESEARCH_PREVIEW_MISSING",
        404,
      );
    const id = createHash("sha256").update(`${kind}:${url}`).digest("hex"),
      ext = kind === "video" ? ".mp4" : ".image",
      file = path.join(this.root, id + ext);
    fs.mkdirSync(this.root, { recursive: true });
    if (fs.lstatSync(this.root).isSymbolicLink())
      throw new StudioError("Thư mục preview không được là liên kết thư mục.");
    const metaFile = file + ".json";
    if (
      fs.existsSync(file) &&
      fs.existsSync(metaFile) &&
      !fs.lstatSync(file).isSymbolicLink()
    ) {
      try {
        const info = JSON.parse(fs.readFileSync(metaFile, "utf8"));
        if (Date.now() - info.at < 24 * 3600000) return { file, type: info.type };
      } catch { /* A partial cache metadata file is fetched again. */ }
    }
    if (this.pending.has(id)) return this.pending.get(id);
    if (this.pending.size >= 4) {
      await Promise.race(this.pending.values()).catch(()=>{});
      return this.load(record,kind);
    }
    const task = this.download(url, file, metaFile, kind).finally(() =>
      this.pending.delete(id),
    );
    this.pending.set(id, task);
    return task;
  }
  async download(url, file, metaFile, kind) {
    const r = await this.fetchResource(url, {
      signal: this.controller.signal,
      maxBytes: kind === "image" ? 4 * 1024 * 1024 : 64 * 1024 * 1024,
      accept: kind === "image" ? "image/*" : "video/mp4,video/webm",
    });
    const type = r.type.split(";")[0].toLowerCase();
    if (
      !(
        kind === "image"
          ? /^image\/(?:jpeg|png|webp|gif)$/
          : /^video\/(?:mp4|webm)$/
      ).test(type)
    )
      throw new StudioError(
        "Nguồn không trả về media phát được. Mở link gốc hoặc quét lại để lấy link mới.",
        "RESEARCH_PREVIEW_TYPE",
        422,
      );
    // Only our hashed cache files are eligible for eviction; never touch exports.
    const cached = fs
      .readdirSync(this.root)
      .filter((name) => /^[a-f0-9]{64}\.(?:mp4|image)$/.test(name))
      .map((name) => {
        const target = path.resolve(this.root, name),
          stat = fs.lstatSync(target);
        return { target, stat };
      })
      .filter((x) => x.stat.isFile())
      .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
    let size = cached.reduce((n, x) => n + x.stat.size, 0);
    for (const item of cached) {
      if (size + r.bytes.length <= 512 * 1024 * 1024) break;
      if (path.dirname(item.target) !== path.resolve(this.root))
        throw new StudioError("Cache path invalid");
      try {
        fs.unlinkSync(item.target);
        fs.rmSync(item.target + ".json", { force: true });
        size -= item.stat.size;
      } catch {}
    }
    const temp = file + "." + randomUUID() + ".tmp";
    try {
      fs.writeFileSync(temp, r.bytes);
      fs.renameSync(temp, file);
      fs.writeFileSync(metaFile, JSON.stringify({ type, at: Date.now() }));
    } finally {
      fs.rmSync(temp, { force: true });
    }
    return { file, type };
  }
  async close() {
    this.controller.abort();
    await Promise.allSettled(this.pending.values());
  }
}
