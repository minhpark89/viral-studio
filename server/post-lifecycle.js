import { StudioError } from './store.js';
export { cleanupPublishedMedia, publishedMediaLineage } from './published-media.js';

export function publishedVideo(store, post) {
  return post.publication?.externalPostId || store.state.settings?.meta?.publications?.find(p=>p.postId===post.id && p.externalPostId)?.externalPostId || (post.status==='published' ? 'published' : '');
}

export function returnPostToWarehouse(store, post, {automatic=false, at=new Date().toISOString()}={}) {
  if (publishedVideo(store,post)) throw new StudioError('Video đã đăng. Chỉ tiếp tục bình luận trên video cũ, không trả về kho để đăng lại.','ALREADY_PUBLISHED',409);
  const page=store.state.socialPages?.find(p=>p.id===post.pageId);
  const previous=post.warehouse || {};
  const error=post.automationError || previous.error || post.lastDeliveryError || '';
  Object.assign(post,{
    warehouse:{...previous,returnedAt:at,automatic,previousPageId:post.pageId || previous.previousPageId || '',previousPageName:post.pageId?(page?.name || ''):(previous.previousPageName || ''),previousExternalPageId:post.pageId?String(page?.externalId || ''):String(previous.previousExternalPageId || ''),previousGroupId:post.pageGroupId || previous.previousGroupId || '',error,errorDetails:post.automationErrorDetails || previous.errorDetails || null,attempts:Number(post.automationAttempts || previous.attempts || 0)},
    pageId:'',pageGroupId:'',tokenGroupId:'',status:'draft',automationHold:true,scheduledAt:null,
    automationStatus:'warehouse',automationError:null,automationErrorDetails:post.automationErrorDetails || previous.errorDetails || null,automationRetryBlocked:true,
    automationBlockedReason:post.automationBlockedReason || 'warehouse_review',automationNextAttemptAt:null,
    lastDeliveryError:error || null,revision:Number(post.revision || 1)+1,updatedAt:at,
  });
  return post;
}
