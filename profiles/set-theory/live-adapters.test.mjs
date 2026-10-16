import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLiveOneBot} from './live-onebot.mjs';
import {createLiveModel} from './live-model.mjs';
import {createKnowledgeBase} from './knowledge.mjs';
import {TeachingBot} from './teaching-bot.mjs';
const config=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));

test('real transport verifies identity and membership before the only permitted send',async()=>{
 const calls=[];
 const transport=createLiveOneBot({baseUrl:'http://127.0.0.1:3000/',token:'fixture'.repeat(8),groupId:config.groupId,botId:config.botId,
  fetchFn:async(url,options)=>{const action=new URL(url).pathname;calls.push({action,body:JSON.parse(options.body)});
   return {ok:true,json:async()=>({status:'ok',retcode:0,data:action==='/get_login_info'?{user_id:config.botId}:action==='/get_group_list'?[{group_id:config.groupId}]:{message_id:42}})};}});
 assert.deepEqual(await transport.send({groupId:config.groupId,replyTo:'1',text:'Hello'}),{ok:true,messageId:'42'});
 assert.deepEqual(calls.map(c=>c.action),['/get_login_info','/get_group_list','/send_group_msg']);
 await assert.rejects(transport.send({groupId:'99999',replyTo:'1',text:'Hello'}),/SCOPE/);
 assert.equal(calls.length,3);
});

test('wrong logged-in account and nonloopback URLs fail closed',async()=>{
 assert.throws(()=>createLiveOneBot({baseUrl:'http://example.com/',token:'x'.repeat(32)}),/LOOPBACK/);
 assert.throws(()=>createLiveOneBot({baseUrl:'http://127.0.0.1:3000/path',token:'x'.repeat(32)}),/LOOPBACK/);
 let actions=0;const transport=createLiveOneBot({baseUrl:'http://127.0.0.1:3000/',token:'x'.repeat(32),groupId:config.groupId,botId:config.botId,
  fetchFn:async()=>{actions++;return{ok:true,json:async()=>({status:'ok',retcode:0,data:{user_id:'99999'}})}}});
 await assert.rejects(transport.send({groupId:config.groupId,replyTo:'1',text:'Hello'}),/WRONG_BOT/);assert.equal(actions,1);
});

test('live model uses memory-only plan auth and an isolated home with tools disabled',async()=>{
 const root=await mkdtemp(join(tmpdir(),'live-model-test-'));const authHome=join(root,'auth'),isolatedHome=join(root,'isolated');await mkdir(authHome);
 const token='fixture.'+Buffer.from(JSON.stringify({exp:4102444800})).toString('base64url')+'.fixture';
 await writeFile(join(authHome,'auth.json'),JSON.stringify({auth_mode:'chatgpt',OPENAI_API_KEY:null,tokens:{access_token:token,account_id:'fixture-account'}}));
 let options;const adapter=createLiveModel({codexPath:'fixture-no-process',authHome,isolatedHome,runTurn:async value=>{
  options=value;await value.prepareSession({request:async(method,params)=>method==='account/read'?{account:{type:'chatgpt'}}:{}});
  return{finalResponse:JSON.stringify({status:'answer',text:'fixture',citations:[]})};}});
 const answer=await adapter.generate({model:config.model,reasoningEffort:config.reasoningEffort,billingRoute:'chatgpt-plan',cwd:root,context:[],sources:[],question:'fixture',developerInstructions:'fixture'});
 assert.equal(answer.billingRoute,'chatgpt-plan');assert.equal(options.env.CODEX_HOME.slice(0,isolatedHome.length),isolatedHome);assert.notEqual(options.env.CODEX_HOME,isolatedHome);assert.equal(options.env.OPENAI_API_KEY,undefined);
 assert.match(options.baseInstructions,/不编造.*工具入口失败/);assert.match(options.baseInstructions,/参考书目由后台统一追加/);assert.equal(JSON.parse(options.prompt).capabilities.modelCanInvokeSearchTools,false);assert.equal(options.dynamicTools.length,0);assert.equal(options.webSearchMode,'disabled');assert.equal(options.sandbox,'read-only');
 assert(options.codexArgs.includes('shell_tool'));assert(options.codexArgs.includes('plugins'));assert.equal(adapter.diagnostics.completedCalls,1);
 await assert.rejects(adapter.generate({model:'cheap',reasoningEffort:'low'}),/MODEL_CONTRACT/);
});

test('PDF fi ligatures cannot hide cofinality from a Chinese query',()=>{
 const kb=createKnowledgeBase({pages:[{bookId:'a'.repeat(64),title:'Fixture',page:40,text:'The coﬁnality of an ordinal is defined by a coﬁnal sequence.'}]});
 assert.equal(kb.search('什么是共尾度？')[0].pdfPage,40);
});

test('live and offline adapters must match the explicitly selected mode',()=>{
 assert.throws(()=>new TeachingBot({config:{...config,mode:'live'},model:{kind:'mock'},transport:{kind:'mock'},runtimeRoot:tmpdir()}),/LIVE_ADAPTER/);
 assert.throws(()=>new TeachingBot({config,model:{kind:'live'},transport:{kind:'live'},runtimeRoot:tmpdir()}),/LIVE_ADAPTER/);
});
test('concurrent plan-auth reads are single-flight and concurrent questions use distinct runtime homes',async()=>{
 const {readPlanAuth}=await import('./live-model.mjs');
 const root=await mkdtemp(join(tmpdir(),'parallel-model-')),authHome=join(root,'auth'),isolatedHome=join(root,'isolated');await mkdir(authHome);
 const access='fixture.'+Buffer.from(JSON.stringify({exp:4102444800})).toString('base64url')+'.fixture';
 await writeFile(join(authHome,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:access,account_id:'fixture'}}));
 const first=readPlanAuth(authHome,'unused'),second=readPlanAuth(authHome,'unused');assert.equal(first,second);await first;
 const calls=[],done=[];const adapter=createLiveModel({codexPath:'unused',authHome,isolatedHome,runTurn:async options=>{
  calls.push(options);await new Promise(resolve=>done.push(resolve));return {finalResponse:JSON.stringify({status:'answer',text:'fixture',citations:[]})};
 }});
 const request={model:config.model,reasoningEffort:'high',billingRoute:'chatgpt-plan',context:[],sources:[],question:'fixture',developerInstructions:'fixture'};
 const jobs=[1,2,3].map(i=>adapter.generate({...request,cwd:join(root,'turn-'+i)}));
 try{for(let i=0;i<200&&calls.length<3;i++)await new Promise(r=>setTimeout(r,5));assert.equal(calls.length,3);
  assert.equal(new Set(calls.map(c=>c.env.CODEX_HOME)).size,3);
  for(const call of calls){assert.equal(call.model,'gpt-6.1-sol');assert.equal(call.reasoningEffort,'high');assert.equal(call.env.OPENAI_API_KEY,undefined);assert.equal(call.env.CODEX_HOME.startsWith(isolatedHome),true);assert.equal(call.codexArgs.includes('multi_agent'),true);}
 }finally{done.forEach(resolve=>resolve());await Promise.allSettled(jobs);}
 assert.equal(adapter.diagnostics.completedCalls,3);
});
