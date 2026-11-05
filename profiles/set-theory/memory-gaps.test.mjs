import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {anchorMeaning,groupAnchorEvidence} from './memory-anchor-semantics.mjs';
import {SocialMemory} from './social-memory.mjs';
import {LongTermMemory,extractMemoryCandidates} from './long-term-memory.mjs';
import {createLiveOneBot} from './live-onebot.mjs';
import {TeachingBot} from './teaching-bot.mjs';
import {createKnowledgeBase} from './knowledge.mjs';
const base=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));
const groupId=base.groupId,user='12345678',start=1800000000000,day=86400000;
const item=(n,text,extra={})=>({id:'m-'+n.toString(16).padStart(24,'0'),scope:groupId,subjectId:user,persona:'axu',kind:'preference',status:'reported',text,evidence:[{messageId:String(n),at:start+(n-1)*day}],conflictsWith:[],...extra});
async function fixture(t){let now=start;const root=await mkdtemp(join(tmpdir(),'memory-gaps-'));const memory=await SocialMemory.open(root,{groupId,now:()=>now});t.after(()=>memory.close());for(let i=0;i<12;i++){now=start+Math.floor(i/6)*day;memory.observeHuman({groupId,senderId:user,text:'activity',hasSelfAtSegment:false,at:now,raw:{message_id:'activity'+i}});}return {root,memory,options:{groupId,now:()=>now}};}

test('paraphrased preference anchors preserve each original text and witness across rebuild and restart',async t=>{
 const f=await fixture(t),a=item(1,'我喜欢用例子理解定义。'),b=item(2,'我偏好通过实例来理解定义。');
 f.memory.syncEvidence([a,b]);f.memory.maintain({online:true,force:true});let card=f.memory.card(user,'axu');
 assert.equal(card.anchors.length,1);assert.equal(card.anchors[0].independentPeriods,2);assert.deepEqual(new Set(card.anchors[0].sourceItemIds),new Set([a.id,b.id]));
 assert.deepEqual(new Set(card.anchors[0].variants.map(v=>v.text)),new Set([a.text,b.text]));assert.deepEqual(card.anchors[0].evidenceIds,['1','2']);
 assert.equal(f.memory.card(user,'hui').anchors.length,0);f.memory.close();
 // Simulate a pre-upgrade clean card: opening the new rule must queue rebuild.
 const db=new DatabaseSync(join(f.root,'memory.sqlite'));db.exec("DELETE FROM metadata WHERE key='anchor-rules'; UPDATE members SET dirty=0; DELETE FROM cards");db.close();
 const restored=await SocialMemory.open(f.root,f.options);t.after(()=>restored.close());assert.equal(restored.maintain({online:true,force:true}).updated,1);card=restored.card(user,'axu');assert.equal(card.anchors.length,1);assert.equal(restored.diagnostics.evidenceAnchors,2);
});

test('opposite paraphrases become a conflict with all evidence instead of a preference anchor',async t=>{
 const f=await fixture(t);f.memory.syncEvidence([item(1,'我喜欢用例子理解定义'),item(2,'我偏好通过实例来理解定义'),item(3,'我不喜欢用示例理解定义')]);f.memory.maintain({online:true,force:true});
 const card=f.memory.card(user,'axu');assert.equal(card.anchors.length,0);assert.equal(card.conflicts.length,1);assert.equal(card.conflicts[0].variants.length,3);assert.equal(card.conflicts[0].evidenceIds.length,3);
});

test('semantic grouping preserves subjects negation quantifiers mathematical notation and scope',()=>{
 const variants=['我喜欢用反例理解定义','我喜欢用例子理解定理','我喜欢用例子理解所有定义','我喜欢不用例子理解定义','我喜欢用例子理解定义，但不喜欢用例子理解证明','我喜欢A B','我喜欢AB','我喜欢a B'];
 const key=t=>anchorMeaning('preference',t).family;assert.equal(new Set(variants.map(key)).size,variants.length);
 const a=item(1,'我喜欢用例子理解定义'),b=item(2,'我偏好通过实例理解定义');
 for(const extra of [{scope:'999999999'},{subjectId:'87654321'},{persona:'hui'}])assert.equal(groupAnchorEvidence([a,{...b,...extra}]).length,2);
 assert.notEqual(key('他说我喜欢用例子理解定义'),key(a.text));
});

