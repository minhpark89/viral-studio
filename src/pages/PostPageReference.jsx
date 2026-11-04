import { ExternalLink } from 'lucide-react';

export function PostPageReference({ post, detailed = false }) {
  const reference = post.pageReference;
  if (!reference) return <strong>{post.warehouse ? 'Trong kho · chưa gắn Page' : 'Chưa gắn Page'}</strong>;
  const previous = reference.kind === 'previous';
  return <div className={`mg-post-page-reference${detailed ? ' is-detail' : ''}`}>
    <small>{previous ? (post.error ? 'Page lúc gặp lỗi' : 'Page trước khi trả kho') : 'Page hiện tại'}</small>
    <strong>{reference.name || reference.externalId}</strong>
    {reference.externalId && <small>Page ID: {reference.externalId}</small>}
    {reference.url ? <a href={reference.url} target="_blank" rel="noopener noreferrer" aria-label={`Mở Page ${reference.name || reference.externalId} trên Facebook`}>Mở Page <ExternalLink size={13}/></a> : <small>Chưa có Page ID để mở Facebook.</small>}
    {previous && <small>Bài đã trả về kho, chưa gắn Page mới.</small>}
  </div>;
}
