import {writeFile,unlink,realpath,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {fetchPublic,plainHtml} from './public-fetch.mjs';
const run=promisify(execFile),script=fileURLToPath(new URL('./scholar-document.py',import.meta.url));
const safeURL=value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('PUBLIC_PAPER_URL_REQUIRED');return u;};
export function validateScholarEvidence(review,evidence){
 if(!Array.isArray(review.evidence)||review.evidence.length>5||review.evidence.some(e=>typeof e.quote!=='string'||e.quote.length<12||e.quote.length>350||!evidence.blocks.some(b=>b.id===e.blockId&&b.text.includes(e.quote))))throw Error('SCHOLAR_EVIDENCE_MISMATCH');
 if(review.share&&(!review.evidence.length||evidence.blocks.reduce((n,b)=>n+b.text.length,0)<250))throw Error('SCHOLAR_INSUFFICIENT_READING');
 return true;
}
export function createScholarReader({sources,pythonPath,pythonLibraries,fetchFn=fetchPublic,runProcess=run}={}){
 return {async read(paper,workspace,{signal}={}){
  workspace=resolve(workspace);if(resolve(await realpath(workspace))!==workspace)throw Error('LINKED_PAPER_WORKSPACE');
  let preprint=paper.arxivId?paper:null;
  if(!preprint&&sources?.findArxiv)try{preprint=await sources.findArxiv(paper,{signal});}catch{signal?.throwIfAborted();}
  const blocks=[];let scope='abstract',totalCharacters=0,pageCount=null,truncated=false,readFrom=paper.url;
  const abstract=String(paper.abstract||preprint?.abstract||'');if(abstract)blocks.push({id:'abstract',label:'摘要',text:abstract.slice(0,18000)});
  if(preprint){
   try{
    const r=await fetchFn(safeURL(preprint.htmlUrl),{signal,maxBytes:6*1024*1024,timeoutMs:25000});
    const html=r.bytes.toString('utf8');if(!/<(?:article|section)\b/i.test(html)||/captcha|access denied|verify you are human/i.test(html.slice(0,3000)))throw Error('PAPER_HTML_UNAVAILABLE');
    const body=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]||html;
    const parts=body.split(/(?=<section\b)/i).map(plainHtml).filter(p=>p.length>100);
    let used=0;for(let i=0;i<parts.length;i++){totalCharacters+=parts[i].length;const remaining=60000-used;if(remaining<=0){truncated=true;continue;}const t=parts[i].slice(0,remaining);used+=t.length;blocks.push({id:'section-'+(i+1),label:'HTML段 '+(i+1),text:t});if(t.length<parts[i].length)truncated=true;}
    if(used>800){scope='html-body';readFrom=preprint.htmlUrl;}else throw Error('PAPER_HTML_UNAVAILABLE');
   }catch{signal?.throwIfAborted();}
  }
  if(scope==='abstract'&&pythonPath){
   const options=preprint?[{url:preprint.pdfUrl}]:paper.links?.filter(l=>/pdf/i.test(l.contentType)&&l.intendedApplication!=='text-mining').slice(0,1)||[];
   for(const link of options){
    const file=join(workspace,'paper.pdf');
    try{
     const r=await fetchFn(safeURL(link.url),{signal,maxBytes:24*1024*1024,timeoutMs:60000});
     if(r.bytes.subarray(0,5).toString()!=='%PDF-')throw Error('PAPER_PDF_SIGNATURE');
     await writeFile(file,r.bytes,{flag:'wx',mode:0o600});const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw Error('UNSAFE_PAPER_FILE');
     const result=await runProcess(pythonPath,[script,file],{signal,timeout:90000,maxBuffer:3*1024*1024,windowsHide:true,env:{...process.env,...(pythonLibraries?{PYTHONPATH:pythonLibraries}:{})}});
     const parsed=JSON.parse(result.stdout);pageCount=parsed.pageCount;
     let used=0;const pages=[];
     for(const p of parsed.pages||[]){totalCharacters+=p.text.length;const t=p.text.slice(0,Math.max(0,60000-used));if(t){pages.push({id:'page-'+p.page,label:'PDF第'+p.page+'页',text:t});used+=t.length;}if(t.length<p.text.length)truncated=true;}
     if(used>800){blocks.splice(1);blocks.push(...pages);scope='pdf-body';readFrom=link.url;truncated ||= pages.length<pageCount;}
    }catch{signal?.throwIfAborted();}finally{await unlink(file).catch(()=>{});}
    if(scope!=='abstract')break;
   }
  }
  // If no permitted full text is available, the model receives the abstract only.
  return {paper,blocks,scope,readFrom,pageCount,truncated,totalCharacters,preprintUrl:preprint?.url||null,workspace};
 }};
}
