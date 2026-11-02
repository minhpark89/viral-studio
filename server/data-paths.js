import fs from "node:fs";
import path from "node:path";

const fields = { file: ["media", "exports"], thumbnail: ["thumbs"], previewFile: ["thumbs"] };

// Only relocate managed media fields. Never rewrite URLs, prompts, credentials,
// external tool settings or arbitrary strings in the workspace snapshot.
export function relocateMediaPaths(state, root) {
  let changed = false;
  let relinked = 0;
  const previousRoot = state.dataRoot;
  for (const media of state.media || []) {
    for (const [field, folders] of Object.entries(fields)) {
      const value = media[field];
      if (typeof value !== "string" || !value) continue;
      const flavor = /^(?:[a-z]:[\\/]|\\\\)/i.test(value) ? path.win32 : path.posix;
      if (!flavor.isAbsolute(value)) continue;
      let relative;
      if (previousRoot) {
        relative = flavor.relative(previousRoot, value);
      } else {
        // Pre-0.7.7 imports always used <data root>/<folder>/<UUID>.<ext>.
        const folder = flavor.basename(flavor.dirname(value));
        if (!folders.includes(folder)) continue;
        relative = flavor.join(folder, flavor.basename(value));
      }
      const parts = relative.split(/[\\/]/);
      if (!folders.includes(parts[0]) || parts.some(part => !part || part === ".." || part === "." || part.includes(":"))) continue;
      const candidate = path.resolve(root, ...parts);
      if (!candidate.startsWith(path.resolve(root) + path.sep)) continue;
      try {
        if (candidate !== value && fs.statSync(candidate).isFile()) {
          media[field] = candidate;
          changed = true;
          relinked++;
        }
      } catch { /* An incomplete copy must not link to an unrelated file. */ }
    }
  }
  if (state.dataRoot !== root) {
    state.dataRoot = root;
    changed = true;
  }
  return { changed, relinked };
}
