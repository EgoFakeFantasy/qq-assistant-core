import {writeFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {explicitlyRequestsGemini,codexQuotaSnapshot,antigravityQuotaSnapshot,chooseGeminiModel,approvedAnswer,GEMINI_ROUTE} from './provider-policy.mjs';
import {createPlanQuotaReader} from './plan-quota.mjs';
import {createPersonaRouter} from './persona-router.mjs';
import {createBudgetedModelCaller} from './model-rate-backoff.mjs';
import {createAntigravityClient,runAntigravity,agyEnv,agyReadPermission,AGY_SETTINGS} from './antigravity-cli.mjs';
import {createKnowledgeModel} from './knowledge-model.mjs';
import {createKnowledgeBase} from './knowledge.mjs';
import {TeachingBot} from './teaching-bot.mjs';
import {LocalDurableState} from './local-durable-state.mjs';
const settings={enabled:true},base=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));base.mode='offline';
const request={model:'gpt-6.1-sol',reasoningEffort:'high',billingRoute:'chatgpt-plan',question:'证明一个集合论结论',context:[],sources:[],developerInstructions:'保持数学严谨'};
const quotaEnvelope=(flash=0.8,argon=0)=>({status:'SUCCESS',command:{data:{groups:[{name:'Gemini Models',buckets:[{remaining_fraction:flash},{remaining_fraction:1,disabled:true}]},{name:'Gemini 4 Argon',buckets:[{remaining_fraction:argon}]}]}}});
test('only current explicit requests summon the secondary; names, comparisons and negations do not',()=>{
 for(const s of ['/gemini 解释一下','请Gemini人格出来回答','/回 讲讲','Gemini，请解释共尾度','Argon 4来回答'])assert(explicitlyRequestsGemini(s,settings),s);
 for(const s of ['Gemini和GPT谁好','这个视频谈到了Gemini','不要让Gemini回答','Gemini能做什么？','如果Gemini来回答会怎样？','他说请Gemini出来回答','请解释“请Gemini来回答”这句话'])assert(!explicitlyRequestsGemini(s,settings),s);
 assert(!explicitlyRequestsGemini('/gemini 解释一下',{}));
});
test('quota interpretation separates unknown, disabled, expired, exact exhaustion and quota buckets',()=>{
 const now=100000;
 assert.equal(codexQuotaSnapshot({},now).state,'unknown');
 assert.equal(codexQuotaSnapshot({rateLimits:{limitId:'other',primary:{usedPercent:100,resetsAt:200}}},now).state,'unknown');
 assert.equal(codexQuotaSnapshot({rateLimitsByLimitId:{codex:{primary:{usedPercent:100,resetsAt:200}}}},now).state,'exhausted');
 assert.equal(codexQuotaSnapshot({rateLimits:{primary:{usedPercent:100,resetsAt:90}}},now).state,'unknown');
 assert.equal(codexQuotaSnapshot({rateLimits:{primary:{usedPercent:79,resetsAt:200}}},now).state,'available');
 const q=antigravityQuotaSnapshot(quotaEnvelope());assert.equal(q.flash,0.8);assert.equal(q.argon,0);
 assert.equal(chooseGeminiModel(q,settings),'gemini-3.8-flash-high');
 assert.equal(chooseGeminiModel({flash:0.8,argon:0.3},settings),'gemini-4-argon-high');
 assert.equal(chooseGeminiModel({flash:0.8,argon:0.1},settings),'gemini-3.8-flash-high');
 assert.throws(()=>chooseGeminiModel({flash:0,argon:0},settings),/EXHAUSTED/);
 assert.throws(()=>chooseGeminiModel({flash:null,argon:null},settings),/UNAVAILABLE/);
});
function router(available={state:'available',remaining:0.5}){
 const calls=[];const primary={kind:'live',diagnostics:{},generate:async r=>{calls.push('primary');return {...r,status:'answer',text:'main',citations:[]};}};
 const secondary={generate:async r=>{calls.push('secondary');return {...r,status:'answer',text:'side',citations:[]};}};
 const model=createPersonaRouter({primary,secondary,settings,readPrimaryQuota:async()=>available,readSecondaryQuota:async()=>({flash:0.8,argon:0})});
 return {model,calls,primary,secondary};
}
test('healthy Codex remains default while explicit Gemini bypasses it and can run alongside another question',async()=>{
 const r=router();const a=await r.model.generate(request);assert.equal(a.text,'main');
 const b=await r.model.generate({...request,question:'/gemini 解释一下'});assert.equal(b.personaId,'gemini');assert.equal(b.routeReason,'explicit-request');assert.match(b.developerInstructions,/活泼/);assert.equal(b.model,'gemini-3.8-flash-high');
 assert.deepEqual(r.calls,['primary','secondary']);assert(approvedAnswer(b,settings));assert(!approvedAnswer(b,{}));
 let release;const started=new Promise(r=>release=r);r.primary.generate=async()=>{await started;return {text:'main'};};
 const main=r.model.generate(request);const side=await r.model.generate({...request,requestedPersona:'gemini'});assert.equal(side.personaId,'gemini');release();await main;
});
test('authoritative zero routes to Gemini but unknown quota keeps using Codex',async()=>{
 const r=router({state:'exhausted',remaining:0,epoch:'reset-1'});const a=await r.model.generate(request);assert.equal(a.routeReason,'codex-exhausted');assert.equal(a.quotaEpoch,'reset-1');assert.deepEqual(r.calls,['secondary']);
 const unknown=router({state:'unknown'});await unknown.model.generate(request);assert.deepEqual(unknown.calls,['primary']);
});
test('only actual quota errors trigger one budget-counted switch; ordinary 429, timeout and auth do not',async()=>{
 const r=router();r.primary.generate=async()=>{r.calls.push('failed-primary');throw Object.assign(Error('usage limit reached'),{code:'usage_limit_reached'});};
 let charged=0;const caller=createBudgetedModelCaller({model:r.model,maxCalls:2,options:{onAdditionalModelCall:async()=>{charged++;}}});
 const a=await caller.call(request);assert.equal(a.personaId,'gemini');assert.equal(charged,1);assert.deepEqual(r.calls,['failed-primary','secondary']);assert.equal(caller.remainingCalls,0);
 for(const text of ['429 Too Many Requests','401 Unauthorized','TIMEOUT','schema invalid'])assert.equal(await router().model.handleQuotaFailure(Error(text)),false);
 const exhausted=router();exhausted.primary.generate=r.primary.generate;
 const one=createBudgetedModelCaller({model:exhausted.model,maxCalls:1});await assert.rejects(one.call(request),/usage limit/);
});
test('Gemini uses the same catalog, keyword search and original-page research loop',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gemini-knowledge-')),bookId='b'.repeat(64),citation=bookId.slice(0,12)+':p2';let n=0;const seen=[];
 const source={bookId,citation,title:'Synthetic cofinality',pdfPage:2,text:'The cofinality of a nonzero successor ordinal is one.',sourceType:'text-layer'};const knowledge={catalog:[{bookId,title:source.title,pages:2}],chapters:[],search:()=>[source],readPage:(id,n)=>id===bookId&&n===2?source:null};
 const model=createKnowledgeModel({knowledge,secondaryPersona:settings,readPrimaryQuota:async()=>({state:'exhausted',epoch:'fixture'}),antigravity:{executable:'agy.exe',isolatedHome:join(root,'home'),run:async opt=>{
  if(opt.args.includes('/usage'))return quotaEnvelope();
  const p=JSON.parse(opt.prompt);seen.push(p);
  if(n++===0)return {status:'SUCCESS',structured_output:{status:'research',text:'',citations:[],webSources:[],knowledgeRequests:[{tool:'knowledge_search',query:'cofinality',bookId,chapter:null,pages:[]}]}};
  return {status:'SUCCESS',structured_output:{status:'answer',text:'非零后继序数的共尾度是1。',citations:[citation],webSources:[],knowledgeRequests:[]}};
 }},isolatedHome:join(root,'codex-isolated'),authHome:join(root,'unused-auth'),codexPath:'must-not-run'});
 const a=await model.generate({...request,cwd:root,question:'请检索并读取原页证明后继序数共尾度'});
 assert.equal(a.personaId,'gemini');assert.equal(a.citations[0],citation);assert(a.knowledgeTrace.some(x=>x.tool==='knowledge_search'));assert(a.knowledgeTrace.some(x=>x.tool==='knowledge_read_pages'));assert.equal(seen.length,2);assert(seen[1].data.knowledgeProtocol.researchResults.length>0);
});
function event(id,text,user='12345678',at=true){return {post_type:'message',message_type:'group',self_id:base.botId,group_id:base.groupId,user_id:user,message_id:id,message:[...(at?[{type:'at',data:{qq:base.botId}}]:[]),{type:'text',data:{text}}]};}
function answer(extra={}){return {status:'answer',text:'这是合成测试回复。',citations:[],model:'gemini-3.8-flash-high',reasoningEffort:'high',billingRoute:GEMINI_ROUTE,provider:'antigravity',personaId:'gemini',routeReason:'explicit-request',quotaEpoch:'fixture',...extra};}
test('first explicit appearance is truthful, serialized across concurrent replies, and remembered after restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gemini-notice-')),sent=[];
 const config={...base,secondaryPersona:settings,perUserIntervalMs:0,perGroupConcurrency:2};
 const options={config,knowledge:createKnowledgeBase({pages:[]}),runtimeRoot:root,store:new LocalDurableState(join(root,'state'),{groupId:base.groupId,botId:base.botId}),model:{kind:'mock',generate:async()=>answer()},transport:{kind:'mock',send:async m=>{sent.push(m);await new Promise(r=>setTimeout(r,5));return {ok:true,messageId:String(sent.length)};}}};
 let bot=await TeachingBot.open(options);await bot.ingest(event('1','请Gemini来回答'));await bot.ingest(event('2','请回来回答','87654321'));const first=bot.startNext(),second=bot.startNext();await Promise.all([first,second]);
 assert.equal(sent.filter(m=>m.text.includes('【人格说明】')).length,1);assert(sent[0].text.includes('并不表示 Codex 额度耗尽'));assert.equal(bot.diagnostics.receipts[0].personaId,'gemini');
 bot=await TeachingBot.open(options);await bot.ingest(event('3','/gemini 再说一句'));await bot.drain();assert.equal(sent.filter(m=>m.text.includes('【人格说明】')).length,1);
});
test('quota switching has a distinct conspicuous statement even after an earlier explicit appearance',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gemini-exhausted-')),sent=[];let n=0;
 const bot=new TeachingBot({config:{...base,secondaryPersona:settings,perUserIntervalMs:0},knowledge:createKnowledgeBase({pages:[]}),runtimeRoot:root,model:{kind:'mock',generate:async()=>answer(n++?{routeReason:'codex-exhausted'}:{})},transport:{kind:'mock',send:async m=>{sent.push(m);return {ok:true,messageId:String(sent.length)};}}});
 await bot.ingest(event('1','/gemini 你好'));await bot.drain();await bot.ingest(event('2','解释这个概念'));await bot.drain();assert.match(sent[1].text,/额度与人格切换说明/);assert.match(sent[1].text,/可用额度已耗尽/);
});
test('an explicit unmentioned summon is answered, but a mention directed only to someone else remains context',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gemini-summon-'));const bot=new TeachingBot({config:{...base,secondaryPersona:settings},knowledge:createKnowledgeBase({pages:[]}),runtimeRoot:root,model:{kind:'mock',generate:async()=>answer()},transport:{kind:'mock',send:async()=>({ok:true,messageId:'1'})}});
 assert.equal((await bot.ingest(event('1','请Gemini出来回答','12345678',false))).mandatory,true);
 const e=event('2','请Gemini出来回答','87654321',false);e.message.unshift({type:'at',data:{qq:'7777777'}});assert.equal((await bot.ingest(e)).status,'context_only');await bot.drain();
});
test('isolated Antigravity settings deny native writes, commands, browser and third-party MCP; API keys are not inherited',async()=>{
 const root=await mkdtemp(join(tmpdir(),'agy-settings-'));
 const c=createAntigravityClient({executable:'agy.exe',isolatedHome:root,run:async r=>{assert.equal(r.args.includes('--dangerously-skip-permissions'),false);return quotaEnvelope();}});await c.readQuota();
 const env=agyEnv(root,{PATH:'fixture',GEMINI_API_KEY:'secret',OPENAI_API_KEY:'secret'});assert.equal(env.GEMINI_API_KEY,undefined);assert.equal(env.OPENAI_API_KEY,undefined);
 assert(AGY_SETTINGS.permissions.deny.includes('command(*)'));assert(AGY_SETTINGS.permissions.deny.includes('mcp(*)'));assert.equal(AGY_SETTINGS.useG1Credits,false);
});
test('CLI runner accepts only a successful terminal envelope and respects cancellation without a shell',async()=>{
 const root=await mkdtemp(join(tmpdir(),'agy-protocol-'));let options;
 const fake=(binary,args,opt)=>{writeFileSync(args[args.indexOf('--log-file')+1],'settings accepted');options=opt;const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{c.killed=true;};queueMicrotask(()=>{c.stdout.write(JSON.stringify({event:'result',result:{status:'SUCCESS',structured_output:{text:'ok'}}}));c.stdout.end();c.emit('close',0);});return c;};
 const v=await runAntigravity({executable:'fixture',home:root,cwd:root,args:[],prompt:'fixture',spawnProcess:fake});assert.equal(v.structured_output.text,'ok');assert.equal(options.shell,undefined);assert.equal(options.windowsHide,true);assert.equal(options.env.GEMINI_API_KEY,undefined);
 const config=JSON.parse(await readFile(join(root,'.gemini/antigravity-cli/settings.json'),'utf8'));assert.deepEqual(config,AGY_SETTINGS);
 const abort=new AbortController();abort.abort();await assert.rejects(runAntigravity({executable:'fixture',home:root,cwd:root,args:[],signal:abort.signal}),/ABORTED/);
});

