import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeBrowseLoad,personaMentionRates,recordPersonaMention} from './persona-load.mjs';
import {createBackgroundScheduler} from './background-scheduler.mjs';
import {QuestionWorkerPool} from './question-worker-pool.mjs';
import {TeachingBot} from './teaching-bot.mjs';
import {LocalDurableState} from './local-durable-state.mjs';
import {createKnowledgeBase} from './knowledge.mjs';
const turn=()=>new Promise(r=>setImmediate(r));
function fixture(t){
 let now=1800000000000;const calls=[],scopes=new Map(['1000000001','1000000002','1000000003','1000000004'].map(groupId=>[groupId,{config:{groupId,replyPolicy:'mentions-only'},bot:{diagnostics:{lastSelfMentionAt:now,mentionRates:{axu:0,hui:0},queued:0},peekJob:()=>null},transport:{diagnostics:{online:true,memberOfGroup:true,checkedAt:new Date(now).toISOString()},check:async()=>({online:true,memberOfGroup:true})}}]));
 const workers=new QuestionWorkerPool(scopes,{concurrency:3,perGroup:2,optional:1});
 const jobs=Object.fromEntries(['bilibili','huiBilibili'].map(name=>[name,{due:true,run:async options=>{calls.push({name,...options});}}]));
 const scheduler=createBackgroundScheduler({workers,groupId:'1000000001',jobs,scopes,loadPolicy:{mode:'persona-majority',highMentionsPerMinute:5},now:()=>now,intervalMs:86400000});t.after(()=>scheduler.close());
 return {scopes,jobs,workers,scheduler,calls,setBusy(persona,count,value=5){[...scopes.values()].forEach((s,i)=>s.bot.diagnostics.mentionRates[persona]=i<count?value:0);}};
}
test('low-frequency personas start without any five-minute quiet wait; real group permission remains read-only',async t=>{
 const f=fixture(t);f.scheduler.tick();await turn();assert.equal(f.calls[0].name,'bilibili');assert.equal(f.calls[0].readOnly,true);assert.equal(f.scheduler.diagnostics.trigger,'persona-majority');
});
test('one or two busy groups do not block; three out of four block Axu while Hui can still browse',async t=>{
 const f=fixture(t);f.setBusy('axu',2);f.scheduler.tick();await turn();assert.equal(f.calls[0].name,'bilibili');
 f.setBusy('axu',3);f.scheduler.tick();await turn();assert.equal(f.calls[1].name,'huiBilibili');
 assert.equal(f.scheduler.diagnostics.loadPolicy.personas.axu.highFrequency,true);assert.equal(f.scheduler.diagnostics.loadPolicy.personas.hui.highFrequency,false);assert.equal(f.scheduler.diagnostics.loadPolicy.personas.axu.majorityRequired,3);
});
test('Hui high-frequency calls do not suppress Axu; both busy pauses inference',async t=>{
 const f=fixture(t);f.setBusy('hui',3);f.scheduler.tick();await turn();assert.equal(f.calls[0].name,'bilibili');f.setBusy('axu',3);f.scheduler.tick();await turn();assert.equal(f.calls.length,1);
});
test('single sponsor mention does not abort; reaching persona majority does abort that persona',async t=>{
 const f=fixture(t);let signal;f.jobs.bilibili.run=options=>new Promise(resolve=>{signal=options.signal;signal.addEventListener('abort',resolve,{once:true});});
 f.scheduler.tick();await turn();f.setBusy('axu',1,1);f.scheduler.tick();await turn();assert.equal(signal.aborted,false);
 f.setBusy('axu',3);f.scheduler.tick();await turn();assert.equal(signal.aborted,true);
});
test('an offline or stale sponsor and queued foreground questions still prevent starting',async t=>{
 const f=fixture(t);for(const s of f.scopes.values())s.transport.diagnostics.online=false;f.scheduler.tick();await turn();assert.equal(f.calls.length,0);
 for(const s of f.scopes.values()){s.transport.diagnostics.online=true;s.transport.diagnostics.checkedAt='2000-01-01T00:00:00Z';}f.scheduler.tick();await turn();assert.equal(f.calls.length,0);
});
test('rolling minute uses event time, expires exactly at sixty seconds and caps stored timestamps',()=>{
 const now=1800000000000;let state={axu:[],hui:[]};for(let i=0;i<5;i++)state=recordPersonaMention(state,{persona:'axu',at:now,now});assert.equal(personaMentionRates(state,now+59999).axu,5);assert.equal(personaMentionRates(state,now+60000).axu,0);
 state=recordPersonaMention(state,{persona:'hui',at:now-60001,now});state=recordPersonaMention(state,{persona:'hui',at:now+5001,now});assert.equal(state.hui.length,0);for(let i=0;i<1000;i++)state=recordPersonaMention(state,{persona:'axu',at:now,now});assert.equal(state.axu.length,600);
});
test('threshold is configurable within five to ten; malformed policy fails closed',()=>{
 for(const n of [5,10])assert.equal(normalizeBrowseLoad({mode:'persona-majority',highMentionsPerMinute:n}).highMentionsPerMinute,n);
 for(const n of [0,4,11,'5'])assert.throws(()=>normalizeBrowseLoad({mode:'persona-majority',highMentionsPerMinute:n}),/INVALID/);
});
test('only new real current @s count, retain routed persona, deduplicate and survive restart',async()=>{
 const profile=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));let now=1800000000000;const root=await mkdtemp(join(tmpdir(),'persona-mention-'));
 const opts={config:{...profile,secondaryPersona:{enabled:true,activationMode:'mentioned-name',routeHumanities:true}},runtimeRoot:root,now:()=>now,model:{kind:'mock',generate:async()=>{throw Error('NO_MODEL');}},transport:{kind:'mock',send:async()=>{throw Error('NO_SEND');}},knowledge:createKnowledgeBase(),store:new LocalDurableState(join(root,'state'))};const bot=await TeachingBot.open(opts);
 const event=(id,text='阿序你好',segments=true,extra={})=>({post_type:'message',message_type:'group',self_id:profile.botId,group_id:profile.groupId,user_id:'12345678',message_id:id,message:[...(segments?[{type:'at',data:{qq:profile.botId}}]:[]),{type:'text',data:{text}}],...extra});
 await bot.ingest(event('plain','回，你好',false));await bot.ingest(event('quoted','你好',false,{raw_message:'[CQ:at,qq='+profile.botId+']'}));await bot.ingest(event('old','阿序你好',true,{time:(now-60001)/1000}));assert.equal(bot.diagnostics.mentionRates.axu,0);
 for(let i=0;i<5;i++)await bot.ingest(event('axu-'+i));await bot.ingest(event('hui','回，你好'));await bot.ingest(event('humanities','请解释现象学的核心问题'));await bot.ingest(event('hui','回，你好'));assert.equal(bot.diagnostics.mentionRates.axu,5);assert.equal(bot.diagnostics.mentionRates.hui,2);
 const restored=await TeachingBot.open(opts);assert.equal(restored.diagnostics.mentionRates.axu,5);assert.equal(restored.diagnostics.mentionRates.hui,2);now+=60000;assert.equal(restored.diagnostics.mentionRates.axu,0);assert.equal(restored.diagnostics.mentionRates.hui,0);
});

