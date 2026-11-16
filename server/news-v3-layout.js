// V4 is the approved broadcast layout. Explicit V3 jobs retain their original
// geometry; the review alias remains available for reproducing the approved clip.
const text = (x, y, options = {}) => ({ x, y, ...options });
const rect = (x, y, w, h) => ({ x, y, w, h });

const legacy = {
  id: 'v3', hero: rect(0, 272, 1080, 720), presenter: rect(64, 1064, 240, 300),
  brandRule: rect(64, 124, 8, 58), brand: text(92, 126, { size: 46, min: 32, width: 430 }),
  editionTab: rect(696, 126, 248, 48), edition: text(716, 137, { size: 28, min: 23, width: 208 }),
  brandDivider: rect(64, 202, 880, 2), dateline: text(64, 220, { size: 30, min: 24, width: 880 }),
  photoLabel: text(64, 1012, { size: 24, min: 22, width: 526 }),
  photoCredit: text(610, 1000, { size: 20, min: 16, width: 334, lines: 2, lineSpacing: 4 }),
  photoRule: rect(64, 1046, 880, 2), nameplate: rect(64, 1326, 240, 38),
  presenterLabel: text(78, 1335, { size: 25, min: 22, width: 212 }),
  section: text(338, 1072, { size: 30, min: 26, width: 606 }),
  headline: text(338, 1124, { font: 'headline', size: 64, min: 36, width: 606, lines: 4, height: 268 }),
  captionPanel: rect(64, 1408, 880, 132), caption: text(90, 1428, { size: 47, min: 34, width: 826, lines: 2 }),
  source: text(64, 1566, { size: 24, min: 20, width: 650, lines: 2, lineSpacing: 4 }),
  date: text(756, 1566, { size: 28, min: 24, width: 188 }), bottomRule: rect(64, 1620, 880, 3),
};

const broadcast = {
  id: 'v4', hero: rect(0, 224, 1080, 1040), presenter: rect(48, 1344, 208, 260),
  brandRule: rect(48, 110, 7, 48), brand: text(76, 110, { size: 44, min: 32, width: 430 }),
  editionTab: rect(744, 110, 248, 46), edition: text(762, 120, { size: 27, min: 22, width: 212 }),
  brandDivider: rect(48, 172, 944, 2), dateline: text(48, 186, { size: 27, min: 22, width: 944, height: 38 }),
  photoLabel: text(48, 1282, { size: 22, min: 20, width: 520, height: 38 }),
  photoCredit: text(600, 1276, { size: 18, min: 15, width: 392, lines: 2, lineSpacing: 2, height: 46 }),
  photoRule: rect(48, 1326, 944, 2), nameplate: rect(48, 1566, 208, 38),
  presenterLabel: text(60, 1575, { size: 24, min: 21, width: 184 }),
  section: text(288, 1348, { size: 28, min: 24, width: 704, height: 42 }),
  headline: text(288, 1394, { font: 'headline', size: 62, min: 34, width: 704, lines: 3, height: 210, lineSpacing: 6 }),
  captionPanel: rect(48, 1624, 944, 126), caption: text(72, 1642, { size: 44, min: 32, width: 896, lines: 2, height: 100, lineSpacing: 6 }),
  source: text(48, 1774, { size: 22, min: 18, width: 690, lines: 2, lineSpacing: 3, height: 50 }),
  date: text(800, 1774, { size: 26, min: 22, width: 192, height: 45 }), bottomRule: rect(48, 1830, 944, 2),
};

export function newsV3Layout(preset = 'v3') {
  if (!['v3', 'v4', 'broadcast-preview'].includes(preset)) throw new Error('Unknown news layout preset');
  return structuredClone(preset === 'v3' ? legacy : broadcast);
}