test('a terminal stream result completes without waiting for process exit',async()=>{
 const root=await mkdtemp(join(tmpdir(),'agy-terminal-'));let child;
 const fake=(binary,args)=>{writeFileSync(args[args.indexOf('--log-file')+1],'settings accepted');child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.killed=true;};child.stdin.on('finish',()=>{const input=child.stdin.read().toString();assert.equal(input.endsWith('\n'),true);JSON.parse(input.trim());child.stdout.write(JSON.stringify({event:'result',result:{status:'SUCCESS',structured_output:{text:'ok'}}})+'\n');});return child;};
 const result=await runAntigravity({executable:'fixture',home:root,cwd:root,args:[],prompt:'fixture',spawnProcess:fake,timeoutMs:1000});assert.equal(result.structured_output.text,'ok');assert.equal(child.killed,true);
});
test('original images outside the question workspace cannot enter the secondary model',async()=>{
 const root=await mkdtemp(join(tmpdir(),'agy-image-')),cwd=join(root,'question'),outside=join(root,'outside.png');await mkdir(cwd);await writeFile(outside,'fixture');let called=false;
 const model=createAntigravityClient({executable:'agy.exe',isolatedHome:join(root,'home'),prepareImages:async()=>[{path:outside,citation:'fixture'}],run:async()=>{called=true;}});
 await assert.rejects(model.generate({...request,model:'gemini-3.8-flash-high',billingRoute:GEMINI_ROUTE,cwd}),/IMAGE_OUTSIDE_WORKSPACE/);assert.equal(called,false);
});

