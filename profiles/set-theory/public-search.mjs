import {publicTopicLabels} from './public-topics.mjs';
import {formatWebSources} from './response-format.mjs';
export function createPublicSearch(_runtime,{fetchFn=fetch}={}){
 const diagnostics={lookups:0,httpRequests:0,failedLookups:0,backend:'public-https-apis'};const cache=new Map();
 async function json(url,signal){
  if(!['en.wikipedia.org','api.crossref.org'].includes(url.hostname)||url.protocol!=='https:')throw new Error('SEARCH_ENDPOINT_DENIED');
  diagnostics.httpRequests++;
  const r=await fetchFn(url,{headers:{'user-agent':'SetTheoryQQAssistant/1.0','accept':'application/json'},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error('PUBLIC_SEARCH_HTTP_ERROR');
  const length=Number(r.headers.get('content-length')||0);if(length>2*1024*1024)throw new Error('PUBLIC_SEARCH_TOO_LARGE');
  const reader=r.body.getReader();const chunks=[];let bytes=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024)throw new Error('PUBLIC_SEARCH_TOO_LARGE');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 return {diagnostics,async lookup(topicIds,{signal}={}){
  // The API cannot receive a raw group question, context, account ID or textbook content.
  const labels=publicTopicLabels(topicIds);const key=topicIds.join('|');const cached=cache.get(key);
  if(cached&&Date.now()-cached.time<30*60000)return cached.value;
  const snippets=[];const sources=[];
  const responses=await Promise.allSettled(labels.slice(0,2).map(async label=>{
   const url=new URL('https://en.wikipedia.org/w/api.php');
   for(const [k,v] of Object.entries({action:'query',generator:'search',gsrsearch:label,gsrlimit:'2',prop:'extracts',exintro:'1',explaintext:'1',format:'json'}))url.searchParams.set(k,v);
   return json(url,signal);
  }));
  for(const response of responses)if(response.status==='fulfilled')for(const page of Object.values(response.value.query?.pages||{})){
   if(typeof page.title!=='string'||typeof page.extract!=='string'||!page.extract.trim())continue;
   const url='https://en.wikipedia.org/wiki/'+encodeURIComponent(page.title.replaceAll(' ','_'));
   sources.push({title:page.title,url});snippets.push({title:page.title,url,kind:'encyclopedia-introduction',text:page.extract.slice(0,2400)});
  }
  try{
   const url=new URL('https://api.crossref.org/works');url.searchParams.set('query.bibliographic',labels.join(' '));url.searchParams.set('rows','3');
   const data=await json(url,signal);
   for(const work of data.message?.items||[]){const title=work.title?.[0];if(!title||!/^10\.\d{4,9}\/\S+$/.test(work.DOI||''))continue;
    const link='https://doi.org/'+work.DOI;sources.push({title,url:link});snippets.push({title,url:link,kind:'bibliographic-metadata-only',text:String(work.abstract||'').replace(/<[^>]*>/g,' ').slice(0,1200),year:work.published?.['date-parts']?.[0]?.[0]});
   }
  }catch{}
  const unique=[...new Map(sources.map(s=>[s.url,s])).values()].slice(0,6);formatWebSources(unique);
  if(!unique.length){diagnostics.failedLookups++;throw new Error('NO_PUBLIC_SEARCH_RESULTS');}
  const value={publicTopics:labels,sources:unique,summary:JSON.stringify(snippets.filter(s=>unique.some(u=>u.url===s.url))),retrievedAt:new Date().toISOString()};
  diagnostics.lookups++;if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,{time:Date.now(),value});return value;
 }};
}