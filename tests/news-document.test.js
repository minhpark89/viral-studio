import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNewsDocument } from '../server/news-source.js';
import { articleImagesFromHtml } from '../server/news-visuals.js';
import { newsArticleIdentity } from '../server/news-document.js';

test('legacy article classes retain nested paragraphs and exclude surrounding news, share forms and ads',()=>{
  const html=`<div class="ticker"><p>Unrelated breaking news</p></div>
    <div class="full_news"><h1>Roundup heading</h1><ol class="share_ic"><li><h1>Email this news</h1><div>Private form</div></li></ol>
    <ul class="news_des"><li class="l_ad">Advertisement</li><li class="f_news">
      <p>Verified opening.</p><div><p>Nested source paragraph.</p><div class="related"><p>Different story.</p></div><p>Nested closing.</p></div>
      <p>Final source paragraph.</p><div class="adsbygoogle"><div>Hidden advertisement</div></div>
      <script>Injected script.</script><iframe>Embedded site.</iframe>
    </li></ul><div class="share_icon">Follow us</div></div><footer>Contact</footer>`;
  const result=parseNewsDocument(html,{url:'https://publisher.example/full-news.php?id=7'});
  assert.equal(result.text,'Verified opening. Nested source paragraph. Nested closing. Final source paragraph.');
});

test('articleBody and entry-content scopes support galleries without selecting recommendation cards',()=>{
  const text='Avery Chen opened the river bridge after engineers completed the inspection. '.repeat(4);
  for(const attrs of ['itemprop="articleBody"','class="entry-content"']){
    const html=`<main><article class="related">${'Wrong related article. '.repeat(50)}</article><div ${attrs}><p>${text}</p><figure><img src="/bridge.jpg" alt="The river bridge"></figure><aside><figure><img src="/wrong.jpg" alt="Unrelated"></figure></aside></div></main>`;
    const result=parseNewsDocument(html,{url:'https://publisher.example/story'});
    assert.equal(result.text,text.trim());assert.equal(result.sourceRead.status,'full');
    assert.deepEqual(result.sourceImages.map(x=>x.imageUrl),['https://publisher.example/bridge.jpg']);
  }
});

test('query-string story IDs prevent another article body and image from being attributed to this source',()=>{
  const html=`<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',url:'https://publisher.example/full-news.php?id=8',articleBody:'Unrelated article '.repeat(40),image:'/wrong.jpg'})}</script>
    <div class="article-body"><p>This is the correct article.</p><figure><img src="/correct.jpg" alt="Correct subject"></figure></div>`;
  const article={url:'https://publisher.example/full-news.php?id=7'};
  assert.equal(parseNewsDocument(html,article).text,'This is the correct article.');
  assert.deepEqual(articleImagesFromHtml(html,article).map(x=>x.imageUrl),['https://publisher.example/correct.jpg']);
  assert.equal(newsArticleIdentity('https://publisher.example/story/?b=2&utm_source=feed&a=1#top'),newsArticleIdentity('https://publisher.example/story?a=1&b=2'));
});

test('an unmarked page remains a summary instead of importing navigation as reporting',()=>{
  const source=parseNewsDocument('<meta name="description" content="Source summary"><div>'+('Unrelated homepage links. '.repeat(100))+'</div>',{url:'https://publisher.example/story'});
  assert.equal(source.sourceRead.status,'summary');assert.equal(source.text,'');assert.equal(source.summary,'Source summary');
});
