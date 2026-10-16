import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {indexVisualPages} from './visual-index.mjs';
const bookId='a'.repeat(64);
async function fixture(){const root=await mkdtemp(join(tmpdir(),'visual-index-')),corpusRoot=join(root,'corpus'),indexPath=join(root,'pages.json');await mkdir(corpusRoot);await writeFile(join(corpusRoot,'manifest.json'),JSON.stringify({books:[{bookId,title:'Synthetic handwritten fixture',file:bookId+'.pdf',pages:3,sourceNames:['fixture.pdf']}]}));await writeFile(indexPath,JSON.stringify({version:1,pages:[{bookId,title:'fixture',page:3,text:'Unselected original row must survive.',sourceType:'text-layer'}]}));return{runtime:{corpusRoot,indexPath},root};}
const rows=pages=>pages.map(pdfPage=>({pdfPage,blank:false,headings:['Definition '+pdfPage],keywords:['ultrafilter','synthetic'],content:'This is a synthetic mathematical page summary for testing faithful retrieval indexing and preserving selected original PDF page numbers. It is not a textbook excerpt.',unclear:['Synthetic unclear symbol.']}));
test('visual indexing supplies original images, binds PDF page ordering, preserves unselected pages and resumes without a second model call',async()=>{
 const {runtime}=await fixture();let calls=0;
 const generate=async r=>{calls++;assert.equal(r.model,'gpt-6.1-sol');assert.equal(r.reasoningEffort,'high');assert.equal(r.billingRoute,'chatgpt-plan');assert.deepEqual(r.imageSources.map(x=>x.pdfPage),[1,2]);return{status:'answer',model:r.model,reasoningEffort:r.reasoningEffort,text:JSON.stringify(rows([1,2]))};};
 const a=await indexVisualPages({runtime,bookId,pages:[1,2],generate});assert.equal(a.indexedPages,2);
 const b=await indexVisualPages({runtime,bookId,pages:[1,2],generate});assert.equal(b.reusedBatches,1);assert.equal(calls,1);
 const index=JSON.parse(await readFile(runtime.indexPath,'utf8'));assert.equal(index.pages.length,3);assert.equal(index.pages.find(x=>x.page===3).sourceType,'text-layer');assert.equal(index.pages.find(x=>x.page===1).formulaAccuracyVerified,false);assert.equal(index.pages.find(x=>x.page===1).transcriptionKind,'visual-semantic-index');
});
test('misordered visual output cannot rewrite the private index',async()=>{
 const {runtime}=await fixture(),original=await readFile(runtime.indexPath,'utf8');
 await assert.rejects(indexVisualPages({runtime,bookId,pages:[1,2],generate:async r=>({status:'answer',model:r.model,reasoningEffort:r.reasoningEffort,text:JSON.stringify(rows([2,1]))})}),/INVALID_VISUAL_INDEX/);
 assert.equal(await readFile(runtime.indexPath,'utf8'),original);
});

test('a blank-page model judgment does not erase previously indexed original text',async()=>{
 const {runtime}=await fixture();
 await indexVisualPages({runtime,bookId,pages:[3],generate:async r=>({status:'answer',model:r.model,reasoningEffort:r.reasoningEffort,text:JSON.stringify([{pdfPage:3,blank:true,headings:[],keywords:[],content:'',unclear:[]}])})});
 const index=JSON.parse(await readFile(runtime.indexPath,'utf8'));assert.equal(index.pages.find(x=>x.page===3).text,'Unselected original row must survive.');
});
