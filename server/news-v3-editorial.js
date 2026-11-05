import { cleanNewsText } from './news-render-common.js';

const short = (value, length) => { const text=cleanNewsText(value);return text.length>length?text.slice(0,length-1).trimEnd()+'…':text; };
function sourceName(value){
 const text=cleanNewsText(value).replace(/\s+-\s+Goo(?:gle(?: News.*)?)?$/i,'').replace(/\s+when:\d+[hdw]\b/gi,'').replace(/^["“]|["”]$/g,'');
 return text.includes(' - ')?text.split(' - ').at(-1).trim():text||'News report';
}
function dateLabel(value){
 if(!value)return'';const date=new Date(value);if(!Number.isFinite(date.getTime()))return'';
 return date.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).toUpperCase();
}

export function newsPhotoCaption(image,visualMode){
 let label;
 if(image.visualRole==='source-card'||visualMode==='source-card')label='SOURCE SUMMARY / NO EVENT PHOTO';
 else if(image.newsContextOnly===false)label='SOURCE IMAGE';
 else{
  const year=/\b(?:19|20)\d{2}\b/.exec(image.capturedAt||'')?.[0];
  label='FILE / CONTEXT PHOTO'+(year?' / '+year:'');
 }
 const credit=[cleanNewsText(image.attribution),cleanNewsText(image.license)].filter(Boolean).join(' / ')||'SOURCE IMAGE';
 return{label,credit:short(credit,70).toUpperCase(),fullCredit:credit,url:image.sourceUrl||'',licenseUrl:image.licenseUrl||'',capturedAt:image.capturedAt||'',description:cleanNewsText(image.imageDescription),name:cleanNewsText(image.name)};
}

export function newsV3Editorial(plan,captions,duration){
 const headline=cleanNewsText(plan.headline||'News update').toUpperCase();
 const narration=cleanNewsText(plan.narration);
 // Old saved scripts can omit the full stop before the appended CTA. Split
 // the explicit CTA at its own words, never at the start of the preceding fact.
 const ctaIndex=narration.search(/\b(?:Read|See|Find) (?:the )?full (?:story|report|article)\b/i);
 const hasCta=ctaIndex>=0&&/\bfirst comment\b/i.test(narration.slice(ctaIndex));
 const body=hasCta?narration.slice(0,ctaIndex).trim():narration;
 const sentences=[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(body)].map(s=>s.segment.trim()).filter(Boolean);
 if(hasCta)sentences.push(narration.slice(ctaIndex));
 const beats=[];let wordIndex=0;
 for(const [index,sentence]of sentences.entries()){
  const wordCount=sentence.split(/\s+/u).length;
  const start=index?captions.words?.[wordIndex]?.start??duration*wordIndex/Math.max(1,narration.split(' ').length):0;
  const cta=hasCta&&index===sentences.length-1;
  // Every alternate banner is copied from a complete sentence actually read.
  // A long sentence keeps the concise original headline rather than truncating a fact.
  const banner=cta?'FULL STORY IN THE FIRST COMMENT':index&&sentence.length<=95?sentence.toUpperCase():headline;
  beats.push({start:Math.max(0,Math.min(duration-.01,start)),title:cta?'FULL REPORT':index?'THE DETAILS':'TOP STORY',headline:banner});wordIndex+=wordCount;
 }
 if(!beats.length)beats.push({start:0,title:'TOP STORY',headline});
 for(let i=0;i<beats.length;i++)beats[i].end=beats[i+1]?.start??duration;
 return{brand:short(plan.brand||'NEWS UPDATE',24).toUpperCase(),edition:short(plan.category||'U.S. NEWS',24).toUpperCase(),dateline:cleanNewsText(plan.location).toUpperCase()||'NEWS BRIEF',source:'SOURCE: '+sourceName(plan.source).toUpperCase(),date:dateLabel(plan.reportDate),beats:beats.filter(b=>b.end>b.start)};
}
