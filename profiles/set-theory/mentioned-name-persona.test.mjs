import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {normalizeSecondary,requestsGemini,requestsNamedSecondary,GEMINI_ROUTE} from './provider-policy.mjs';
import {createPersonaRouter} from './persona-router.mjs';
import {TeachingBot} from './teaching-bot.mjs';import {createKnowledgeBase} from './knowledge.mjs';
const settings={enabled:true,name:'回',activationMode:'mentioned-name'};
const base=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));
const request={model:'gpt-6.1-sol',reasoningEffort:'high',billingRoute:'chatgpt-plan',question:'普通问题',context:[],sources:[],developerInstructions:'保持数学严谨',groupId:'1000000001'};
function fixture(ready=true){const calls=[];let quotaReads=0;const router=createPersonaRouter({settings,primary:{diagnostics:{},generate:async r=>{calls.push('阿序');return {...r,status:'answer',text:'我是阿序。',citations:[],webSources:[]};}},secondary:ready?{generate:async r=>{calls.push('回');return {...r,status:'answer',text:'我是回。',citations:[],webSources:[]};}}:null,readPrimaryQuota:async()=>{quotaReads++;return {state:'exhausted',remaining:0};},readSecondaryQuota:async()=>({flash:0.8,argon:0.5})});return {router,calls,quotaReads:()=>quotaReads};}
test('named mention activation validates its explicit mode without changing the legacy default',()=>{assert.equal(normalizeSecondary().activationMode,'quota-or-explicit');assert.equal(normalizeSecondary(settings).activationMode,'mentioned-name');assert.throws(()=>normalizeSecondary({...settings,activationMode:'all-messages'}),/INVALID_SECONDARY_ACTIVATION_MODE/);});
test('Hui name summons require a boolean current self mention and an active address',()=>{
 const yes=['回','回，你好','回！解释一下','回 请看这个问题','回，不要加粗','请以回的身份回答','用回的人格来解释','请回解释共尾度','请问回，你看呢','我想让回回答','请以“回”的身份回答','“回”，你好','/回 解释一下'];
 for(const text of yes){assert(requestsNamedSecondary(text,settings,{hasSelfAt:true}),text);assert(requestsGemini(text,settings,{hasSelfAt:true}),text);assert(!requestsGemini(text,settings,{hasSelfAt:false}),text);assert(!requestsGemini(text,settings,{hasSelfAt:'true'}),text);}
 const no=['请回答这个问题','请回复我','请回来回答','回和阿序谁更好','你知道回是谁吗','不要让回回答','请不要让回出来','如果回回答会怎样','他说回，你好','请解释“回，你好”这句话','“回，你好”','\x60\x60\x60回，你好\x60\x60\x60','Gemini，请回答','/gemini 回答','请Argon来回答'];
 for(const text of no)assert(!requestsGemini(text,settings,{hasSelfAt:true}),text);
 assert(requestsNamedSecondary('小回-一，你好',{...settings,name:'小回-一'},{hasSelfAt:true}));
 assert.throws(()=>requestsNamedSecondary('回.，你好',{...settings,name:'回.'},{hasSelfAt:true}),/INVALID_SECONDARY_PERSONA/);
});
test('ordinary questions remain Axu even with exhausted quota or forged persona metadata',async()=>{const f=fixture();for(const change of [{},{requestedPersona:'gemini'},{hasSelfAt:true},{question:'回，你好',hasSelfAt:false},{question:'解释这句话',hasSelfAt:true,context:[{text:'回，你好'}],quotedMessage:{text:'回，你好'}}]){const answer=await f.router.generate({...request,...change});assert.equal(answer.text,'我是阿序。');assert.equal(answer.model,'gpt-6.1-sol');}assert.equal(f.quotaReads(),0);assert(f.calls.every(c=>c==='阿序'));assert.equal(await f.router.handleQuotaFailure(Object.assign(Error('usage limit reached'),{code:'usage_limit_reached'})),false);});
test('explicit current @ Hui reaches Gemini/high and is labeled as an invitation',async()=>{const f=fixture();const answer=await f.router.generate({...request,question:'回，你好',hasSelfAt:true});assert.equal(answer.personaId,'gemini');assert.equal(answer.model,'gemini-4-argon-high');assert.equal(answer.reasoningEffort,'high');assert.equal(answer.billingRoute,GEMINI_ROUTE);assert.equal(answer.routeReason,'explicit-request');assert.equal(f.quotaReads(),0);assert.deepEqual(f.calls,['回']);});
test('unavailable Gemini never silently substitutes Axu for a named summon',async()=>{const f=fixture(false);await assert.rejects(f.router.generate({...request,question:'回，你好',hasSelfAt:true}),/SECONDARY_NOT_READY/);assert.deepEqual(f.calls,[]);});
test('real event normalization chooses Hui only for current self @ and name; other replies use Axu',async()=>{
 const f=fixture(),sent=[],root=await mkdtemp(join(tmpdir(),'hui-mentioned-only-'));
 const bot=new TeachingBot({config:{...base,mode:'offline',secondaryPersona:settings,perUserIntervalMs:0},knowledge:createKnowledgeBase({pages:[]}),runtimeRoot:root,model:{kind:'mock',generate:(...args)=>f.router.generate(...args)},transport:{kind:'mock',send:async msg=>{sent.push(msg);return {ok:true,messageId:String(sent.length)};}}});
 const event=(id,text,at=base.botId)=>({post_type:'message',message_type:'group',self_id:base.botId,group_id:base.groupId,user_id:'12345678',message_id:id,message:[...(at?[{type:'at',data:{qq:at}}]:[]),{type:'text',data:{text}}]});
 await bot.ingest(event('1','回，你好'));await bot.drain();await bot.ingest(event('2','阿序，你好'));await bot.drain();await bot.ingest(event('3','请解释“回，你好”这句话'));await bot.drain();
 assert.deepEqual(f.calls,['回','阿序','阿序']);assert.match(sent[0].text,/回.*Gemini/);assert(sent[1].text.includes('阿序'));assert.equal((await bot.ingest(event('4','回，你好','7777777'))).status,'context_only');assert.equal(bot.diagnostics.secondaryPersona.activationMode,'mentioned-name');
});

test('unshipped browser providers cannot become an answering backend',async()=>{
 let browserCalls=0;const router=createPersonaRouter({settings:{enabled:true,name:'回',activationMode:'mentioned-name'},primary:{generate:async()=>{throw Error('NO_PRIMARY');}},webSecondary:{available:()=>true,generate:async()=>{browserCalls++;}}});
 await assert.rejects(router.generate({question:'回，你好',hasSelfAt:true}),/SECONDARY_NOT_READY/);assert.equal(browserCalls,0);
});
