import test from 'node:test';
import assert from 'node:assert/strict';
import {postRows} from '../server/management.js';
import {returnPostToWarehouse} from '../server/post-lifecycle.js';

function fixture(){
 const page={id:'local-a',externalId:'123456',name:'Page lỗi'};
 const post={id:'post-a',pageId:page.id,title:'News',status:'draft',caption:'Caption',firstComment:'Link',mediaIds:['video'],automationError:'Identity required'};
 return {page,post,store:{state:{socialPages:[page],socialPosts:[post],projects:[],settings:{meta:{pages:[{id:page.externalId,name:page.name}],pageGroups:[],publications:[]}}}}};
}
test('legacy warehouse error resolves its original Page without assigning or mutating the post',()=>{
 const {page,post,store}=fixture();post.pageId='';post.warehouse={returnedAt:'2026-10-30',previousPageId:page.id,previousPageName:page.name,error:'Identity required'};
 const before=JSON.stringify(store.state),row=postRows(store)[0];
 assert.deepEqual(row.pageReference,{kind:'previous',name:page.name,externalId:'123456',url:'https://www.facebook.com/123456'});assert.equal(row.externalPageId,'');assert.equal(row.stage,'warehouse');assert.equal(JSON.stringify(store.state),before);
});
test('warehouse snapshots preserve the external Page ID after local Page removal and repeated returns',()=>{
 const {post,store}=fixture();returnPostToWarehouse(store,post);store.state.socialPages=[];returnPostToWarehouse(store,post);
 assert.equal(post.warehouse.previousExternalPageId,'123456');assert.equal(postRows(store)[0].pageReference.url,'https://www.facebook.com/123456');assert.equal(post.pageId,'');
});
test('a new assigned Page is distinguished from the previous failed Page',()=>{
 const {post,store}=fixture();returnPostToWarehouse(store,post);store.state.socialPages.push({id:'local-b',externalId:'654321',name:'New Page'});post.pageId='local-b';
 assert.equal(postRows(store)[0].pageReference.kind,'current');assert.equal(postRows(store)[0].pageReference.externalId,'654321');returnPostToWarehouse(store,post);assert.equal(post.warehouse.previousExternalPageId,'654321');
});
test('an unresolved legacy Page retains its name without inventing a Facebook URL',()=>{
 const {post,store}=fixture();post.pageId='';post.warehouse={previousPageId:'removed-local-id',previousPageName:'Old Page',returnedAt:'2026-10-30'};
 assert.deepEqual(postRows(store)[0].pageReference,{kind:'previous',name:'Old Page',externalId:'',url:''});
});
test('malformed IDs cannot become external links',()=>{
 const {post,store}=fixture();post.pageId='';post.warehouse={previousExternalPageId:'javascript:alert(1)',previousPageName:'Old',returnedAt:'2026-10-30'};
 assert.equal(postRows(store)[0].pageReference.url,'');
});
test('published history and drafts keep their existing stages and references',()=>{
 const {post,store}=fixture();post.automationError=null;store.state.settings.meta.publications.push({idempotencyKey:'pub',postId:'old',pageId:'123456',externalPostId:'reel',status:'published'});
 const rows=postRows(store);assert.equal(rows[0].stage,'draft');assert.equal(rows[1].stage,'published');assert.equal(rows[1].pageReference.url,'https://www.facebook.com/123456');
});