test('an empty or malformed successful CLI envelope is rejected before delivery',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'agy-empty-'));
 for(const envelope of [{status:'SUCCESS',response:''},{status:'SUCCESS',structured_output:{text:'missing status'}}]){
  const model=createAntigravityClient({executable:'agy.exe',isolatedHome:join(cwd,'home'),run:async()=>envelope});
  await assert.rejects(model.generate({...request,model:'gemini-3.8-flash-high',billingRoute:GEMINI_ROUTE,cwd}),/AGY_INVALID_OUTPUT/);
 }
});
test('Codex quota reads coalesce, cache and never start a model turn',async()=>{
 let starts=0;const methods=[];
 const fake=()=>{starts++;const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{};let buffer='';c.stdin.on('data',s=>{buffer+=s;let at;while((at=buffer.indexOf('\n'))>=0){const v=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);methods.push(v.method);if(v.id===1)queueMicrotask(()=>c.stdout.write(JSON.stringify({id:1,result:{}})+'\n'));if(v.id===2)queueMicrotask(()=>c.stdout.write(JSON.stringify({id:2,result:{rateLimitsByLimitId:{codex:{primary:{usedPercent:100,resetsAt:200}}}}})+'\n'));}});return c;};
 const read=createPlanQuotaReader({codexPath:'fixture',authHome:'fixture',spawnProcess:fake,now:()=>100000});const [a,b]=await Promise.all([read(),read()]);assert.equal(a.state,'exhausted');assert.deepEqual(a,b);await read();assert.equal(starts,1);assert.deepEqual(methods,['initialize','initialized','account/rateLimits/read']);
});

