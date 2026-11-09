// Keep product captions inside a portrait frame. News typography is unchanged.
export function productOverlayText(value, columns = 34) {
  const words = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .flatMap((word) => word.match(new RegExp(`.{1,${columns}}`, "gu")) || []);
  const lines = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last && last.length + word.length + 1 <= columns)
      lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return lines.join("\n");
}