test('duplicate witnesses and a four-hour bucket boundary cannot create independent observations',()=>{
 const a=item(1,'我喜欢用例子理解定义'),b=item(2,'我偏好通过实例理解定义',{evidence:[{messageId:'1',at:start+day}]});assert.equal(groupAnchorEvidence([a,b])[0].independentPeriods,1);
 const boundary=Math.ceil(start/(4*3600000))*4*3600000;
 assert.equal(groupAnchorEvidence([{...a,evidence:[{messageId:'a',at:boundary-1}]},{...b,evidence:[{messageId:'b',at:boundary+1}]}])[0].independentPeriods,1);
});

test('framing and unresolved-topic paraphrases share anchors without changing topic meaning',()=>{
 const style=['不要每次反复限定，过度框定污染理解','你回答不要每次用多余的免责声明'];
 assert.equal(groupAnchorEvidence(style.map((text,i)=>item(i+1,text,{kind:'style_feedback'}))).length,1);
 const open=['测度代数的同构问题还没解决','测度代数的同构问题尚未解决'];assert.equal(groupAnchorEvidence(open.map((text,i)=>item(i+1,text,{kind:'open_question'}))).length,1);
 assert.notEqual(anchorMeaning('open_question',open[0]).family,anchorMeaning('open_question','测度代数的嵌入问题尚未解决').family);
});

test('durable evidence keeps witnesses removed by the older 32-entry factual-memory window',async t=>{
 const f=await fixture(t),a=item(1,'我喜欢用例子理解定义');f.memory.syncEvidence([a]);f.memory.syncEvidence([{...a,evidence:Array.from({length:32},(_,i)=>({messageId:'new'+i,at:start+i*1000}))}]);f.memory.maintain({online:true,force:true});f.memory.close();
 const db=new DatabaseSync(join(f.root,'memory.sqlite'),{readOnly:true});t.after(()=>db.close());const saved=JSON.parse(db.prepare('SELECT payload FROM evidence').get().payload);assert.equal(saved.evidence.length,33);assert(saved.evidence.some(e=>e.messageId==='1'));
});

test('live extraction stores paraphrases and later prompt context retrieves the anchor without copying its full variants',async t=>{
 const root=await mkdtemp(join(tmpdir(),'anchor-context-'));let now=start;
 const memory=await LongTermMemory.open(root,{groupId,socialMemory:true,now:()=>now});t.after(()=>memory.close());
 for(let i=0;i<12;i++){now=start+Math.floor(i/6)*day;await memory.observeHuman({groupId,senderId:user,text:i===0?'我喜欢用例子理解定义':i===6?'我偏好通过实例来理解定义':'普通活动',hasSelfAtSegment:true,at:now,raw:{message_id:String(i)}});}
 assert.equal(extractMemoryCandidates('我更习惯用示例看懂定义')[0]?.type,'preference');
 memory.maintainSocialMemory(true);const context=memory.context({userId:user,persona:'axu',question:'回忆学习偏好',excludeMessageId:'later'});
 assert.equal(context.memberCard.anchors.length,1);assert.equal(context.memberCard.anchors[0].variants,undefined);assert.equal(context.memberCard.anchors[0].evidenceIds.length,2);
 assert.equal(memory.context({userId:user,persona:'axu',question:'当前问题',excludeMessageId:'0'}).memberCard.anchors.length,0);
});