test('CLI settings rejection cannot masquerade as a successful quota or model result',async()=>{
 const root=await mkdtemp(join(tmpdir(),'agy-rejected-'));
 const fake=(binary,args)=>{writeFileSync(args[args.indexOf('--log-file')+1],'failed to load cli settings, using defaults: invalid settings');const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{};queueMicrotask(()=>{c.stdout.write(JSON.stringify({status:'SUCCESS',response:'invalid success'})+'\n');});return c;};
 await assert.rejects(runAntigravity({executable:'fixture',home:root,cwd:root,args:[],spawnProcess:fake}),/AGY_SETTINGS_REJECTED/);
});
test('CLI sparse persistence can omit only the two false default settings',async()=>{
 const root=await mkdtemp(join(tmpdir(),'agy-sparse-'));await mkdir(join(root,'.gemini','antigravity-cli'),{recursive:true});const file=join(root,'.gemini','antigravity-cli','settings.json');await writeFile(file,JSON.stringify({toolPermission:'strict',permissions:AGY_SETTINGS.permissions}));
 const fake=(binary,args)=>{writeFileSync(args[args.indexOf('--log-file')+1],'settings accepted');const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{};queueMicrotask(()=>c.stdout.write(JSON.stringify({status:'SUCCESS',response:'ok'})+'\n'));return c;};
 assert.equal((await runAntigravity({executable:'fixture',home:root,cwd:root,args:[],spawnProcess:fake})).response,'ok');await writeFile(file,JSON.stringify({toolPermission:'always-proceed',permissions:AGY_SETTINGS.permissions}));await assert.rejects(runAntigravity({executable:'fixture',home:root,cwd:root,args:[],spawnProcess:fake}),/SETTINGS_MISMATCH/);
});

