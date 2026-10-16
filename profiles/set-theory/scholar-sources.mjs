import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {fetchPublic,plainHtml,publicQuery} from './public-fetch.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
const list=x=>x===undefined||x===null?[]:Array.isArray(x)?x:[x];
const text=x=>String(typeof x==='object'?x?.['#text']||'':x||'').replace(/\s+/g,' ').trim();
const clean=x=>plainHtml(text(x));
const parser=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,parseAttributeValue:false,processEntities:true});
export const defaultJournals=[
 {name:'The Journal of Symbolic Logic',issn:'0022-4812'},
 {name:'Annals of Pure and Applied Logic',issn:'0168-0072'},
 {name:'Annals of Mathematics',issn:'0003-486X'},
 {name:'Nature',issn:'1476-4687'}
];
export function parseScholarFeed(xml){
 if(Buffer.byteLength(xml)>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw Error('UNSAFE_SCHOLAR_XML');
 const data=parser.parse(xml),rows=list(data.feed?.entry||data.rss?.channel?.item);
 return rows.slice(0,100).flatMap(e=>{
  const raw=text(e.id)||list(e.link).map(l=>typeof l==='string'?l:l?.['@_href']).find(u=>/arxiv\.org\/abs\//.test(u||''))||'';
  const id=raw.match(/arxiv\.org\/abs\/([^?#\s]+)/)?.[1]||'';
  if(!/^(?:\d{4}\.\d{4,5}|[a-z][a-z.-]*\/\d{7})(?:v\d+)?$/i.test(id))return [];
  const base=id.replace(/v\d+$/,''),abstract=clean(e.summary||e.description),title=clean(e.title);
  if(!title)return [];
  return [{id:'arxiv:'+base,arxivId:id,doi:clean(e.doi)||null,title,abstract:abstract.slice(0,18000),authors:list(e.author).map(a=>clean(a.name||a)).slice(0,20),published:text(e.published||e.pubDate),updated:text(e.updated||e.published||e.pubDate),source:'arXiv',publicationKind:'preprint',journalReference:clean(e.journal_ref)||null,url:'https://arxiv.org/abs/'+id,htmlUrl:'https://arxiv.org/html/'+id,pdfUrl:'https://arxiv.org/pdf/'+id,categories:list(e.category).map(c=>c?.['@_term']||text(c)).filter(Boolean)}];
 });
}
export function normalizeCrossref(item,journal){
 const doi=text(item.DOI).toLowerCase();if(!/^10\.\d{4,9}\/\S+$/.test(doi)||doi.length>300)return null;
 const title=clean(item.title?.[0]);if(!title)return null;
 const parts=(item['published-online']||item['published-print']||item.published)?.['date-parts']?.[0]||[];
 const date=parts.length?parts.map((n,i)=>i?String(n).padStart(2,'0'):n).join('-'):'';
 return {id:'doi:'+doi,doi,title,abstract:clean(item.abstract).slice(0,18000),authors:(item.author||[]).slice(0,20).map(a=>clean([a.given,a.family].filter(Boolean).join(' '))),published:date,source:journal.name,publicationKind:'journal-article',url:'https://doi.org/'+doi,categories:[],links:(item.link||[]).slice(0,4).flatMap(l=>{try{const u=new URL(l.URL);return u.protocol==='https:'&&!u.username&&!u.password?[{url:u.href,contentType:l['content-type']||'',intendedApplication:l['intended-application']||''}]:[];}catch{return [];}})};
}
export function scholarlyKey(item){return item.doi?'doi:'+item.doi.toLowerCase():item.id;}
export function createScholarSources({fetchFn=fetchPublic,now=Date.now,sleep=delay,minIntervalMs=3100}={}){
 let tail=Promise.resolve(),lastRequest=0;const cache=new Map(),blocked=new Map(),diagnostics={requests:0,cacheHits:0,sources:[]};
 async function request(url,{signal,maxBytes=2*1024*1024}={}){
  const u=new URL(url),host=u.hostname;if(!['export.arxiv.org','rss.arxiv.org','api.crossref.org'].includes(host))throw Error('SCHOLAR_API_ORIGIN_DENIED');
  if((blocked.get(host)||0)>now())throw Error('SCHOLAR_SOURCE_BACKOFF');
  const task=tail.then(async()=>{signal?.throwIfAborted();const wait=minIntervalMs-(now()-lastRequest);if(wait>0)await sleep(wait,undefined,{signal});lastRequest=now();diagnostics.requests++;try{return await fetchFn(u,{signal,maxBytes,timeoutMs:25000,headers:{'user-agent':'QQAssistantCore/0.2 (+https://github.com/EgoFakeFantasy/qq-assistant-core)','accept':'application/atom+xml, application/json, application/rss+xml'}});}catch(e){if(/HTTP_(?:403|429|503)/.test(e.message))blocked.set(host,now()+1800000);throw e;}});
  tail=task.catch(()=>{});return task;
 }
 async function cached(url,options){
  const key=String(url),old=cache.get(key);if(old&&now()-old.at<3600000){diagnostics.cacheHits++;return old.result;}
  const result=await request(url,options);cache.set(key,{at:now(),result});if(cache.size>32)cache.delete(cache.keys().next().value);return result;
 }
 return {diagnostics,async discover({categories=['math.LO','math.CO','math.CT','cs.LO'],journals=defaultJournals,query='',cursor=0,lookbackDays=90},{signal}={}){
  if(!Array.isArray(categories)||!categories.length||categories.length>8||categories.some(c=>!/^[a-z]+\.[A-Z]{2}$/.test(c)))throw Error('SCHOLAR_CATEGORIES_INVALID');
  if(!Array.isArray(journals)||journals.length>12||journals.some(j=>!/^\d{4}-\d{3}[\dX]$/.test(j.issn)||typeof j.name!=='string'||j.name.length>150))throw Error('SCHOLAR_JOURNALS_INVALID');
  if(query)publicQuery(query);
  const candidates=[],states=[],category=categories[cursor%categories.length],url=new URL('https://export.arxiv.org/api/query');
  url.search=new URLSearchParams({search_query:'cat:'+category+(query?' AND all:"'+query.replace(/["\\]/g,' ')+'"':''),start:'0',max_results:'12',sortBy:'submittedDate',sortOrder:'descending'}).toString();
  try{const r=await cached(url,{signal});candidates.push(...parseScholarFeed(r.bytes.toString('utf8')));states.push({source:'arXiv',ok:true,category});}
  catch(e){
   signal?.throwIfAborted();states.push({source:'arXiv API',ok:false,reason:/^[A-Z_0-9]+$/.test(e.message)?e.message:'SOURCE_UNAVAILABLE'});
   // RSS is a separate official delivery service. Do not evade platform backoff.
   if(!/BACKOFF|HTTP_(?:403|429|503)/.test(e.message))try{const r=await cached('https://rss.arxiv.org/rss/'+category,{signal});candidates.push(...parseScholarFeed(r.bytes.toString('utf8')));states.push({source:'arXiv RSS',ok:true,category});}catch{signal?.throwIfAborted();}
  }
  const from=new Date(now()-Math.min(365,Math.max(1,lookbackDays))*86400000).toISOString().slice(0,10),until=new Date(now()).toISOString().slice(0,10);
  for(let i=0;i<Math.min(2,journals.length);i++){
   const j=journals[(cursor*2+i)%journals.length],u=new URL('https://api.crossref.org/journals/'+j.issn+'/works');
   u.search=new URLSearchParams({filter:'type:journal-article,from-pub-date:'+from+',until-pub-date:'+until,rows:'8',sort:'published',order:'desc'}).toString();
   try{const r=await cached(u,{signal}),data=JSON.parse(r.bytes.toString('utf8'));candidates.push(...(data.message?.items||[]).map(x=>normalizeCrossref(x,j)).filter(Boolean));states.push({source:j.name,ok:true});}
   catch(e){signal?.throwIfAborted();states.push({source:j.name,ok:false,reason:/^[A-Z_0-9]+$/.test(e.message)?e.message:'SOURCE_UNAVAILABLE'});}
  }
  diagnostics.sources=states;
  return {candidates:[...new Map(candidates.map(p=>[scholarlyKey(p),p])).values()].slice(0,32),sources:states};
 },async findArxiv(paper,{signal}={}){
  const u=new URL('https://export.arxiv.org/api/query');
  u.search=new URLSearchParams({search_query:paper.doi?'doi:"'+paper.doi.replace(/["\\]/g,'')+'"':'ti:"'+paper.title.replace(/["\\]/g,'').slice(0,160)+'"',max_results:'3'}).toString();
  const r=await cached(u,{signal});return parseScholarFeed(r.bytes.toString('utf8')).find(p=>paper.doi&&p.doi?.toLowerCase()===paper.doi.toLowerCase()||p.title.toLowerCase().replace(/\W/g,'')===paper.title.toLowerCase().replace(/\W/g,'') )||null;
 }};
}
export const scholarFingerprint=p=>createHash('sha256').update(p.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')).digest('hex');
