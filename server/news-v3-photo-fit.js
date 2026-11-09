// Editorial metadata is a conservative hint, not OCR or face detection.
// Never sacrifice a portrait or a known document just to fill the hero panel.
const DOCUMENT = /\b(?:screenshot|screen shot|chart|graph|infographic|ballot|document|newspaper|front page|poster|map|text card)\b|ảnh chụp màn hình|biểu đồ|phiếu bầu|văn bản|bản đồ/iu;

export function v3PhotoFit(image, { visualMode = 'photo', width = 1080, height = 720 } = {}) {
  const sourceWidth = Number(image.width), sourceHeight = Number(image.height);
  const known = Number.isFinite(sourceWidth) && Number.isFinite(sourceHeight) && sourceWidth > 0 && sourceHeight > 0;
  const aspect = known ? sourceWidth / sourceHeight : null, target = width / height;
  const crop = known ? 1 - Math.min(aspect / target, target / aspect) : null;
  const document = visualMode === 'source-card' || image.visualRole === 'source-card' ||
    image.preserveComposition === true || image.newsPhotoFit === 'contain' ||
    DOCUMENT.test([image.name, image.title, image.imageDescription, image.description, image.visualRole].filter(Boolean).join(' '));
  const fit = !document && known && aspect > 1 && crop <= .18 ? 'cover' : 'contain';
  return {
    fit, background: fit === 'cover' ? 'photo' : 'same-image-blur',
    fitReason: document ? 'protected-composition' : !known ? 'unknown-dimensions' : aspect <= 1 ? 'portrait-or-square' : fit === 'cover' ? 'bounded-landscape-crop' : 'excessive-crop',
    sourceWidth: known ? sourceWidth : null, sourceHeight: known ? sourceHeight : null,
    cropPercent: fit === 'cover' ? Math.round(crop * 10000) / 100 : 0,
  };
}