function transportFixture({mutate=m=>m,fail=false,replyPolicy,hang=false}={}){
 const calls=[];let sent;
 const transport=createLiveOneBot({baseUrl:'http://127.0.0.1:3000/',token:'fixture'.repeat(8),groupId,botId:base.botId,replyPolicy,fetchFn:async(url,o)=>{
  const action=new URL(url).pathname,body=JSON.parse(o.body);calls.push(action);
  if(action==='/get_msg'&&String(body.message_id)==='1'&&replyPolicy==='mentions-only')return {ok:true,json:async()=>({status:'ok',retcode:0,data:{message_type:'group',group_id:groupId,message_id:1,sender:{user_id:user},message:[{type:'at',data:{qq:base.botId}}]}})};
  if(action==='/get_msg'&&hang)return new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}));
  if(action==='/get_msg'&&fail)throw Error('READBACK_UNAVAILABLE');
  const data=action==='/get_login_info'?{user_id:base.botId}:action==='/get_group_list'?[{group_id:groupId}]:action==='/send_group_msg'?(sent=body.message,{message_id:42}):mutate({message_type:'group',group_id:groupId,message_id:42,sender:{user_id:base.botId},message:sent});
  return {ok:true,json:async()=>({status:'ok',retcode:0,data})};
 }});return {transport,calls};
}

test('short real transport path reads its own sent message and credits the archived answer once',async t=>{
 const root=await mkdtemp(join(tmpdir(),'inline-affinity-'));const memory=await LongTermMemory.open(join(root,'memory'),{groupId,socialMemory:true,now:()=>start});t.after(()=>memory.close());const f=transportFixture({replyPolicy:'mentions-only'});
 const bot=new TeachingBot({config:{...base,mode:'live',replyPolicy:'mentions-only',socialMemory:{enabled:true},perUserIntervalMs:0},memory,runtimeRoot:root,now:()=>start,knowledge:createKnowledgeBase(),transport:f.transport,model:{kind:'live',generate:async r=>({status:'answer',text:'序数按传递性定义。',citations:[],model:r.model,reasoningEffort:r.reasoningEffort,billingRoute:r.billingRoute})}});
 const event={post_type:'message',message_type:'group',self_id:base.botId,group_id:groupId,user_id:user,message_id:1,message:[{type:'at',data:{qq:base.botId}},{type:'text',data:{text:'解释序数的定义？'}}]};await bot.ingest(event);await bot.drain();await bot.ingest(event);await bot.drain();
 const d=memory.socialMemoryQuery({action:'dialogue',messageId:'1'});assert.equal(d.replies.length,1);assert.equal(d.replies[0].delivered,1);assert.equal(d.replies[0].verified,1);assert.equal(f.calls.filter(a=>a==='/send_group_msg').length,1);assert.equal(f.transport.diagnostics.inlineReadbacks,1);
 const ctx=memory.context({userId:user,persona:'axu',question:'上次序数定义',excludeMessageId:'later'});assert.equal(ctx.archivedDialogues[0].replyVerified,true);assert.equal(ctx.memberCard,null);
 const affinity=memory.socialMemoryQuery({action:'card',userId:user,persona:'axu'}).affinity;assert.equal(affinity.basis,1);assert(affinity.score>50&&affinity.score<51);
});

test('wrong identity scope receipt body images or reply linkage keep short sends unverified without retransmission',async()=>{
 for(const mutate of [m=>({...m,group_id:'999999999'}),m=>({...m,sender:{user_id:user}}),m=>({...m,message_id:43}),m=>({...m,message:[{type:'text',data:{text:'truncated'}}]}),m=>({...m,message:[...m.message,{type:'image',data:{file:'x'}}]}),m=>({...m,message:[{type:'reply',data:{id:'other'}},...m.message]}),m=>({...m,message:'invalid'})]){
  const f=transportFixture({mutate});const r=await f.transport.send({groupId,replyTo:'1',text:'short'});assert.equal(r.ok,true);assert.equal(r.verified,false);assert.equal(f.calls.filter(a=>a==='/send_group_msg').length,1);assert.equal(f.transport.diagnostics.inlineVerificationFailures,1);
 }
});

test('readback failure or bounded timeout retains the delivery receipt and never sends twice',async()=>{
 for(const options of [{fail:true},{hang:true}]){const f=transportFixture(options);const r=await f.transport.send({groupId,replyTo:'1',text:'short'});assert.deepEqual(r,{ok:true,messageId:'42',deliveryMode:'inline',verified:false});assert.equal(f.calls.filter(a=>a==='/send_group_msg').length,1);}
});