test('CLI omitted request-review default is accepted only for the same exact image scope',async()=>{
 const root=await mkdtemp(join(tmpdir(),'agy-sparse-image-')),cwd=join(root,'question'),home=join(root,'home');await mkdir(cwd);const page=join(cwd,'page.png');await writeFile(page,'fixture');const dir=join(home,'.gemini','antigravity-cli');await mkdir(dir,{recursive:true});const file=join(dir,'settings.json'),permissions={...AGY_SETTINGS.permissions,allow:[agyReadPermission(page)]};
 const fake=(binary,args)=>{writeFileSync(args[args.indexOf('--log-file')+1],'settings accepted');const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{};queueMicrotask(()=>c.stdout.write(JSON.stringify({status:'SUCCESS',response:'ok'})+'\n'));return c;};
 const options={executable:'fixture',home,cwd,readRoot:cwd,readFiles:[page],args:[],spawnProcess:fake};
 await writeFile(file,JSON.stringify({permissions}));assert.equal((await runAntigravity(options)).response,'ok');
 await writeFile(file,JSON.stringify({toolPermission:'always-proceed',permissions}));await assert.rejects(runAntigravity(options),/SETTINGS_MISMATCH/);
 await writeFile(file,JSON.stringify({permissions:AGY_SETTINGS.permissions}));await assert.rejects(runAntigravity({...options,readFiles:[]}),/SETTINGS_MISMATCH/);
 await writeFile(file,JSON.stringify({permissions:{...permissions,allow:[agyReadPermission(cwd)]}}));await assert.rejects(runAntigravity(options),/SETTINGS_MISMATCH/);
});

