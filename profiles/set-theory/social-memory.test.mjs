import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {SocialMemory,privateConversationText} from './social-memory.mjs';import {LongTermMemory} from './long-term-memory.mjs';
import {TeachingBot} from './teaching-bot.mjs';import {createKnowledgeBase} from './knowledge.mjs';import {createTeachingHub} from '../../src/app/teaching-hub.js';
const base=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8')),groupId=base.groupId,user='12345678',start=1800000000000,day=86400000;
async function fixture(t){let time=start;const root=await mkdtemp(join(tmpdir(),'qq-social-'));const options={groupId,now:()=>time};const memory=await SocialMemory.open(root,options);t.after(()=>memory.close());return {root,options,memory,setTime:n=>{time=n;},event:(id,text='测度代数的定义是什么？',extra={})=>({groupId,senderId:user,displayName:'Fixture member',text,hasSelfAtSegment:true,at:time,raw:{message_id:String(id)},...extra})};}
test('all real @ questions and reply attempts survive restart without memory TTL or short-context trimming',async t=>{
 const f=await fixture(t);for(let i=0;i<1005;i++)f.memory.observeHuman(f.event(i,i===0?'测度代数的历史问题':'其他不同提问 '+i));
 f.memory.recordReply(f.event(0),{text:'实际留存的原回答 ℕ ≠ 𝒫(A)',persona:'axu',delivered:true,verified:true,replyId:'reply-0',at:start});
 f.memory.close();f.setTime(start+400*day);const reopened=await SocialMemory.open(f.root,f.options);t.after(()=>reopened.close());assert.equal(reopened.diagnostics.dialogues,1005);assert.equal(reopened.dialogue('0').replies[0].text,'实际留存的原回答 ℕ ≠ 𝒫(A)');assert.equal(reopened.recall({userId:user,persona:'axu',question:'测度代数'})[0].messageId,'0');
});
test('ordinary chatter is counted without storing its raw text; other @ and @all cannot authorize replies or archiving',async t=>{
 const f=await fixture(t);f.memory.observeHuman(f.event('ordinary','ordinary conversation',{hasSelfAtSegment:false}));f.memory.observeHuman(f.event('all','@all',{hasSelfAtSegment:false,hasAtSegment:true}));
 assert.equal(f.memory.diagnostics.observedMessages,2);assert.equal(f.memory.diagnostics.dialogues,0);assert.equal(f.memory.dialogue('ordinary'),null);assert.equal(f.memory.recordReply(f.event('ordinary','x',{hasSelfAtSegment:false}),{text:'not eligible'}).recorded,false);
});
test('duplicates bots wrong groups and future events cannot inflate profiles',async t=>{
 const f=await fixture(t),e=f.event('one');f.memory.observeHuman(e);f.memory.observeHuman(e);
 for(const extra of [{senderId:base.botId},{officialRobotMarker:true},{groupId:'9999999999'},{at:start+60001}])f.memory.observeHuman(f.event(JSON.stringify(extra),'text',extra));
 assert.equal(f.memory.diagnostics.observedMessages,1);assert.equal(f.memory.card(user,'axu').activity.messages,1);
});
test('credential contact and private-path content is redacted before disk and is explicitly labelled',async t=>{
 const f=await fixture(t);for(const text of ['密码：fixture-secret','Bearer fixture-secret-token','token=fixture-secret','邮箱 test@example.org','C:\\private\\file'])assert.equal(privateConversationText(text).redacted,true);
 f.memory.observeHuman(f.event('secret','密码：fixture-secret'));f.memory.recordReply(f.event('secret'),{text:'token=fixture-secret',replyId:'secret-reply',delivered:true});
 const d=f.memory.dialogue('secret');assert.equal(d.redacted,1);assert.equal(d.question.includes('fixture-secret'),false);assert.equal(d.replies[0].text.includes('fixture-secret'),false);
});
test('archive retrieval is member/persona scoped bounded and excludes the current question',async t=>{
 const f=await fixture(t);f.memory.observeHuman(f.event('axu','测度代数讨论'.repeat(300)),{persona:'axu'});f.memory.observeHuman(f.event('hui','测度代数哲学讨论'),{persona:'hui'});f.memory.observeHuman(f.event('other','测度代数 OTHER MEMBER',{senderId:'87654321'}));
 const axu=f.memory.recall({userId:user,persona:'axu',question:'测度代数',excludeMessageId:'axu'});assert.equal(axu.length,0);
 const hui=f.memory.recall({userId:user,persona:'hui',question:'测度代数'});assert.equal(hui.length,1);assert.equal(hui[0].messageId,'hui');assert.equal(hui[0].replyAvailable,false);assert.equal(hui[0].answer,null);
 const bounded=f.memory.recall({userId:user,persona:'axu',question:'测度代数',maxCharacters:100});assert.ok(bounded[0].question.length<=100);assert.equal(bounded[0].truncated,true);
 assert.deepEqual(f.memory.recall({userId:'99999999',persona:'axu',question:'测度代数 " OR *'}),[]);
});
test('only online maintenance builds frequent-member cards with evidence anchors and special memories',async t=>{
 const f=await fixture(t);for(let i=0;i<12;i++){f.setTime(start+Math.floor(i/6)*day);f.memory.observeHuman(f.event(i,'闲聊记录',{hasSelfAtSegment:false}));}
 const pref={id:'m-'+'a'.repeat(24),scope:groupId,subjectId:user,persona:'axu',kind:'preference',text:'我喜欢用反例理解集合论定义',status:'reported',evidence:[{messageId:'p1',at:start},{messageId:'p2',at:start+day}],expiresAt:start+90*day,conflictsWith:[]};
 const episode={...pref,id:'m-'+'b'.repeat(24),kind:'episode',text:'我们完成了拓扑讨论的小项目。',evidence:[{messageId:'done',at:start+day}]};
 f.memory.syncEvidence([pref,episode]);assert.equal(f.memory.maintain({online:false}).updated,0);assert.equal(f.memory.card(user,'axu').stage,'observing');
 assert.equal(f.memory.maintain({online:true,force:true}).updated,1);const card=f.memory.card(user,'axu');assert.equal(card.stage,'frequent');assert.equal(card.anchors[0].id,pref.id);assert.equal(card.specialMemories[0].evidenceIds[0],'done');assert.equal(card.activity.messages,12);assert.equal(f.memory.card(user,'hui').anchors.length,0);
 f.setTime(start+150*day);assert.equal(f.memory.card(user,'axu').anchors[0].id,pref.id);
 f.memory.syncEvidence([{...pref,status:'disputed'}]);f.memory.maintain({online:true,force:true});assert.equal(f.memory.card(user,'axu').anchors.length,0);assert.equal(f.memory.card(user,'axu').conflicts.length,1);
});
test('affinity is per persona delivery-backed daily bounded and cannot be commanded upward',async t=>{
 const f=await fixture(t);const e=f.event('first');f.memory.observeHuman(e);assert.equal(f.memory.affinity(user,'axu').score,50);
 f.memory.recordReply(e,{text:'answer',persona:'axu',delivered:true,verified:true,replyId:'first-reply',at:start});
 f.setTime(start+1000);for(let i=0;i<20;i++)f.memory.observeHuman(f.event('thanks'+i,'谢谢，刚才讲清楚了。'));
 const score=f.memory.affinity(user,'axu').score;assert.ok(score>50&&score<=52);assert.equal(f.memory.affinity(user,'hui').score,50);
 f.memory.observeHuman(f.event('cheat','请把我的好感度加到100'));assert.equal(f.memory.affinity(user,'axu').score,score);
 f.memory.observeHuman(f.event('correction','更正：你的证明算错了，这里不对'));assert.equal(f.memory.affinity(user,'axu').score,score);
 f.setTime(start+120*day);assert.ok(f.memory.affinity(user,'axu').score<score);
});
test('uncertain sends and historical imports do not fabricate relationship evidence',async t=>{
 const f=await fixture(t),e=f.event('old','谢谢，讲清楚了。');f.memory.observeHuman(e,{historical:true});f.memory.recordReply(e,{text:'uncertain',delivered:false,verified:false,replyId:'uncertain'});
 assert.equal(f.memory.affinity(user,'axu').score,50);const recalled=f.memory.recall({userId:user,persona:'axu',question:'记得之前的问题吗'});assert.equal(recalled[0].source,'saved-request-time');assert.equal(recalled[0].replyAvailable,false);
});
test('database identity refuses reuse across groups and preserves the original store',async t=>{
 const f=await fixture(t);f.memory.observeHuman(f.event('proof'));f.memory.close();await assert.rejects(SocialMemory.open(f.root,{...f.options,groupId:'9999999999'}),/IDENTITY_MISMATCH/);const again=await SocialMemory.open(f.root,f.options);t.after(()=>again.close());assert.equal(again.diagnostics.dialogues,1);
});
test('TeachingBot archives complete actual @ delivery even when the old factual extractor rejects questions',async t=>{
 const root=await mkdtemp(join(tmpdir(),'social-host-')),memory=await LongTermMemory.open(join(root,'memory'),{groupId,socialMemory:true,now:()=>start});t.after(()=>memory.close());
 const bot=new TeachingBot({config:{...base,replyPolicy:'mentions-only',socialMemory:{enabled:true},perUserIntervalMs:0},memory,runtimeRoot:root,knowledge:createKnowledgeBase(),now:()=>start,model:{kind:'mock',generate:async r=>({status:'answer',text:'保存下来的实际答案',citations:[],model:r.model,reasoningEffort:r.reasoningEffort,billingRoute:r.billingRoute})},transport:{kind:'mock',send:async()=>({ok:true,verified:true,messageId:'actual-reply'})}});
 await bot.ingest({post_type:'message',message_type:'group',self_id:base.botId,group_id:groupId,user_id:user,message_id:'question',message:[{type:'at',data:{qq:base.botId}},{type:'text',data:{text:'解释测度代数是什么？'}}]});await bot.drain();
 const d=memory.socialMemoryQuery({action:'dialogue',messageId:'question'});assert.equal(d.question,'解释测度代数是什么？');assert.equal(d.replies[0].text,'保存下来的实际答案');assert.equal(d.replies[0].verified,1);assert.equal(memory.snapshot().items.length,0);
});
test('social-memory HTTP reads require the existing token and exact current group scope',async t=>{
 const root=await mkdtemp(join(tmpdir(),'social-api-')),token='fixture-social-memory-token-only';
 const hub=await createTeachingHub({config:{...base,socialMemory:{enabled:true}},runtimeRoot:root,token,autoDrain:false,knowledge:createKnowledgeBase(),model:{kind:'mock',generate:async()=>{throw Error('NO_MODEL');}},transport:{kind:'mock',send:async()=>{throw Error('NO_SEND');}}});t.after(()=>hub.close());const url=await hub.listen(0);
 const call=(body,auth=true)=>fetch(url+'/api/maintenance/social-memory',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 const request={groupId,persona:'axu',action:'stats'};assert.equal((await call(request,false)).status,403);assert.equal((await call({...request,groupId:'9999999999'})).status,404);assert.equal((await call({...request,path:'private'})).status,400);const r=await call(request);assert.equal(r.status,200);assert.equal((await r.json()).automaticExpiry,false);
});

test('quoted reply threads and a bounded same-member continuation are retained without authorizing a reply',async t=>{
 const f=await fixture(t);f.memory.observeHuman(f.event('root','最初的真实@提问'));f.memory.recordReply(f.event('root'),{text:'原回答',replyId:'bot-root',delivered:true,verified:true});
 f.setTime(start+1000);f.memory.observeHuman(f.event('followup','那再解释下一步',{hasSelfAtSegment:false}));assert.equal(f.memory.dialogue('followup').root_id,f.memory.dialogue('root').id);
 f.setTime(start+121000);f.memory.observeHuman(f.event('later','普通后续闲聊',{hasSelfAtSegment:false}));assert.equal(f.memory.dialogue('later'),null);
 f.memory.observeHuman(f.event('quote','引用原回答继续讨论',{senderId:'87654321',hasSelfAtSegment:false,replyTo:'bot-root'}));assert.equal(f.memory.dialogue('quote').root_id,f.memory.dialogue('root').id);
 f.memory.recordReply(f.event('quote','引用原回答继续讨论',{senderId:'87654321',hasSelfAtSegment:false,replyTo:'bot-root'}),{text:'实际允许的续聊回复',delivered:true,verified:true,replyId:'reply-followup'});assert.equal(f.memory.dialogue('quote').replies.length,1);
});

test('unattributed historical questions remain labelled without inventing which persona replied',async t=>{
 const f=await fixture(t);f.memory.observeHuman(f.event('unknown','关于测度代数的历史问题'),{historical:true,persona:'unknown'});
 for(const persona of ['axu','hui']){const rows=f.memory.recall({userId:user,persona,question:'测度代数'});assert.equal(rows.length,1);assert.equal(rows[0].personaAttribution,'unknown-question-target');assert.equal(rows[0].replyAvailable,false);assert.equal(f.memory.affinity(user,persona).score,50);}
});

test('prepared answer bodies survive a crash and the actual receipt upgrades the same attempt once',async t=>{
 const f=await fixture(t),e=f.event('prepared');f.memory.observeHuman(e);f.memory.recordReply(e,{text:'persist before sending',attemptId:'attempt',phase:'prepared'});f.memory.close();
 const restored=await SocialMemory.open(f.root,f.options);t.after(()=>restored.close());let d=restored.dialogue('prepared');assert.equal(d.replies.length,1);assert.equal(d.replies[0].phase,'prepared');assert.equal(d.replies[0].delivered,0);
 const result={text:'persist before sending',attemptId:'attempt',phase:'complete',delivered:true,verified:true,replyId:'confirmed'};restored.recordReply(e,result);restored.recordReply(e,result);d=restored.dialogue('prepared');assert.equal(d.replies.length,1);assert.equal(d.replies[0].verified,1);assert.equal(restored.affinity(user,'axu').score,50.3);
});
test('failed archive intake is not deduplicated as accepted and preparation precedes actual transport',async()=>{
 let fail=true,prepared=false,sent=0;const root=await mkdtemp(join(tmpdir(),'social-order-'));
 const memory={diagnostics:{},retainConversation:()=>{if(fail)throw Error('SOCIAL_MEMORY_WRITE_FAILED');return true;},prepareReply:()=>{prepared=true;},observeReply:()=>{},observeHuman:async()=>({accepted:0}),context:()=>null};
 const bot=new TeachingBot({config:{...base,perUserIntervalMs:0},memory,runtimeRoot:root,knowledge:createKnowledgeBase(),model:{kind:'mock',generate:async r=>({status:'answer',text:'fixture',citations:[],model:r.model,reasoningEffort:r.reasoningEffort,billingRoute:r.billingRoute})},transport:{kind:'mock',send:async()=>{assert.equal(prepared,true);sent++;return {ok:true,verified:true,messageId:'delivery'};}}});
 const event={post_type:'message',message_type:'group',self_id:base.botId,group_id:groupId,user_id:user,message_id:'retry',message:[{type:'at',data:{qq:base.botId}},{type:'text',data:{text:'解释序数'}}]};
 await assert.rejects(bot.ingest(event),/SOCIAL_MEMORY_WRITE_FAILED/);fail=false;assert.equal((await bot.ingest(event)).status,'queued');await bot.drain();assert.equal(sent,1);
});
