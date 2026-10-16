import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ReadingMemory,readingItem} from './reading-memory.mjs';
import {TeachingBot,MODEL,EFFORT,validateProfile} from './teaching-bot.mjs';
import {createKnowledgeBase} from './knowledge.mjs';
const base=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));
const bookId='a'.repeat(64),source={citation:'aaaaaaaaaaaa:p2',bookId,title:'教材',pdfPage:2,text:'cofinality 共尾度 原文'};
const memory=async()=>ReadingMemory.open(join(await mkdtemp(join(tmpdir(),'reading-test-')),'state.json'));
test('page revisions have distinct ids, never whole-book claims',async()=>{assert.notEqual(readingItem(source).id,readingItem({...source,text:'new'}).id);assert.equal(readingItem({...source,pdfPage:null}),null);});
test('feedback survives restart, remains per-member, duplicate event is idempotent',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'reading-state-')),file=join(dir,'state.json');let m=await ReadingMemory.open(file);
 await m.observe({sources:[source],citations:[source.citation],userId:'11111',messageId:'m1',recommendation:true,delivered:true,replyId:'out1'});
 await m.command('/反馈 已经会了',{userId:'11111',messageId:'f1',replyTo:'out1'});
 await m.command('/反馈 已经会了',{userId:'11111',messageId:'f1',replyTo:'out1'});
 m=await ReadingMemory.open(file);assert.equal(m.diagnostics.feedbackEvents,1);assert.equal(m.context('11111').userFeedback[0].action,'already_known');assert.equal(m.context('22222').userFeedback.length,0);
});
test('failed delivery is not a recommendation; unknown feedback target refused',async()=>{
 const m=await memory();await m.observe({sources:[source],citations:[source.citation],userId:'11111',messageId:'m1',recommendation:true,delivered:false});
 assert.equal(m.diagnostics.confirmedDeliveries,0);assert.match(await m.command('/反馈 有帮助',{userId:'11111',messageId:'m2'}),/有效资料/);
});
test('actual original page input is distinct from semantic index; malformed state preserved',async()=>{
 const m=await memory();await m.observe({sources:[{...source,transcriptionKind:'visual-semantic-index'}],userId:'11111',messageId:'1'});
 assert.match(await m.command('/阅读记录',{userId:'11111'}),/语义索引/);
 await m.observe({sources:[source],knowledgeTrace:[{tool:'knowledge_read_pages',sourcePages:[{bookId,pdfPage:2}]}],userId:'11111',messageId:'2'});
 assert.match(await m.command('/阅读记录',{userId:'11111'}),/原页输入/);
 const file=join(await mkdtemp(join(tmpdir(),'reading-invalid-')),'s.json');await writeFile(file,'{"version":999}');await assert.rejects(ReadingMemory.open(file),/INVALID_READING_STATE/);assert.equal(await readFile(file,'utf8'),'{"version":999}');
});
test('unlimited daily calls allow usage after 100 and budget-free feedback uses no inference',async()=>{
 const m=await memory(),kb=createKnowledgeBase({pages:[{bookId,title:'教材',page:2,text:source.text}]}),sent=[];let calls=0;
 const bot=await TeachingBot.open({config:{...base,mode:'offline',dailyModelCalls:null,perUserIntervalMs:0},reading:m,knowledge:kb,runtimeRoot:await mkdtemp(join(tmpdir(),'reading-bot-')),
 store:{load:async()=>({version:1,groupId:base.groupId,botId:base.botId,queue:[],active:null,context:[],seen:[],lastUser:[],day:new Date().toISOString().slice(0,10),calls:101,lastProactive:null,receipts:[]}),save:async()=>{}},
 model:{kind:'mock',generate:async r=>{calls++;assert.ok(r.readingContext);return{status:'answer',text:'可以阅读该定义。',citations:r.sources.map(s=>s.citation),model:MODEL,reasoningEffort:EFFORT,billingRoute:'chatgpt-plan'};}},
 transport:{kind:'mock',send:async r=>{sent.push(r);return{ok:true,messageId:String(sent.length)};}}});
 const event=(id,text)=>({post_type:'message',message_type:'group',self_id:base.botId,group_id:base.groupId,user_id:'12345678',message_id:id,message:[{type:'at',data:{qq:base.botId}},{type:'text',data:{text}}]});
 await bot.ingest(event('1','推荐阅读 共尾度'));await bot.drain();assert.equal(calls,1);assert.equal(bot.diagnostics.modelCalls,102);assert.match(sent[0].text,/资料编号/);
 await bot.ingest(event('2','/反馈 有帮助'));await bot.drain();assert.equal(calls,1);assert.equal(m.diagnostics.feedbackEvents,1);
 assert.throws(()=>validateProfile({...base,dailyModelCalls:0}),/INVALID/);assert.doesNotThrow(()=>validateProfile({...base,dailyModelCalls:null}));
});
