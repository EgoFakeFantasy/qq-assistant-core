import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {normalizeSecondary,secondaryForRequest,requestsGemini} from './provider-policy.mjs';
import {createPersonaRouter} from './persona-router.mjs';
import {TeachingBot} from './teaching-bot.mjs';import {createKnowledgeBase} from './knowledge.mjs';
const now=100000,prefix='回，验收 hui-fixture ',settings={enabled:false,name:'回',canary:{groupId:'1000000001',prefix,expiresAt:now+60000}};
const req={groupId:'1000000001',hasSelfAt:true,question:prefix+'你好',requestedPersona:'gemini'};
test('canary requires exact group, current direct mention, prefix and a bounded nonexpired window',()=>{
 assert.equal(normalizeSecondary(settings).enabled,false);assert.equal(secondaryForRequest(settings,req,now).enabled,true);
 for(const bad of [{...req,groupId:'1000000004'},{...req,hasSelfAt:false},{...req,question:'引用：'+req.question},{...req,question:'回，请普通回答'}])assert.equal(secondaryForRequest(settings,bad,now).enabled,false);
 assert.equal(secondaryForRequest(settings,req,settings.canary.expiresAt).enabled,false);
 assert.equal(secondaryForRequest({...settings,canary:{...settings.canary,expiresAt:now+31*60000}},req,now).enabled,false);
 assert.throws(()=>normalizeSecondary({...settings,canary:{...settings.canary,extra:true}}),/INVALID/);
});
test('disabled explicit Gemini request is rejected instead of silently using GPT',async()=>{
 let primary=0;const router=createPersonaRouter({settings:{enabled:false},primary:{generate:async()=>{primary++;}},now:()=>now});
 assert(requestsGemini('回，你好',{enabled:false},{hasSelfAt:true}));
 await assert.rejects(router.generate(req),/SECONDARY_NOT_ENABLED/);assert.equal(primary,0);
 await router.generate({...req,question:'普通消息',requestedPersona:null});assert.equal(primary,1);
});
test('only the canary reaches Gemini, and expired continued research cannot fall through to GPT',async()=>{
 let time=now,primary=0,secondary=0;const router=createPersonaRouter({settings,readSecondaryQuota:async()=>({argon:1,flash:1}),now:()=>time,readPrimaryQuota:async()=>({state:'unknown'}),primary:{generate:async()=>{primary++;}},secondary:{generate:async()=>{secondary++;return {status:'answer',text:'验收回复',citations:[],webSources:[]};}}});
 assert.equal((await router.generate(req)).provider,'antigravity');assert.equal(secondary,1);assert.equal(primary,0);
 time=settings.canary.expiresAt;await assert.rejects(router.generate(req),/SECONDARY_NOT_ENABLED/);assert.equal(primary,0);
});
test('QQ canary delivers Gemini identity with production switch still disabled',async()=>{
 const base=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));const sent=[];
 const router=createPersonaRouter({settings,readSecondaryQuota:async()=>({argon:1,flash:1}),now:()=>now,readPrimaryQuota:async()=>({state:'unknown'}),primary:{generate:async()=>{throw Error('NO_GPT');}},secondary:{generate:async()=>({status:'answer',text:'你好，我是回。',citations:[],webSources:[]})}});
 const bot=new TeachingBot({config:{...base,mode:'offline',secondaryPersona:settings,perUserIntervalMs:0},knowledge:createKnowledgeBase({pages:[]}),runtimeRoot:await mkdtemp(join(tmpdir(),'hui-canary-')),now:()=>now,model:{kind:'mock',generate:(...a)=>router.generate(...a)},transport:{kind:'mock',send:async m=>{sent.push(m);return {ok:true,messageId:'canary-reply'};}}});
 await bot.ingest({post_type:'message',message_type:'group',self_id:'2000000002',group_id:'1000000001',user_id:'12345678',message_id:881,message:[{type:'at',data:{qq:'2000000002'}},{type:'text',data:{text:req.question}}]});await bot.drain();
 assert.equal(bot.diagnostics.secondaryPersona.enabled,false);assert.equal(sent.length,1);assert.match(sent[0].text,/回.*Gemini/);assert.equal(bot.diagnostics.receipts[0].personaId,'gemini');
});
test('disabled QQ summon returns a clear status without any primary model call',async()=>{
 const base=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));const sent=[];let calls=0;
 const router=createPersonaRouter({settings:{enabled:false},primary:{generate:async()=>{calls++;}}});
 const bot=new TeachingBot({config:{...base,mode:'offline',secondaryPersona:{enabled:false},perUserIntervalMs:0},knowledge:createKnowledgeBase({pages:[]}),runtimeRoot:await mkdtemp(join(tmpdir(),'hui-disabled-')),model:{kind:'mock',generate:(...a)=>router.generate(...a)},transport:{kind:'mock',send:async m=>{sent.push(m);return {ok:true,messageId:'disabled-status'};}}});
 await bot.ingest({post_type:'message',message_type:'group',self_id:'2000000002',group_id:'1000000001',user_id:'12345678',message_id:882,message:[{type:'at',data:{qq:'2000000002'}},{type:'text',data:{text:'回，你好'}}]});await bot.drain();
 assert.equal(calls,0);assert.equal(sent.length,1);assert.match(sent[0].text,/尚未启用/);
});
