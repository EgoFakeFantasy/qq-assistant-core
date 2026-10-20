import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TeachingBot,validateProfile} from './teaching-bot.mjs';
import {createKnowledgeBase} from './knowledge.mjs';
import {createLiveOneBot} from './live-onebot.mjs';
import {LocalDurableState} from './local-durable-state.mjs';
import {configForAdditionalGroup,normalizeGroupReplyPolicy,hasDirectSelfMention} from './group-reply-policy.mjs';
import {QuestionWorkerPool} from './question-worker-pool.mjs';
import {createTeachingHub} from '../../src/app/teaching-hub.js';
const base=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));
const quiet='1000000004',allowed=[...new Set([...base.allowedGroupIds,quiet])];
const profile=(policy='mentions-only')=>({...base,mode:'offline',groupId:quiet,allowedGroupIds:allowed,replyPolicy:policy,perUserIntervalMs:0});
const event=(id,text,mention=false)=>({post_type:'message',message_type:'group',self_id:base.botId,group_id:quiet,user_id:'12345678',message_id:id,message:[...(mention?[{type:'at',data:{qq:base.botId}}]:[]),{type:'text',data:{text}}]});
const answer={status:'answer',text:'合成回复',citations:[],model:base.model,reasoningEffort:'high',billingRoute:'chatgpt-plan'};
async function fixture(config=profile(),extra={}){
 const root=await mkdtemp(join(tmpdir(),'qq-mention-only-')),sent=[],calls=[],files=[];
 const options={config,runtimeRoot:root,knowledge:createKnowledgeBase(),model:{kind:'mock',generate:async r=>{calls.push(r);return answer;}},transport:{kind:'mock',send:async m=>{sent.push(m);return {ok:true,messageId:'fixture-reply'};}},resources:{list:async()=>{files.push(true);return []; }},...extra};
 return {root,sent,calls,files,options,bot:new TeachingBot(options)};
}
test('per-group policy is strict, explicit and never leaks from one group to others',()=>{
 assert.equal(normalizeGroupReplyPolicy(),'adaptive');assert.throws(()=>normalizeGroupReplyPolicy('yes'),/INVALID/);assert.throws(()=>validateProfile({...profile(),replyPolicy:true}),/INVALID_GROUP_REPLY_POLICY/);
 const old=base.additionalGroups[0]||{groupId:'2000000002'};const root={...base,allowedGroupIds:[...new Set([...allowed,old.groupId])],replyPolicy:'mentions-only'};
 assert.equal(configForAdditionalGroup(root,{groupId:quiet,replyPolicy:'mentions-only'}).replyPolicy,'mentions-only');
 assert.equal(configForAdditionalGroup(root,old).replyPolicy,'adaptive');assert.throws(()=>configForAdditionalGroup(root,{groupId:'999999999'}),/UNAPPROVED/);
 assert(hasDirectSelfMention([{type:'at',data:{qq:base.botId}}],base.botId));assert(!hasDirectSelfMention([{type:'text',data:{text:'@'+base.botId}}],base.botId));
});
test('nonmentions including math, Gemini summons, commands, @all and quoted mentions never call a model or send',async()=>{
 const f=await fixture({...profile(),secondaryPersona:{enabled:true,name:'回',argonMinRemaining:0.2}});
 const inputs=[event(1,'请证明共尾度的定义'),event(2,'/gemini 请回答'),event(3,'Gemini，请解释集合论'),event(4,'/群文件 教材'),event(5,'/反馈 有帮助'),event(6,'@'+base.botId+' 回，请回答'),event(7,'x'.repeat(13000))];
 const all=event(8,'什么是集合论');all.message.unshift({type:'at',data:{qq:'all'}});inputs.push(all);
 const other=event(9,'请解释共尾度');other.message.unshift({type:'at',data:{qq:'87654321'}});inputs.push(other);
 const quoted=event(10,'解释这条引用');quoted.message.unshift({type:'reply',data:{id:'50'}});inputs.push(quoted);
 for(const e of inputs)assert.equal((await f.bot.ingest(e)).status,'context_only');
 await f.bot.drain();assert.equal(f.calls.length,0);assert.equal(f.files.length,0);assert.equal(f.sent.length,0);assert.equal(f.bot.diagnostics.queued,0);assert.equal(f.bot.diagnostics.autonomousTopicsEnabled,false);
});
test('a real self-mention replies and can use quiet group context; mention commands remain available',async()=>{
 const f=await fixture();await f.bot.ingest(event(1,'先讨论一个集合论定义'));
 assert.deepEqual(await f.bot.ingest(event(2,'解释一下刚才的内容',true)),{status:'queued',mandatory:true});await f.bot.drain();assert.equal(f.calls.length,1);assert(f.calls[0].context.some(x=>x.text==='先讨论一个集合论定义'));assert.equal(f.sent.length,1);assert.equal(f.sent[0].groupId,quiet);assert.equal(f.sent[0].replyTo,'2');
 await f.bot.ingest(event(3,'/群文件 教材',true));await f.bot.drain();assert.equal(f.files.length,1);assert.equal(f.sent.length,2);assert.equal(f.calls.length,1);
});
test('other groups retain adaptive topic replies',async()=>{
 const f=await fixture({...profile('adaptive'),groupId:base.groupId});const e={...event(1,'集合论的共尾度是什么？'),group_id:base.groupId};assert.equal((await f.bot.ingest(e)).status,'queued');await f.bot.drain();assert.equal(f.calls.length,1);assert.equal(f.sent.length,1);assert.equal(f.bot.diagnostics.autonomousTopicsEnabled,true);
});
test('restart drops old nonmentioned queued work even when it was previously a mandatory Gemini summon',async()=>{
 const f=await fixture({...profile('adaptive'),secondaryPersona:{enabled:true,name:'回',argonMinRemaining:0.2}});const store=new LocalDurableState(join(f.root,'state'),{groupId:quiet,botId:base.botId});
 const first=await TeachingBot.open({...f.options,store});assert.equal((await first.ingest(event(1,'/群文件 教材'))).status,'queued');assert.equal((await first.ingest(event(2,'/gemini 请解释'))).mandatory,true);
 const restarted=await TeachingBot.open({...f.options,config:profile(),store});await restarted.drain();assert.equal(f.calls.length,0);assert.equal(f.files.length,0);assert.equal(f.sent.length,0);assert.equal(restarted.diagnostics.queued,0);
});
function transportFixture(){let original={message_type:'group',message_id:42,group_id:quiet,sender:{user_id:'12345678'},message:[{type:'at',data:{qq:base.botId}}]};const calls=[];
 const transport=createLiveOneBot({baseUrl:'http://127.0.0.1:3000/',token:'fixture'.repeat(8),groupId:quiet,botId:base.botId,replyPolicy:'mentions-only',allowProactive:true,fetchFn:async(url,o)=>{const action=new URL(url).pathname;calls.push(action);const data=action==='/get_msg'?original:action==='/get_login_info'?{user_id:base.botId}:action==='/get_group_list'?[{group_id:quiet}]:{message_id:100};return {ok:true,json:async()=>({retcode:0,status:'ok',data})};}});
 return {transport,calls,setOriginal:v=>{original=v;},get original(){return original;}};
}
test('transport blocks proactive sends even with allowProactive true and refuses fabricated mention flags',async()=>{
 const f=transportFixture();await assert.rejects(f.transport.sendProactive({groupId:quiet,text:'自主推荐'}),/PROACTIVE/);assert.equal(f.calls.length,0);
 f.setOriginal({...f.original,message:[{type:'text',data:{text:'@'+base.botId+' 请回答'}}]});await assert.rejects(f.transport.send({groupId:quiet,replyTo:'42',text:'reply',hasSelfAt:true,images:[{path:'must-not-be-read.png'}]}),/MENTION_REQUIRED/);assert(!f.calls.includes('/send_group_msg'));
 await assert.rejects(f.transport.send({groupId:quiet,text:'reply'}),/MENTION_REQUIRED/);
});
test('transport verifies the original group, message and direct @ before inline or forward delivery',async()=>{
 const f=transportFixture(),valid=f.original;const message={groupId:quiet,replyTo:'42',text:'reply'};
 for(const original of [{...valid,group_id:base.groupId},{...valid,message_id:99},{...valid,message:[{type:'at',data:{qq:'all'}}]},{...valid,message:[{type:'reply',data:{id:'88'}}]}]){f.setOriginal(original);await assert.rejects(f.transport.send(message),/MENTION_REQUIRED/);}
 f.setOriginal(valid);assert.deepEqual(await f.transport.send(message),{ok:true,messageId:'100'});assert.equal(f.calls.filter(a=>a==='/send_group_msg').length,1);assert.equal(f.transport.diagnostics.replyPolicy,'mentions-only');
});
test('background worker refuses the restricted group but keeps normal group scheduling',async()=>{
 let quietRan=false,normalRan=false;const bot={diagnostics:{queued:0},peekJob:()=>null};const scopes=new Map([[quiet,{config:profile(),bot}],[base.groupId,{config:{...base,replyPolicy:'adaptive'},bot}]]);const pool=new QuestionWorkerPool(scopes);
 assert.equal(pool.runBackground(quiet,async()=>{quietRan=true;}),null);await pool.runBackground(base.groupId,async()=>{normalRan=true;});assert(!quietRan);assert(normalRan);
});
test('authenticated multi-group Hub exposes isolated policies and suppresses only the restricted group',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qq-policy-hub-')),sent=[];const config={...base,mode:'offline',allowedGroupIds:allowed,perUserIntervalMs:0};const knowledge=createKnowledgeBase();const model={kind:'mock',generate:async()=>answer};
 const scope=id=>({config:id===quiet?configForAdditionalGroup(config,{groupId:quiet,replyPolicy:'mentions-only'}):config,knowledge,model,runtimeRoot:id===quiet?join(root,'quiet'):root,transport:{kind:'mock',send:async m=>{sent.push(m);return {ok:true,messageId:'test-'+m.replyTo};}}});
 const primary=scope(base.groupId),hub=await createTeachingHub({...primary,additionalScopes:[scope(quiet)],token:'fixture-policy-token-0123456789',autoDrain:false});const url=await hub.listen(0);t.after(()=>hub.close());const headers={Authorization:'Bearer fixture-policy-token-0123456789','Content-Type':'application/json'};
 const post=async e=>(await fetch(url+'/api/onebot/event',{method:'POST',headers,body:JSON.stringify(e)})).json();
 assert.equal((await post(event(1,'集合论是什么？'))).status,'context_only');assert.equal((await post({...event(2,'集合论是什么？'),group_id:base.groupId})).status,'queued');assert.equal((await post(event(3,'请解释集合论',true))).status,'queued');await hub.drain();
 assert.equal(sent.filter(m=>m.groupId===quiet).length,1);assert.equal(sent.find(m=>m.groupId===quiet).replyTo,'3');assert.equal(sent.filter(m=>m.groupId===base.groupId).length,1);
 const state=await (await fetch(url+'/api/state',{headers})).json();assert.equal(state.groups.find(g=>g.groupId===quiet).replyPolicy,'mentions-only');assert.equal(state.groups.find(g=>g.groupId===quiet).autonomousTopicsEnabled,false);assert.equal(state.groups.find(g=>g.groupId===base.groupId).replyPolicy,'adaptive');
});
