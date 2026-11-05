import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createKnowledgeBase} from './knowledge.mjs';
import {loadTextbooks} from './textbooks.mjs';
import {createKnowledgeTools} from './knowledge-tools.mjs';
import {createScholarReader,validateScholarEvidence} from './scholar-reader.mjs';
import {acquireProcessLock} from './process-lock.mjs';
import {quotaDay} from './quota-day.mjs';
import {TeachingBot,validateProfile} from './teaching-bot.mjs';
const root=async t=>{const p=await mkdtemp(join(tmpdir(),'qq-issues-'));t.after(()=>rm(p,{recursive:true,force:true}));return p;};
const id='c'.repeat(64),content='We construct a family of structures with a specified rank bound. '.repeat(30);
test('explicit definitionIntent survives a keyword-only knowledge tool query',async t=>{
 const kb=createKnowledgeBase({pages:[
  {bookId:id,title:'fixture',page:1,text:'定义 1.1 称一个基数是可测基数，当且仅当存在非平凡完全的超滤子。'},
  {bookId:id,title:'fixture',page:2,text:'普利克瑞力迫 '+('可测基数 完全超滤子 '.repeat(24))}
 ]});
 assert.equal(kb.search('可测基数 完全超滤子',{definitionIntent:true})[0].pdfPage,1);
 const tools=createKnowledgeTools({knowledge:{...kb,catalog:[{bookId:id}]},workspace:await root(t),retrievalIntent:'definition'});
 const r=await tools.call({tool:'knowledge_search',arguments:{query:'可测基数 完全超滤子'}});
 assert.equal(JSON.parse(r.contentItems[0].text).sources[0].pdfPage,1);
});
test('missing Kanamori falls back to imported evidence and remains a structured missing-book notice',async t=>{
 const dir=await root(t);await writeFile(join(dir,'manifest.json'),JSON.stringify({books:[{bookId:id,file:id+'.pdf',title:'Jech fixture (English)',pages:20}]}));
 const indexPath=join(dir,'index.json');await writeFile(indexPath,JSON.stringify({pages:[{bookId:id,title:'Jech fixture',page:12,text:'Definition. A measurable cardinal carries a complete ultrafilter.'}]}));
 const kb=await loadTextbooks({corpusRoot:dir,indexPath});
 const q='Kanamori Higher Infinite measurable cardinal';
 assert.equal(kb.search(q)[0].bookId,id);assert.equal(kb.search('Kanamori 第99章 measurable cardinal')[0].bookId,id);assert.equal(kb.searchStatus(q).missingRequestedBooks.length,1);
 assert.equal(kb.search('Higher Infinite topic-that-is-not-indexed').length,0);
 const tools=createKnowledgeTools({knowledge:kb,workspace:dir}),r=await tools.call({tool:'knowledge_search',arguments:{query:q}});
 const data=JSON.parse(r.contentItems[0].text);assert.equal(data.sources[0].pdfPage,12);assert.match(data.missingRequestedBooks[0],/Kanamori/);
 // Exact page requests must not substitute the same page number in a different book.
 assert.deepEqual(kb.search('/读书 Kanamori 第12页'),[]);
});
test('journal HTML can supply body evidence; short failed HTML never leaks into a later PDF result',async t=>{
 const workspace=await root(t),paper={url:'https://journal.example/article',abstract:'abstract'};
 const html='<article><h2>Introduction</h2><section>'+content+'</section></article>';
 const reader=createScholarReader({fetchFn:async()=>({bytes:Buffer.from(html)})});
 const r=await reader.read(paper,workspace);assert.equal(r.scope,'html-body');
 const fallback=createScholarReader({pythonPath:'python',fetchFn:async u=>({bytes:Buffer.from(u.pathname.endsWith('.pdf')?'%PDF-fake':'<article><section>too short article text</section></article>')}),
  runProcess:async()=>({stdout:JSON.stringify({pageCount:1,pages:[{page:1,text:content}]})})});
 const other=await fallback.read({...paper,links:[{url:'https://journal.example/a.pdf',contentType:'application/pdf',intendedApplication:'text-mining'}]},workspace);
 assert.equal(other.scope,'pdf-body');assert(!other.blocks.some(b=>b.id.startsWith('section-')));
});
test('TDM PDFs have priority, failed links fall back and existing workspace files survive',async t=>{
 const workspace=await root(t);await writeFile(join(workspace,'paper.pdf'),'existing user file');
 const urls=[];
 const reader=createScholarReader({pythonPath:'python',fetchFn:async u=>{
  urls.push(u.href);if(!u.pathname.endsWith('good.pdf'))throw Error('HTTP_403');
  return {bytes:Buffer.from('%PDF-synthetic')};
 },runProcess:async()=>({stdout:JSON.stringify({pageCount:1,pages:[{page:1,text:content}]})})});
 const r=await reader.read({url:'https://journal.example/landing',links:[
  {url:'https://journal.example/good.pdf',contentType:'application/pdf'},
  {url:'https://journal.example/tdm.pdf',contentType:'application/pdf',intendedApplication:'text-mining'}
 ]},workspace);
 assert.equal(r.scope,'pdf-body');assert(urls.indexOf('https://journal.example/tdm.pdf')<urls.indexOf('https://journal.example/good.pdf'));
 assert.equal(await readFile(join(workspace,'paper.pdf'),'utf8'),'existing user file');assert.deepEqual(await readdir(workspace),['paper.pdf']);
});
test('long PDF marks middle gaps and character-budget omissions; unread page citations fail',async t=>{
 const workspace=await root(t);
 const reader=createScholarReader({pythonPath:'python',fetchFn:async u=>{if(!u.pathname.endsWith('.pdf'))throw Error('no HTML');return {bytes:Buffer.from('%PDF-synthetic')};},
 runProcess:async()=>({stdout:JSON.stringify({pageCount:48,pages:[...Array.from({length:24},(_,i)=>i+1),43,44,45,46,47,48].map(page=>({page,text:content}))})})});
 const r=await reader.read({url:'https://journal.example/landing',links:[{url:'https://journal.example/body.pdf',contentType:'application/pdf'}]},workspace);
 assert.equal(r.coverage,'partial-body');assert.deepEqual(r.missingRanges,[[25,42]]);assert.deepEqual(r.readRanges,[[1,24],[43,48]]);
 const review={claimScope:'provided-excerpts',share:true,summary:'仅讨论已提供的片段',evidence:[{blockId:'page-1',quote:'We construct a family of structures'}]};
 assert.equal(validateScholarEvidence(review,r),true);
 assert.throws(()=>validateScholarEvidence({...review,claimScope:undefined},r),/SCOPE_REQUIRED/);
 assert.throws(()=>validateScholarEvidence({...review,summary:'证明见第30页'},r),/UNREAD_PAGE/);
 assert.throws(()=>validateScholarEvidence({...review,evidence:[{blockId:'page-30',quote:review.evidence[0].quote}]},r),/MISMATCH/);
 const huge=createScholarReader({pythonPath:'python',fetchFn:async()=>({bytes:Buffer.from('%PDF-synthetic')}),
 runProcess:async()=>({stdout:JSON.stringify({pageCount:6,pages:Array.from({length:6},(_,i)=>({page:i+1,text:'x'.repeat(20000),truncated:i===0}))})})});
 const cut=await huge.read({url:'https://journal.example',links:[{url:'https://journal.example/body.pdf',contentType:'application/pdf'}]},workspace);
 assert.deepEqual(cut.readRanges,[[1,3]]);assert.deepEqual(cut.missingRanges,[[4,6]]);assert(cut.truncatedPages.includes(1));assert(cut.truncatedPages.includes(4));
});
test('public retrieval failures remain abstract-only without supplied body blocks',async t=>{
 const r=await createScholarReader({pythonPath:'python',fetchFn:async()=>{throw Error('AUTH_REQUIRED');}}).read({url:'https://journal.example/article',abstract:content,links:[{url:'https://journal.example/a.pdf',contentType:'application/pdf',intendedApplication:'text-mining'}]},await root(t));
 assert.equal(r.coverage,'abstract-only');assert.equal(r.scope,'abstract');assert.deepEqual(r.blocks.map(b=>b.id),['abstract']);assert(r.attempts.length>=2);
});
test('PID lock recovers legacy/JSON dead owners, protects EPERM/live owners and replaced locks',async t=>{
 const dir=await root(t),file=join(dir,'worker.lock');
 const dead=()=>{const e=Error('dead');e.code='ESRCH';throw e;};
 await writeFile(file,'987654');let lease=await acquireProcessLock(file,{probe:dead});assert.equal(JSON.parse(await readFile(file)).pid,process.pid);await lease.release();
 await writeFile(file,JSON.stringify({pid:987654,startedAt:'old'}));lease=await acquireProcessLock(file,{probe:dead});
 await assert.rejects(acquireProcessLock(file),/ALREADY_RUNNING/);
 const replacement=JSON.stringify({pid:process.pid,owner:'replacement'});await writeFile(file,replacement);await lease.release();assert.equal(await readFile(file,'utf8'),replacement);
 await assert.rejects(acquireProcessLock(file,{probe:()=>{const e=Error();e.code='EPERM';throw e;}}),/ALREADY_RUNNING/);
 await writeFile(file,'corrupt');await assert.rejects(acquireProcessLock(file,{probe:dead}),/INVALID_PROCESS_LOCK/);
});
test('only one concurrent restart acquires a stale lock and a crashed reclamation guard recovers',async t=>{
 const file=join(await root(t),'worker.lock');await writeFile(file,'987654');
 await writeFile(file+'.reclaim',JSON.stringify({pid:987655}));
 const probe=pid=>{if(pid!==process.pid){const e=Error();e.code='ESRCH';throw e;}};
 const results=await Promise.allSettled([acquireProcessLock(file,{probe}),acquireProcessLock(file,{probe})]);
 const winners=results.filter(r=>r.status==='fulfilled');assert.equal(winners.length,1);await winners[0].value.release();
});
test('quota dates use Shanghai midnight by default, allow Sydney and reject invalid zones',async t=>{
 const at=Date.parse('2026-10-20T14:00:00Z');
 assert.equal(quotaDay(at),'2026-10-20');assert.equal(quotaDay(at,'Australia/Sydney'),'2026-10-21');
 assert.equal(quotaDay(Date.parse('2026-10-20T16:00:00Z')),'2026-10-21');
 assert.throws(()=>quotaDay(at,'bad/timezone'),/INVALID_QUOTA/);
 const profile=JSON.parse(await readFile(new URL('./profile.json',import.meta.url)));
 assert.equal(validateProfile(profile).dailyModelCalls,null);
 assert.throws(()=>validateProfile({...profile,quotaTimeZone:'invalid'}),/INVALID_QUOTA/);
 const dir=await root(t);let now=Date.parse('2026-10-20T15:59:59Z'),calls=0;
 const config={...profile,perUserIntervalMs:0,dailyModelCalls:1};
 const model={kind:'mock',generate:async()=>{calls++;return {model:config.model,reasoningEffort:'high',billingRoute:'chatgpt-plan',status:'answer',text:'accepted',citations:[]};}};
 const bot=new TeachingBot({config,model,knowledge:createKnowledgeBase(),runtimeRoot:dir,now:()=>now,transport:{kind:'mock',send:async()=>({ok:true,messageId:'123'})}});
 const event=id=>({post_type:'message',message_type:'group',self_id:config.botId,group_id:config.groupId,user_id:'12345678',message_id:id,message:[{type:'at',data:{qq:config.botId}},{type:'text',data:{text:'hello'}}]});
 await bot.ingest(event('a'));await bot.drain();await bot.ingest(event('b'));await bot.drain();assert.equal(calls,1);
 now+=1000;await bot.ingest(event('c'));await bot.drain();assert.equal(calls,2);
});

