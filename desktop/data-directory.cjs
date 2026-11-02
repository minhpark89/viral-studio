const fs = require("node:fs");
const path = require("node:path");

function dataDirectory({ isPackaged, executable, sourceRoot, env = process.env, exists = fs.existsSync, readText = file => fs.readFileSync(file, 'utf16le') }) {
  if (env.STUDIO_DATA_DIR) return path.resolve(env.STUDIO_DATA_DIR);
  if (!isPackaged) return path.join(sourceRoot, ".studio");
  const root = env.PORTABLE_EXECUTABLE_DIR || path.dirname(executable);
  const portable = Boolean(env.PORTABLE_EXECUTABLE_DIR);
  const preferred = portable ? path.join(root, 'Viral Data') : path.join(root + '.data', 'Viral Data');
  if (!portable) {
    try {
      const saved = readText(path.join(root, 'data-location.txt')).trim();
      if (path.isAbsolute(saved) && exists(saved)) return saved;
    } catch { /* A fresh install has no data-location pointer. */ }
  }
  const candidates = [preferred, path.join(root, "Viral Data"), path.join(root, "Dropship Data"), path.join(root + '.data', 'Dropship Data')];
  // A portable copy owns its adjacent data even if another version is installed.
  // Installed upgrades retain discovery of the old Dropship installation.
  if (!env.PORTABLE_EXECUTABLE_DIR) {
    candidates.push(path.join(path.dirname(root), "Dropship Studio", "Dropship Data"));
    if (env.LOCALAPPDATA) {
      candidates.push(path.join(env.LOCALAPPDATA, "Programs", "Viral Studio", "Viral Data"));
      candidates.push(path.join(env.LOCALAPPDATA, "Programs", "Dropship Studio", "Dropship Data"));
    }
  }
  return candidates.find(candidate => exists(candidate)) || preferred;
}

module.exports = { dataDirectory };