test('concurrent questions have distinct secondary homes and only their own read grant',async()=>{
 const root=await mkdtemp(join(tmpdir(),'agy-scopes-')),one=join(root,'one'),two=join(root,'two');await Promise.all([mkdir(one),mkdir(two)]);const calls=[];
 const model=createAntigravityClient({executable:'agy.exe',isolatedHome:join(root,'home'),run:async opt=>{calls.push(opt);return {status:'SUCCESS',structured_output:{status:'answer',text:'fixture',citations:[]}};}});
 await Promise.all([one,two].map(cwd=>model.generate({...request,model:'gemini-3.8-flash-high',billingRoute:GEMINI_ROUTE,cwd})));
 assert.notEqual(calls[0].home,calls[1].home);for(const c of calls){assert.equal(c.readRoot,c.cwd);assert.equal(c.args[c.args.indexOf('--add-dir')+1],c.cwd);}
 const fake=(binary,args)=>{writeFileSync(args[args.indexOf('--log-file')+1],'settings accepted');const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{};queueMicrotask(()=>c.stdout.write(JSON.stringify({status:'SUCCESS',response:'ok'})+'\n'));return c;};
 for(const c of calls){await runAntigravity({...c,spawnProcess:fake});const saved=JSON.parse(await readFile(join(c.home,'.gemini','antigravity-cli','settings.json'),'utf8'));assert.equal(saved.permissions.allow,undefined);assert.deepEqual(c.readFiles,[]);assert(saved.permissions.deny.includes('write_file(*)'));}
});


test('a denied CLI tool fails closed before an empty SUCCESS or another tool step can be accepted',async()=>{
 const root=await mkdtemp(join(tmpdir(),'agy-denied-'));let child;const observed=[];
 const fake=(binary,args)=>{writeFileSync(args[args.indexOf('--log-file')+1],'settings accepted');child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.killed=true;};queueMicrotask(()=>{
  child.stdout.write(JSON.stringify({event:'step_update',step_update:{step_type:'tool',state:'ERROR',tool_info:{error:{type:'TOOL_ERROR',message:'permission check failed for read_file fixture: user denied permission'}}}})+'\n'+JSON.stringify({event:'result',result:{status:'SUCCESS',response:''}})+'\n');
 });return child;};
 await assert.rejects(runAntigravity({executable:'fixture',home:root,cwd:root,args:[],spawnProcess:fake,onProgress:e=>observed.push(e)}),/AGY_TOOL_PERMISSION_DENIED/);
 assert.equal(child.killed,true);assert.equal(observed.length,1);assert.equal(observed[0].errorCategory,'permission');
});

