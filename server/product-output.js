import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StudioError } from "./store.js";

export function productOutputSettings(store) {
  const systemDefaultDirectory = path.join(
    store.root,
    "exports",
    "products",
    "final",
  );
  const customDefaultDirectory =
    store.state.settings.productOutputDirectory || "";
  return {
    systemDefaultDirectory,
    customDefaultDirectory,
    defaultDirectory: customDefaultDirectory || systemDefaultDirectory,
    newsDirectory: store.state.settings.newsOutputDirectory || path.join(store.root, 'exports'),
    clipsDirectory: path.join(store.root, 'exports', 'products', 'clips'),
  };
}
export function resolveProductOutput(store, requested = "") {
  const value = z.string().trim().max(2048).parse(requested);
  const directory = value || productOutputSettings(store).defaultDirectory;
  if (!path.isAbsolute(directory) || directory.includes("\0"))
    throw new StudioError(
      "Nhập đường dẫn thư mục đầy đủ, ví dụ D:\\Video Product.",
      "PRODUCT_OUTPUT_INVALID",
    );
  return path.resolve(directory);
}
export function checkProductOutput(store, requested = "") {
  const directory = resolveProductOutput(store, requested);
  let probe;
  try {
    fs.mkdirSync(directory, { recursive: true });
    if (!fs.statSync(directory).isDirectory())
      throw new Error("Đường dẫn không phải thư mục");
    probe = path.join(directory, `.viral-product-write-${randomUUID()}.tmp`);
    const fd = fs.openSync(probe, "wx");
    fs.closeSync(fd);
    fs.unlinkSync(probe);
    probe = null;
    return directory;
  } catch (e) {
    throw new StudioError(
      `Không ghi được thư mục Product: ${directory}. ${e.message}`,
      "PRODUCT_OUTPUT_UNAVAILABLE",
      422,
    );
  } finally {
    if (probe)
      try {
        fs.unlinkSync(probe);
      } catch {}
  }
}
export function mountProductOutput(app, store) {
  app.get("/api/product-output/settings", (req, res) =>
    res.json(productOutputSettings(store)),
  );
  app.patch("/api/product-output/settings", (req, res) => {
    const { directory } = z
      .object({ directory: z.string().trim().max(2048) })
      .parse(req.body);
    const resolved = directory ? checkProductOutput(store, directory) : "";
    store.state.settings.productOutputDirectory = resolved;
    store.save();
    res.json(productOutputSettings(store));
  });
  app.post("/api/product-output/resolve", (req, res) => {
    const { directory } = z
      .object({ directory: z.string().trim().max(2048).default("") })
      .parse(req.body || {});
    res.json({ directory: checkProductOutput(store, directory) });
  });
}
