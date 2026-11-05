import {writeFile,unlink,realpath,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {fetchPublic,plainHtml} from './public-fetch.mjs';
const run=promisify(execFile),script=fileURLToPath(new URL('./scholar-document.py',import.meta.url));
const safeURL=value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('PUBLIC_PAPER_URL_REQUIRED');return u;};
export function pageRanges(numbers){
 const ranges=[];for(const n of [...new Set(numbers)].sort((a,b)=>a-b)){const last=ranges.at(-1);if(last&&n===last[1]+1)last[1]=n;else ranges.push([n,n]);}return ranges;
}
export function validateScholarEvidence(review,evidence){
 if(!Array.isArray(review.evidence)||review.evidence.length>5||review.evidence.some(e=>typeof e.quote!=='string'||e.quote.length<12||e.quote.length>350||!evidence.blocks.some(b=>b.id===e.blockId&&b.text.includes(e.quote))))throw Error('SCHOLAR_EVIDENCE_MISMATCH');
 if(review.share&&(!review.evidence.length||evidence.blocks.reduce((n,b)=>n+b.text.length,0)<250))throw Error('SCHOLAR_INSUFFICIENT_READING');
 if(evidence.coverage==='partial-body'&&review.claimScope!=='provided-excerpts')throw Error('SCHOLAR_READING_SCOPE_REQUIRED');
 if(evidence.coverage==='partial-body'&&/(?:我|我们|本次)(?:已经|已)?(?:通读(?:了)?全文|完整阅读(?:了)?(?:全文|论文)|检查(?:了)?全部证明)|\b(?:we|I) (?:have )?(?:read the entire paper|verified all proofs)\b/i.test(String(review.summary||'')+' '+String(review.shareText||'')))throw Error('SCHOLAR_SCOPE_OVERCLAIM');
 if(evidence.pageCount){
  const read=new Set(evidence.blocks.filter(b=>/^page-\d+$/.test(b.id)).map(b=>Number(b.id.slice(5))));
  const text=String(review.summary||'')+'\n'+String(review.shareText||'');
  for(const m of text.matchAll(/(?:第\s*|\b(?:pages?|p\.)\s*)(\d+)(?:\s*[-–—至]\s*(\d+))?\s*(?:页|\b)/gi)){
   const start=Number(m[1]),end=Number(m[2]||m[1]);if(end<start||end-start>1000)throw Error('SCHOLAR_UNREAD_PAGE_CITATION');
   for(let page=start;page<=end;page++)if(!read.has(page))throw Error('SCHOLAR_UNREAD_PAGE_CITATION');
  }
 }
 return true;
}
export function createScholarReader({sources,pythonPath,pythonLibraries,fetchFn=fetchPublic,runProcess=run}={}){
 return {async read(paper,workspace,{signal}={}){
  workspace=resolve(workspace);if(resolve(await realpath(workspace))!==workspace)throw Error('LINKED_PAPER_WORKSPACE');
  let preprint=paper.arxivId?paper:null;
  if(!preprint&&sources?.findArxiv)try{preprint=await sources.findArxiv(paper,{signal});}catch{signal?.throwIfAborted();}
  const blocks=[];let scope='abstract',totalCharacters=0,pageCount=null,truncated=false,readFrom=paper.url;
  let readRanges=[],missingRanges=[],truncatedPages=[];
  const attempts=[];
  const abstract=String(paper.abstract||preprint?.abstract||'');if(abstract)blocks.push({id:'abstract',label:'摘要',text:abstract.slice(0,18000)});
  const htmlLinks=[preprint?.htmlUrl,paper.htmlUrl,...(paper.links||[]).filter(l=>/html/i.test(l.contentType||'')).map(l=>l.url),...(!paper.arxivId?[paper.url]:[])];
  for(const url of [...new Set(htmlLinks.filter(Boolean))].slice(0,2)){
   try{
    const r=await fetchFn(safeURL(url),{signal,maxBytes:6*1024*1024,timeoutMs:25000});
    const html=r.bytes.toString('utf8');
    if(/captcha|access denied|verify you are human|purchase access|sign in to (?:read|access)/i.test(html.slice(0,6000)))throw Error('PAPER_HTML_UNAVAILABLE');
    const body=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]||html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
    // Landing pages and standalone abstracts are not a body-reading result.
    if(body&&/class=["'][^"']*abstract|id=["']abstract/i.test(body)&&!/>\s*(?:\d+[.\s]*)?(?:Introduction|Methods|Proof|Results|Discussion|References)\b/i.test(body))throw Error('PAPER_HTML_UNAVAILABLE');
    if(!body||!/<section\b|<h[2-4]\b|class=["'][^"']*(?:article-body|ltx_section|fulltext)/i.test(body))throw Error('PAPER_HTML_UNAVAILABLE');
    const parts=body.split(/(?=<section\b|<h[2-4]\b)/i).map(plainHtml).filter(p=>p.length>100);
    let used=0,total=0,cut=false;const sections=[];
    for(let i=0;i<parts.length;i++){total+=parts[i].length;const t=parts[i].slice(0,Math.max(0,60000-used));if(t){used+=t.length;sections.push({id:'section-'+(i+1),label:'HTML段 '+(i+1),text:t});}if(t.length<parts[i].length)cut=true;}
    if(used<=800)throw Error('PAPER_HTML_UNAVAILABLE');
    blocks.push(...sections);scope='html-body';readFrom=url;totalCharacters=total;truncated=cut;break;
   }catch{signal?.throwIfAborted();attempts.push({kind:'html',outcome:'unavailable'});}
  }
  if(scope==='abstract'&&pythonPath){
   const pdfLinks=[...(preprint?.pdfUrl?[{url:preprint.pdfUrl}]:[]),...(paper.links||[]).filter(l=>/pdf/i.test(l.contentType||'')).sort((a,b)=>Number(b.intendedApplication==='text-mining')-Number(a.intendedApplication==='text-mining')),...(paper.pdfUrl?[{url:paper.pdfUrl}]:[])];
   const options=[...new Map(pdfLinks.map(l=>[l.url,l])).values()].slice(0,3);
   for(const link of options){
    const file=join(workspace,'paper-'+randomUUID()+'.pdf');let created=false;
    try{
     const r=await fetchFn(safeURL(link.url),{signal,maxBytes:24*1024*1024,timeoutMs:60000});
     if(r.bytes.subarray(0,5).toString()!=='%PDF-')throw Error('PAPER_PDF_SIGNATURE');
     await writeFile(file,r.bytes,{flag:'wx',mode:0o600});created=true;
     const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw Error('UNSAFE_PAPER_FILE');
     const result=await runProcess(pythonPath,[script,file],{signal,timeout:90000,maxBuffer:6*1024*1024,windowsHide:true,env:{...process.env,...(pythonLibraries?{PYTHONPATH:pythonLibraries}:{})}});
     const parsed=JSON.parse(result.stdout);
     if(!Number.isSafeInteger(parsed.pageCount)||parsed.pageCount<1||parsed.pageCount>10000||!Array.isArray(parsed.pages)||parsed.pages.length>36||new Set(parsed.pages.map(p=>p.page)).size!==parsed.pages.length||parsed.pages.some(p=>!Number.isInteger(p.page)||p.page<1||p.page>parsed.pageCount||typeof p.text!=='string'||p.text.length>20000))throw Error('INVALID_PAPER_EXTRACTION');
     let used=0,total=0;const pages=[],cuts=[];
     for(const p of parsed.pages){total+=p.text.length;const t=p.text.slice(0,Math.max(0,60000-used));if(t){pages.push({id:'page-'+p.page,label:'PDF第'+p.page+'页',page:p.page,text:t});used+=t.length;}if(t.length<p.text.length||p.truncated===true)cuts.push(p.page);}
     if(used<=800)throw Error('PAPER_PDF_UNREADABLE');
     pageCount=parsed.pageCount;const read=new Set(pages.map(p=>p.page));
     readRanges=pageRanges([...read]);missingRanges=pageRanges(Array.from({length:pageCount},(_,i)=>i+1).filter(n=>!read.has(n)));truncatedPages=cuts;
     blocks.push(...pages);scope='pdf-body';readFrom=link.url;totalCharacters=total;truncated=missingRanges.length>0||cuts.length>0;break;
    }catch{signal?.throwIfAborted();attempts.push({kind:'pdf',outcome:'unavailable'});}
    finally{if(created)await unlink(file).catch(()=>{});}
   }
  }
  return {paper,blocks,scope,coverage:scope==='abstract'?'abstract-only':truncated?'partial-body':'provided-body',readFrom,pageCount,truncated,readRanges,missingRanges,truncatedPages,totalCharacters,attempts,preprintUrl:preprint?.url||null,workspace};
 }};
}
