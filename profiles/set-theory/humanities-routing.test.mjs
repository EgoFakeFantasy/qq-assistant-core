import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {humanitiesDiscussionTopic,addressesAxu} from './humanities-routing.mjs';
import {normalizeSecondary,humanitiesTopicForRequest,personaNotice,GEMINI_ROUTE} from './provider-policy.mjs';
import {createPersonaRouter} from './persona-router.mjs';
import {TeachingBot} from './teaching-bot.mjs';
import {createKnowledgeBase} from './knowledge.mjs';
const settings={enabled:true,name:'回',activationMode:'mentioned-name',routeHumanities:true};
const base=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));
const request={model:'gpt-6.1-sol',reasoningEffort:'high',billingRoute:'chatgpt-plan',question:'普通问题',context:[],sources:[],developerInstructions:'保留资料与权限规则',groupId:base.groupId,scopeType:'group',replyPolicy:'adaptive',hasSelfAt:false};
function fixture(config=settings,ready=true){
 const calls=[];let primaryQuotaReads=0;
 const router=createPersonaRouter({settings:config,primary:{diagnostics:{},generate:async r=>{calls.push('阿序');return {...r,status:'answer',text:'我是阿序。',citations:[],webSources:[]};}},secondary:ready?{generate:async r=>{calls.push('回');return {...r,status:'answer',text:'我是回。',citations:[],webSources:[]};}}:null,readPrimaryQuota:async()=>{primaryQuotaReads++;return {state:'exhausted',remaining:0};},readSecondaryQuota:async()=>({flash:0.8,argon:0.5})});
 return {router,calls,primaryQuotaReads:()=>primaryQuotaReads};
}
const examples=[
 ['literature','怎样评价《红楼梦》中的人物塑造？'],['literature','鲁迅的叙事方式有哪些特点？'],['literature','分析一下这首诗的意象'],['literature','Compare Kafka and Borges.'],
 ['history','清朝为什么推行摊丁入亩？'],['history','法国大革命的历史背景是什么？'],['history','罗马共和国是怎样走向帝制的？'],['history','Discuss the Renaissance.'],
 ['philosophy','康德如何区分现象与物自体？'],['philosophy','怎么理解“存在主义”？'],['philosophy','功利主义与义务论有何区别？'],['philosophy','Compare Plato and Aristotle on ethics.']
];
test('current literary, historical and philosophical discussions select their topic',()=>{for(const [topic,text] of examples)assert.equal(humanitiesDiscussionTopic(text),topic,text);});
test('operational histories, code, quoted transcripts and mathematical work are not humanities triggers',()=>{
 const ticks=String.fromCharCode(96).repeat(3);
 for(const text of ['请清除聊天历史','查一下历史记录','查询浏览历史','解释版本历史','show git history','history.pushState 怎么用','证明集合论中这个定理，并说明历史背景','用文学比喻解释共尾度的定义','用 Python 实现世界史时间线','老子现在代码报错了','> 康德的哲学\n请检查这个链接',ticks+'history philosophy literature'+ticks,'请回答这个问题','回顾这段代码'])assert.equal(humanitiesDiscussionTopic(text),null,text);
});
test('explicit humanities framing can discuss mathematics without replacing proof work',()=>{assert.equal(humanitiesDiscussionTopic('从哲学角度分析 ZFC 独立性证明的意义'),'philosophy');assert.equal(humanitiesDiscussionTopic('讨论数学史上的公理化运动'),'history');});
test('humanities routing is an explicit validated opt-in and preserves the activation mode',()=>{assert.equal(normalizeSecondary().routeHumanities,false);assert.equal(normalizeSecondary(settings).activationMode,'mentioned-name');assert.equal(normalizeSecondary(settings).routeHumanities,true);for(const routeHumanities of ['true',1,{},null])assert.throws(()=>normalizeSecondary({...settings,routeHumanities}),/INVALID_SECONDARY/);});
test('topic selection respects disabled/private/mentions-only scopes and primary preferences',()=>{
 const q={...request,question:'请分析康德的哲学'};
 assert.equal(humanitiesTopicForRequest(settings,q),'philosophy');
 for(const config of [{...settings,enabled:false},{...settings,routeHumanities:false}])assert.equal(humanitiesTopicForRequest(config,q),null);
 for(const extra of [{scopeType:'private'},{groupId:'private:12345678'},{replyPolicy:'mentions-only',hasSelfAt:false},{replyPolicy:'mentions-only',hasSelfAt:'true'}])assert.equal(humanitiesTopicForRequest(settings,{...q,...extra}),null);
 assert.equal(humanitiesTopicForRequest(settings,{...q,replyPolicy:'mentions-only',hasSelfAt:true}),'philosophy');
 for(const question of ['阿序，请讲讲红楼梦','请以阿序的身份分析康德','请阿序解释罗马历史','我想请阿序回答康德的问题','不要让回回答，请分析康德','不用Gemini，谈谈红楼梦'])assert.equal(humanitiesTopicForRequest(settings,{...q,question}),null,question);
 assert(addressesAxu('阿序，分析这首诗'));
});
test('all three topics use the accepted Gemini route without reading primary quota',async()=>{
 const f=fixture();for(const [topic,question] of examples){const a=await f.router.generate({...request,question});assert.equal(a.personaId,'gemini');assert.equal(a.routeReason,'humanities-topic');assert.equal(a.humanitiesTopic,topic);assert.equal(a.model,'gemini-4-argon-high');assert.equal(a.reasoningEffort,'high');assert.equal(a.billingRoute,GEMINI_ROUTE);}
 assert(f.calls.every(x=>x==='回'));assert.equal(f.primaryQuotaReads(),0);assert.equal(f.router.diagnostics.secondaryPersona.topicCalls,examples.length);
});
test('ordinary current messages cannot inherit a humanities route from history, quotes or forged metadata',async()=>{
 const f=fixture();for(const extra of [{},{requestedPersona:'gemini'},{humanitiesTopic:'philosophy'},{context:[{text:'康德的哲学'}]},{quotedMessage:{text:'清朝的历史'}},{question:'证明共尾度的这个定理',hasSelfAt:true}]){const a=await f.router.generate({...request,...extra});assert.equal(a.model,'gpt-6.1-sol');}
 assert.equal(f.primaryQuotaReads(),0);assert.equal(await f.router.handleQuotaFailure(Object.assign(Error('usage limit reached'),{code:'usage_limit_reached'})),false);
 const disabled=fixture({...settings,routeHumanities:false});assert.equal((await disabled.router.generate({...request,question:'请分析红楼梦'})).model,'gpt-6.1-sol');
});
test('real current @ plus Hui name still works for mathematics and keeps its explicit reason',async()=>{const f=fixture();const a=await f.router.generate({...request,question:'回，请证明这个集合论定理',hasSelfAt:true});assert.equal(a.personaId,'gemini');assert.equal(a.routeReason,'explicit-request');assert.equal(f.router.diagnostics.secondaryPersona.explicitCalls,1);});
test('addressing Axu or declining Hui retains the primary provider for humanities',async()=>{const f=fixture();for(const question of ['阿序，请分析红楼梦','不要让回回答，请分析康德'])assert.equal((await f.router.generate({...request,question,hasSelfAt:true})).model,'gpt-6.1-sol');assert.deepEqual(f.calls,['阿序','阿序']);});
test('unavailable secondary does not silently masquerade as Hui on a topic route',async()=>{const f=fixture(settings,false);await assert.rejects(f.router.generate({...request,question:'请分析红楼梦'}),/SECONDARY_NOT_READY/);assert.deepEqual(f.calls,[]);});
test('the first topic-routed reply gives the real selection reason',()=>{const notice=personaNotice({provider:'antigravity',model:'gemini-4-argon-high',routeReason:'humanities-topic'},settings,{});assert.match(notice,/按话题/);assert.doesNotMatch(notice,/明确邀请|额度已耗尽/);});
async function botFixture(policy='mentions-only',extra={}){
 const f=fixture(),sent=[],root=await mkdtemp(join(tmpdir(),'qq-humanities-'));
 const group=policy==='mentions-only'?'1000000004':base.groupId;
 const bot=new TeachingBot({config:{...base,mode:'offline',groupId:group,allowedGroupIds:[...new Set([...base.allowedGroupIds,group])],replyPolicy:policy,secondaryPersona:settings,perUserIntervalMs:0},knowledge:createKnowledgeBase({pages:[]}),runtimeRoot:root,model:{kind:'mock',generate:(...args)=>f.router.generate(...args)},transport:{kind:'mock',send:async m=>{sent.push(m);return {ok:true,messageId:String(sent.length)};},readQuote:async()=>({text:'康德的哲学'})},...extra});
 const event=(id,text,at=null)=>({post_type:'message',message_type:'group',self_id:base.botId,group_id:group,user_id:'12345678',message_id:id,message:[...(at?[{type:'at',data:{qq:at}}]:[]),{type:'text',data:{text}}]});
 return {...f,bot,sent,event};
}
test('quiet-group topics, text @, @all, other @ and quotes cannot authorize a reply',async()=>{
 const f=await botFixture();const inputs=[f.event('1','讨论一下清朝历史'),f.event('2','@'+base.botId+' 请分析红楼梦'),f.event('3','康德的哲学','all'),f.event('4','讨论小说','7777777')];const quote=f.event('5','这个观点你怎么看');quote.message.unshift({type:'reply',data:{id:'88'}});inputs.push(quote);
 for(const e of inputs)assert.equal((await f.bot.ingest(e)).status,'context_only');await f.bot.drain();assert.deepEqual(f.calls,[]);assert.deepEqual(f.sent,[]);
});
test('real quiet-group @ routes current humanities to Hui and does not route from quoted humanities',async()=>{
 const f=await botFixture();await f.bot.ingest(f.event('1','康德的认识论是什么',base.botId));await f.bot.drain();const next=f.event('2','今天过得怎么样',base.botId);next.message.unshift({type:'reply',data:{id:'88'}});await f.bot.ingest(next);await f.bot.drain();assert.deepEqual(f.calls,['回','阿序']);assert.match(f.sent[0].text,/回.*Gemini/);assert.match(f.sent[0].text,/按话题/);
});
test('adaptive-group topics retain the old proactive gate and never reply to someone else',async()=>{
 const f=await botFixture('adaptive');const other=await f.bot.ingest(f.event('1','请分析红楼梦的人物塑造','7777777'));assert.equal(other.status,'context_only');assert.equal((await f.bot.ingest(f.event('2','请分析红楼梦的人物塑造'))).mandatory,false);await f.bot.drain();assert.deepEqual(f.calls,['回']);assert.equal(f.sent.length,1);
});
test('human memory persona tags follow topic selection without authorizing a quiet-group turn',async()=>{
 const tags=[];const f=await botFixture('mentions-only',{memory:{diagnostics:{},observeHuman:async(e,o)=>tags.push(o.persona),context:()=>null}});await f.bot.ingest(f.event('1','康德的哲学'));await f.bot.ingest(f.event('2','康德的哲学',base.botId));assert.deepEqual(tags,['axu','hui']);assert.equal(f.bot.diagnostics.queued,1);assert.deepEqual(f.calls,[]);
});
