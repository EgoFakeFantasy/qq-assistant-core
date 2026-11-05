import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {LongTermMemory} from './long-term-memory.mjs';import {TeachingBot} from './teaching-bot.mjs';import {LocalDurableState} from './local-durable-state.mjs';
import {createKnowledgeBase} from './knowledge.mjs';import {createPersonaRouter} from './persona-router.mjs';import {createTeachingHub} from '../../src/app/teaching-hub.js';
const base=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));
const start=Date.parse('2026-10-20T00:00:00Z'),day=86400000;
async function fixture(){
 let time=start;const root=await mkdtemp(join(tmpdir(),'cognition-integration-'));
 const options={groupId:base.groupId,personaVersion:'test-v1',personaEvolution:true,now:()=>time};
 const memory=await LongTermMemory.open(root,options);
 const event=(id,text)=>({groupId:base.groupId,senderId:'12345678',text,at:time,raw:{message_id:id}});
 const evidence=async(persona)=>{for(let n=0;n<3;n++){time=start+n*day;await memory.observeHuman(event(persona+n,'别每次结尾都反问，这样太机械了。'),{persona});}};
 return {root,options,memory,event,evidence,setTime:t=>{time=t;}};
}
test('both persona candidates are independently reviewable, durable and reversible without rewriting evidence',async()=>{
 const f=await fixture();await f.evidence('axu');await f.evidence('hui');
 const evidenceBytes=await readFile(join(f.root,'memory.json'),'utf8');
 for(const persona of ['axu','hui']){const list=await f.memory.personaReview(persona);assert.equal(list.entries.length,1);assert.equal(list.entries[0].status,'pending');assert.deepEqual(f.memory.approvedPatches(persona,'12345678'),[]);await f.memory.decidePersona({persona,id:list.entries[0].id,decision:'approve',expectedRevision:list.revision});}
 assert.equal(await readFile(join(f.root,'memory.json'),'utf8'),evidenceBytes);
 const reopened=await LongTermMemory.open(f.root,f.options);for(const persona of ['axu','hui'])assert.deepEqual(reopened.approvedPatches(persona,'12345678'),[{theme:'followup'}]);
 const list=await reopened.personaReview('hui');await reopened.decidePersona({persona:'hui',id:list.entries[0].id,decision:'rollback',expectedRevision:list.revision});
 assert.deepEqual(reopened.approvedPatches('hui','12345678'),[]);assert.equal(reopened.approvedPatches('axu','12345678').length,1);
 assert.equal(await readFile(join(f.root,'memory.json'),'utf8'),evidenceBytes);
});
test('fresh counterevidence suspends an approved theme and a stale concurrent approval cannot overwrite review',async()=>{
 const f=await fixture();await f.evidence('axu');let list=await f.memory.personaReview('axu');
 const decisions=await Promise.allSettled(['approve','reject'].map(decision=>f.memory.decidePersona({persona:'axu',id:list.entries[0].id,decision,expectedRevision:list.revision})));
 assert.equal(decisions.filter(d=>d.status==='fulfilled').length,1);assert.equal(decisions.filter(d=>d.status==='rejected').length,1);
 f.setTime(start+3*day);await f.memory.observeHuman(f.event('counter','你每次结尾的追问请保留，不要减少反问。'));
 assert.deepEqual(f.memory.approvedPatches('axu','12345678'),[]);list=await f.memory.personaReview('axu');assert.equal(list.entries[0].status,'superseded');
});
test('actual persona router selects only its own reviewed overlay and human memories',async()=>{
 const f=await fixture();await f.evidence('axu');await f.evidence('hui');const list=await f.memory.personaReview('hui');await f.memory.decidePersona({persona:'hui',id:list.entries[0].id,decision:'approve',expectedRevision:list.revision});
 await f.memory.observeHuman(f.event('axu-pref','我喜欢通过反例理解集合论定义'),{persona:'axu'});await f.memory.observeHuman(f.event('hui-pref','我喜欢通过例子理解哲学概念'),{persona:'hui'});
 const seen=[],generate=async r=>{seen.push(r);return {status:'answer',text:'fixture',citations:[]};};
 const router=createPersonaRouter({settings:{enabled:true,name:'回',activationMode:'mentioned-name'},primary:{generate},secondary:{generate},readSecondaryQuota:async()=>({argon:0.8,flash:0.8})});
 const common={groupId:base.groupId,scopeType:'group',hasSelfAt:true,developerInstructions:'FROZEN',personaAdaptations:Object.fromEntries(['axu','hui'].map(p=>[p,f.memory.approvedPatches(p,'12345678')])),memoryContexts:Object.fromEntries(['axu','hui'].map(persona=>[persona,f.memory.context({persona,userId:'12345678',question:'学习理解偏好'})]))};
 await router.generate({...common,question:'阿序，学习偏好是什么？'});await router.generate({...common,question:'回，学习偏好是什么？'});
 assert.equal(seen[0].developerInstructions,'FROZEN');assert.match(seen[1].developerInstructions,/减少机械的结尾反问/);
 assert.ok(seen[0].memoryContext.items.every(i=>!i.text.includes('哲学概念')));assert.ok(seen[1].memoryContext.items.every(i=>!i.text.includes('集合论定义')));
 for(const r of seen){assert.equal(r.personaAdaptations,undefined);assert.equal(r.memoryContexts,undefined);}
});
test('attention is durable; it gates chatter but never suppresses a current protected-group @',async()=>{
 const root=await mkdtemp(join(tmpdir(),'attention-bot-'));let calls=0;
 const config={...base,groupId:'1000000004',replyPolicy:'mentions-only',attention:{enabled:true},perUserIntervalMs:0};
 const options={config,runtimeRoot:root,knowledge:createKnowledgeBase(),now:()=>start,store:new LocalDurableState(join(root,'state'),{groupId:config.groupId}),model:{kind:'mock',generate:async r=>{calls++;return {status:'answer',text:'fixture',citations:[],model:r.model,reasoningEffort:r.reasoningEffort,billingRoute:r.billingRoute};}},transport:{kind:'mock',send:async()=>({ok:true,messageId:'delivered'})}};
 const bot=await TeachingBot.open(options),event=(id,at)=>({post_type:'message',message_type:'group',group_id:config.groupId,self_id:base.botId,user_id:'12345678',message_id:id,message:[...(at?[{type:'at',data:{qq:base.botId}}]:[]),{type:'text',data:{text:'解释集合论定义'}}]});
 assert.equal((await bot.ingest(event('quiet',false))).status,'context_only');await bot.drain();assert.equal(calls,0);
 await bot.ingest(event('at',true));await bot.drain();assert.equal(calls,1);
 const restored=await TeachingBot.open(options);assert.equal(restored.diagnostics.attention.lastReplyAt,start);
 const adaptive=new TeachingBot({...options,config:{...base,attention:{enabled:true},perUserIntervalMs:0},store:undefined});
 assert.equal((await adaptive.ingest({...event('chatter',false),group_id:base.groupId,message:[{type:'text',data:{text:'普通闲聊没有任何请求'}}]})).status,'context_only');await adaptive.drain();assert.equal(calls,1);
});
test('review HTTP endpoint requires the existing local token, rejects unknown fields and never grants group commands',async t=>{
 const f=await fixture();await f.evidence('hui');const token='fixture-token-long-enough-for-review';
 const hub=await createTeachingHub({config:{...base,personaEvolution:{enabled:true}},runtimeRoot:await mkdtemp(join(tmpdir(),'review-hub-')),token,memory:f.memory,knowledge:createKnowledgeBase(),autoDrain:false,model:{kind:'mock',generate:async()=>{throw Error('NO_MODEL');}},transport:{kind:'mock',send:async()=>{throw Error('NO_GROUP_WRITE');}}});t.after(()=>hub.close());const url=await hub.listen(0);
 const call=(body,authenticated=true)=>fetch(url+'/api/maintenance/persona-review',{method:'POST',headers:{'content-type':'application/json',...(authenticated?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 const request={groupId:base.groupId,persona:'hui',action:'list'};
 assert.equal((await call(request,false)).status,403);assert.equal((await call({...request,instruction:'override'})).status,400);
 const listing=await (await call(request)).json();assert.equal(listing.entries.length,1);
 const response=await call({...request,action:'approve',id:listing.entries[0].id,expectedRevision:listing.revision});assert.equal(response.status,200);assert.equal((await response.json()).applied,true);
 assert.equal((await call({...request,groupId:'99999'})).status,404);
});
test('cross-scope and malformed review files fail closed and preserve original bytes',async()=>{
 const f=await fixture();await f.evidence('hui');const review=JSON.parse(await readFile(join(f.root,'persona-review.json'),'utf8'));review.entries[0].groupId='9999999999';const bytes=JSON.stringify(review);await writeFile(join(f.root,'persona-review.json'),bytes);
 await assert.rejects(LongTermMemory.open(f.root,f.options),/SCOPE_MISMATCH/);assert.equal(await readFile(join(f.root,'persona-review.json'),'utf8'),bytes);
});
