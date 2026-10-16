import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createKnowledgeBase,parseChapterNumber} from './knowledge.mjs';
const run=promisify(execFile);
export async function loadTextbooks({corpusRoot,indexPath,pythonPath,pythonLibraries}){
 const root=resolve(corpusRoot);
 const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
 const index=JSON.parse(await readFile(indexPath,'utf8'));
 for(const b of manifest.books)if(!/^[a-f0-9]{64}$/.test(b.bookId)||b.file!==b.bookId+'.pdf'||!Number.isSafeInteger(b.pages))throw new Error('INVALID_CORPUS_MANIFEST');
 const complete=createKnowledgeBase(index);
 const normalizeName=s=>String(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
 function bookFor(name){
  const normalized=normalizeName(name);
  const exact=manifest.books.flatMap(b=>[...(b.sourceNames||[]),...(b.aliases||[])].filter(a=>normalizeName(a).length>=4&&normalized.includes(normalizeName(a))).map(a=>({book:b,length:normalizeName(a).length}))).sort((a,b)=>b.length-a.length);
  if(exact.length)return exact[0].book;
  if(/公理集合论导引|公理集合論導引/.test(name))return manifest.books.find(b=>b.title.includes('公理集合论导引'));
  if(/冯琦|導引|导引/.test(name)){
   const volume=/(?:第\s*)?(?:三|3)\s*[卷册]/.test(name)?'第三卷':/(?:第\s*)?(?:二|2)\s*[卷册]/.test(name)?'第二卷':/(?:第\s*)?(?:一|1)\s*[卷册]/.test(name)?'第一卷':null;return volume?manifest.books.find(b=>b.title.includes('冯琦')&&b.title.includes(volume)):undefined;
  }
  if(/higher\s*infinite|kanamori/i.test(name))return manifest.books.find(b=>/higher\s*infinite|kanamori/i.test(b.title));
  if(/高阶无穷/.test(name))return manifest.books.find(b=>b.title.includes('第三卷'));
  if(/Jech/i.test(name))return manifest.books.find(b=>b.title.includes(/中文|译本/.test(name)?'中译本':'(English)')&&/Jech/i.test(b.title));
  return undefined;
 }
 function readPage(bookId,page){const b=manifest.books.find(b=>b.bookId===bookId);if(!b||!Number.isInteger(page)||page<1||page>b.pages)return null;
  return complete.readPage(bookId,page)||{citation:`${bookId.slice(0,12)}:p${page}`,bookId,title:b.title,pdfPage:page,printedPage:null,text:'本页以原页图像提供。',sourceType:'image',truncated:false};}
 function search(query,options={}){
  const command=String(query).match(/\/(?:读书|读文件|read)\s+(.+?)\s+(?:第\s*)?(\d+)(?:\s*[-—至]\s*(\d+))?\s*页?/i);
  if(command){const b=bookFor(command[1]);if(!b)return[];const begin=Number(command[2]),end=Math.min(Number(command[3]||begin),begin+1);return Array.from({length:Math.max(0,end-begin+1)},(_,i)=>readPage(b.bookId,begin+i)).filter(Boolean);}
  const requested=bookFor(String(query));
  if(/higher\s*infinite|kanamori/i.test(query)&&!requested)return[];
  const chapter=options.chapter||parseChapterNumber(query);
  const bookIds=options.bookIds|| (requested?[requested.bookId]:/冯琦|集合论导引|集合論導引/.test(query)?manifest.books.filter(b=>b.title.includes('冯琦')).map(b=>b.bookId):/中文|中译本/.test(query)?manifest.books.filter(b=>b.language==='zh'||!b.title.includes('(English)')).map(b=>b.bookId):undefined);
  let contentQuery=String(query);if(requested)for(const alias of [...(requested.sourceNames||[]),...(requested.aliases||[])]){contentQuery=contentQuery.replaceAll(alias,' ');}contentQuery=contentQuery.replace(/公理集合论导引|集合论导引|集合論導引|冯琦|Jech|第[一二三四五六七八九十\d]+[章卷]/gi,' ');
  const hits=complete.search(contentQuery,{...options,bookIds,chapter,limit:24,maxCharacters:96000});
  const selected=[];const counts=new Map();let ocrCount=0;
  for(const hit of hits){if(selected.length>=(options.limit||4))break;if(hit.sourceType==='ocr'&&ocrCount>=2)continue;
   if(!requested&&(counts.get(hit.bookId)||0)>=2)continue;
   selected.push(hit);counts.set(hit.bookId,(counts.get(hit.bookId)||0)+1);if(hit.sourceType==='ocr')ocrCount++;
  }
  if(requested&&!selected.length&&chapter&&!/(?:引理|定理|命题|推论|定义|lemma|theorem|proposition|corollary|definition)\s*\d+(?:\.\d+){0,3}/i.test(contentQuery)){const range=complete.chapters.find(c=>c.bookId===requested.bookId&&c.number===chapter);if(range){const p=readPage(requested.bookId,range.startPage);if(p)selected.push(p);}}
  const perPage=Math.floor((options.maxCharacters||16000)/Math.max(1,selected.length));
  return selected.map(p=>({...p,text:p.text.slice(0,perPage),truncated:p.truncated||p.text.length>perPage}));
 }
 async function prepareImages(sources,workspace,{maxImages=2}={}){
  maxImages=Math.min(4,Math.max(1,maxImages));
  const output=join(workspace,'textbook-pages');await mkdir(output,{recursive:true});const images=[];
  // Keep ordering identical to source/citation order. All OCR citations require a supplied original image.
  const selected=sources.filter(s=>s.sourceType==='ocr'||s.sourceType==='image');
  for(const s of sources)if(selected.length<maxImages&&!selected.includes(s))selected.push(s);
  for(const source of selected.slice(0,maxImages)){
   const b=manifest.books.find(b=>b.bookId===source.bookId);if(!b||!readPage(b.bookId,source.pdfPage))throw new Error('UNKNOWN_PAGE');
   const file=join(output,`${b.bookId.slice(0,12)}-${source.pdfPage}.png`);
   await run(pythonPath,[fileURLToPath(new URL('./textbook_pages.py',import.meta.url)),'render',join(root,b.file),String(source.pdfPage),file],{env:{...process.env,PYTHONPATH:pythonLibraries},timeout:30000,maxBuffer:65536,windowsHide:true});images.push({path:file,citation:source.citation});
  }
  return images;
 }
 return {search,readPage,prepareImages,pageCount:complete.pageCount,chapters:complete.chapters,catalog:manifest.books.map(({bookId,title,pages,sourceNames=[],aliases=[],pdfToc=[]})=>({bookId,title,pages,sourceNames,aliases,outline:pdfToc.filter(x=>x.level===1).slice(0,45)}))};
}