test('mention preemption resumes due checks after five seconds without shortening platform backoff',async()=>{
 const {BilibiliExplorer}=await import('./bilibili-explorer.mjs');const {ScholarExplorer}=await import('./scholar-explorer.mjs');const now=1800000000000,root=await mkdtemp(join(tmpdir(),'short-mention-retry-'));
 const common={now:()=>now,config:{enabled:true,targetGroupId:'1000000001',intervalMs:1800000,maxSharesPerDay:0,maxCommentsPerDay:0,mentionRetryMs:5000},transport:{check:async()=>({online:true,memberOfGroup:true})},curator:{},reader:{},media:{}};
 for(const [name,Factory] of [['video',BilibiliExplorer],['article',ScholarExplorer]]){const controller=new AbortController(),abort=async()=>{controller.abort();throw Error('ABORTED');};const worker=await Factory.open({...common,root:join(root,name),site:{check:abort},sources:{discover:abort}});assert.equal((await worker.run({signal:controller.signal})).status,'deferred-for-mentions');assert.equal(worker.diagnostics.nextRunAt,now+5000);}
 const blocked=await BilibiliExplorer.open({...common,root:join(root,'blocked'),site:{check:async()=>{throw Error('BILIBILI_VERIFICATION_REQUIRED');}}});await blocked.run();assert.ok(blocked.diagnostics.nextRunAt>=now+1800000);
});