test('CLI image permissions name exact scoped files and normalize Windows drive letters',async()=>{
 const root=await mkdtemp(join(tmpdir(),'agy-exact-read-')),cwd=join(root,'question'),outside=join(root,'outside.png');await mkdir(cwd);const page=join(cwd,'page.png');await writeFile(page,'fixture');await writeFile(outside,'fixture');
 const fake=(binary,args)=>{writeFileSync(args[args.indexOf('--log-file')+1],'settings accepted');const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{};queueMicrotask(()=>c.stdout.write(JSON.stringify({status:'SUCCESS',response:'ok'})+'\n'));return c;};
 const home=join(root,'home');await runAntigravity({executable:'fixture',home,cwd,readRoot:cwd,readFiles:[page],args:[],spawnProcess:fake});const saved=JSON.parse(await readFile(join(home,'.gemini/antigravity-cli/settings.json'),'utf8'));
 assert.deepEqual(saved.permissions.allow,[agyReadPermission(page)]);assert.equal(saved.toolPermission,'request-review');assert.equal(saved.allowNonWorkspaceAccess,false);assert(!saved.permissions.allow.includes(agyReadPermission(cwd)));if(process.platform==='win32')assert(!/read_file\([A-Za-z]:/.test(saved.permissions.allow[0]));assert(saved.permissions.deny.includes('command(*)'));assert(saved.permissions.deny.includes('write_file(*)'));
 await assert.rejects(runAntigravity({executable:'fixture',home:join(root,'rejected'),cwd,readRoot:cwd,readFiles:[outside],args:[],spawnProcess:fake}),/READ_SCOPE/);
});
test('research rounds with different images do not overwrite earlier permission settings',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'agy-round-grants-'));const one=join(cwd,'one.png'),two=join(cwd,'two.png');await writeFile(one,'fixture');await writeFile(two,'fixture');let selected=one;const calls=[];
 const model=createAntigravityClient({executable:'agy.exe',isolatedHome:join(cwd,'home'),prepareImages:async()=>[{path:selected}],run:async opt=>{calls.push(opt);return {status:'SUCCESS',structured_output:{status:'answer',text:'fixture',citations:[]}};}});
 await model.generate({...request,model:'gemini-3.8-flash-high',billingRoute:GEMINI_ROUTE,cwd});selected=two;await model.generate({...request,model:'gemini-3.8-flash-high',billingRoute:GEMINI_ROUTE,cwd});assert.notEqual(calls[0].home,calls[1].home);assert.notEqual(calls[0].cwd,cwd);assert.notEqual(calls[1].cwd,cwd);assert.equal(await readFile(calls[0].readFiles[0],'utf8'),'fixture');assert.equal(await readFile(calls[1].readFiles[0],'utf8'),'fixture');
});


test('terminal denied actions cannot pass as successful CLI output',async()=>{
 const root=await mkdtemp(join(tmpdir(),'agy-terminal-denial-'));
 const fake=(binary,args)=>{writeFileSync(args[args.indexOf('--log-file')+1],'settings accepted');const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{};queueMicrotask(()=>c.stdout.write(JSON.stringify({status:'SUCCESS',response:'fake answer',denied_actions:['ViewFile']})+'\n'));return c;};
 await assert.rejects(runAntigravity({executable:'fixture',home:root,cwd:root,args:[],spawnProcess:fake}),/AGY_TOOL_PERMISSION_DENIED/);
});

test('a soft-denial log cannot pass as empty successful CLI output',async()=>{
 const root=await mkdtemp(join(tmpdir(),'agy-soft-denial-'));
 const fake=(binary,args)=>{writeFileSync(args[args.indexOf('--log-file')+1],'Print mode: soft-denying tool confirmation "ViewFile" at step 2');const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{};queueMicrotask(()=>c.stdout.write(JSON.stringify({status:'SUCCESS',response:''})+'\n'));return c;};
 await assert.rejects(runAntigravity({executable:'fixture',home:root,cwd:root,args:[],spawnProcess:fake}),/AGY_TOOL_PERMISSION_DENIED/);
});


test('native image workspace contains only current input images, not source files or CLI settings',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'agy-native-image-scope-')),page=join(cwd,'page.png');await writeFile(page,'scoped image fixture');await writeFile(join(cwd,'unrelated.txt'),'must not enter native workspace');let captured;
 const client=createAntigravityClient({executable:'agy.exe',isolatedHome:join(cwd,'cli-home'),prepareImages:async()=>[{path:page,citation:'fixture'}],run:async opt=>{captured=opt;return {status:'SUCCESS',structured_output:{status:'answer',text:'fixture',citations:[]}};}});
 await client.generate({...request,model:'gemini-3.8-flash-high',billingRoute:GEMINI_ROUTE,cwd});
 assert.notEqual(captured.cwd,cwd);assert.notEqual(captured.cwd,captured.home);assert.deepEqual(await readdir(captured.cwd),['page-1.png']);assert.equal(await readFile(captured.readFiles[0],'utf8'),'scoped image fixture');assert.deepEqual(JSON.parse(captured.prompt).scopedImageFiles,captured.readFiles);assert(captured.args.includes('--new-project'));
});