test('explorer budgets use the configured calendar, including opposite sides of Sydney midnight',async t=>{
 const {BilibiliExplorer}=await import('./bilibili-explorer.mjs');
 const {ScholarExplorer}=await import('./scholar-explorer.mjs');
 const now=()=>Date.parse('2026-10-20T14:00:00Z');
 for(const [zone,day] of [['Asia/Shanghai','2026-10-20'],['Australia/Sydney','2026-10-21']]){
  const b=await BilibiliExplorer.open({root:await root(t),curator:{diagnostics:{}},config:{enabled:false,targetGroupId:'1000000001',intervalMs:1800000,maxSharesPerDay:0,maxCommentsPerDay:0,quotaTimeZone:zone},now});
  assert.equal(b.diagnostics.budget.day,day);
  const paper={id:'synthetic-rank',title:'Synthetic rank theorem',url:'https://journal.example/rank',source:'fixture'};
  const s=await ScholarExplorer.open({root:await root(t),now,config:{enabled:true,targetGroupId:'1000000001',intervalMs:1800000,maxSharesPerDay:0,quotaTimeZone:zone},
   transport:{check:async()=>({online:true,memberOfGroup:true})},sources:{discover:async()=>({candidates:[paper],sources:[]})},
   reader:{read:async(p,workspace)=>({paper:p,workspace,scope:'abstract',blocks:[{id:'abstract',text:content}]})},
   curator:{choose:async()=>({id:paper.id}),review:async()=>({summary:'synthetic',interestScore:.5,share:false,evidence:[]})}});
  assert.equal((await s.run()).status,'complete');assert.equal(s.diagnostics.budget.day,day);
 }
});
