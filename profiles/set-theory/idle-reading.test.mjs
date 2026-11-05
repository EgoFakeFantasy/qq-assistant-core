import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBackgroundScheduler} from './background-scheduler.mjs';
import {QuestionWorkerPool} from './question-worker-pool.mjs';
import {createScholarSources} from './scholar-sources.mjs';
import {expandScholarSettings,scholarDomains} from './scholar-domains.mjs';
import {ScholarExplorer} from './scholar-explorer.mjs';
import {TeachingBot,validateProfile} from './teaching-bot.mjs';
import {LocalDurableState} from './local-durable-state.mjs';
import {createKnowledgeBase} from './knowledge.mjs';
const turn=()=>new Promise(r=>setImmediate(r));
const profile=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));
function schedulerFixture(t){
 let time=1800000000000;
 const scopes=new Map(['1000000001','1000000004'].map(groupId=>{
  const diagnostics={online:true,memberOfGroup:true,checkedAt:new Date(time).toISOString()};
  return [groupId,{config:{groupId,replyPolicy:'mentions-only'},bot:{diagnostics:{lastSelfMentionAt:time,queued:0},peekJob:()=>null},transport:{diagnostics,check:async()=>({...diagnostics})}}];
 }));
 const workers=new QuestionWorkerPool(scopes,{concurrency:3,perGroup:2,optional:2}),calls=[];
 const jobs=Object.fromEntries(['scholar','bilibili'].map(name=>[name,{due:true,run:async opts=>{calls.push({name,...opts});}}]));
 const scheduler=createBackgroundScheduler({workers,groupId:'1000000001',jobs,scopes,now:()=>time,intervalMs:86400000});t.after(()=>scheduler.close());
 return {scopes,workers,jobs,scheduler,calls,advance(ms){time+=ms;for(const s of scopes.values())s.transport.diagnostics.checkedAt=new Date(time).toISOString();},get now(){return time;}};
}
test('each online group uses its own 30-minute real-mention clock; jobs rotate read-only',async t=>{
 const f=schedulerFixture(t);f.scheduler.tick();await turn();assert.equal(f.calls.length,0);
 f.advance(1800000-1);f.scheduler.tick();await turn();assert.equal(f.calls.length,0);
 f.advance(1);f.scopes.get('1000000001').bot.diagnostics.lastSelfMentionAt=f.now;
 f.scheduler.tick();await turn();assert.equal(f.calls.length,1);assert.equal(f.calls[0].readOnly,true);assert.equal(f.calls[0].manual,false);assert.equal(typeof f.calls[0].onlineCheck,'function');
 f.jobs.scholar.due=false;f.scheduler.tick();await turn();assert.equal(f.calls[1].name,'bilibili');
 assert.equal(f.scheduler.diagnostics.groups.find(g=>g.groupId==='1000000001').eligible,false);
 assert.equal(f.scheduler.diagnostics.groups.find(g=>g.groupId==='1000000004').eligible,true);
});
test('offline, missing membership, stale health and queued human work block autonomous inference',async t=>{
 const f=schedulerFixture(t);f.advance(1800000);
 for(const s of f.scopes.values())s.transport.diagnostics.online=false;
 f.scheduler.tick();await turn();assert.equal(f.calls.length,0);
 for(const s of f.scopes.values()){s.transport.diagnostics.online=true;s.transport.diagnostics.memberOfGroup=false;}
 f.scheduler.tick();await turn();assert.equal(f.calls.length,0);
 for(const s of f.scopes.values()){s.transport.diagnostics.memberOfGroup=true;s.transport.diagnostics.checkedAt=new Date(f.now-90001).toISOString();}
 f.scheduler.tick();await turn();assert.equal(f.calls.length,0);
 f.advance(1);f.scopes.values().next().value.bot.diagnostics.queued=1;
 f.scheduler.tick();await turn();assert.equal(f.calls.length,0);
});
test('actual online probe wins over cached status; private scopes cannot sponsor reading',async t=>{
 const f=schedulerFixture(t);f.advance(1800000);
 for(const s of f.scopes.values())s.transport.check=async()=>({online:false,memberOfGroup:true});
 f.scheduler.tick();await turn();assert.equal(f.calls.length,0);
 for(const s of f.scopes.values())s.config.scopeType='private';
 f.scheduler.tick();await turn();assert.equal(f.calls.length,0);assert.equal(f.scheduler.diagnostics.groups.length,0);
});
test('only one shared background slot runs and a fresh sponsor mention cancels reading',async t=>{
 const f=schedulerFixture(t);f.advance(1800000);let signal;
 f.jobs.scholar.run=opts=>new Promise(resolve=>{signal=opts.signal;signal.addEventListener('abort',resolve,{once:true});});
 f.scheduler.tick();await turn();f.scheduler.tick();await turn();assert.equal(f.workers.diagnostics.activeBackground,1);assert.equal(f.calls.length,0);
 f.scopes.get('1000000001').bot.diagnostics.lastSelfMentionAt=f.now;
 f.scheduler.tick();await turn();assert.equal(signal.aborted,true);assert.equal(f.workers.diagnostics.activeBackground,0);
});
test('protected group read-only permission never enables manual public actions',async t=>{
 const f=schedulerFixture(t);assert.equal(f.scheduler.run('scholar',{manual:true}),null);
 assert.equal(f.workers.runBackground('1000000004',async()=>{}),null);
 assert.equal(f.workers.runBackground('unknown',async()=>{},{readOnly:true}),null);
 const task=f.workers.runBackground('1000000004',async()=>42,{readOnly:true});assert.equal(await task,42);
});
test('legacy manual scheduler retains its original action mode and target',async t=>{
 let actual;const scheduler=createBackgroundScheduler({groupId:'1000000001',workers:{runBackground:(id,fn)=>{assert.equal(id,'1000000001');return fn({signal:new AbortController().signal});}},jobs:{scholar:{due:false,run:async o=>{actual=o;}}},intervalMs:86400000});t.after(()=>scheduler.close());
 assert.equal(scheduler.run('scholar'),null);await scheduler.run('scholar',{manual:true});assert.equal(actual.manual,true);assert.equal(actual.readOnly,false);
});
test('philosophy source rotation selects correct journal without arXiv math filtering',async()=>{
 const requests=[];const sources=createScholarSources({minIntervalMs:0,fetchFn:async url=>{requests.push(String(url));return {bytes:Buffer.from(url.hostname==='api.crossref.org'?JSON.stringify({message:{items:[{DOI:'10.1234/example',title:['A philosophical argument']}]}}):'<feed></feed>')};}});
 const a=await sources.discover({domains:scholarDomains,cursor:1});assert.equal(a.candidates[0].source,'Continental Philosophy Review');assert.equal(requests.length,1);assert.match(requests[0],/1387-2842/);
 requests.length=0;const b=await sources.discover({domains:scholarDomains,cursor:2});assert.equal(b.candidates[0].source,'Philosophical Studies');assert.equal(requests.length,1);assert.match(requests[0],/0031-8116/);
 requests.length=0;await sources.discover({domains:scholarDomains,cursor:3});assert.ok(requests.some(u=>u.includes('export.arxiv.org')));
 await assert.rejects(sources.discover({domains:['forged']}),/SCHOLAR_DOMAINS_INVALID/);
});
test('new philosophy interests migrate into saved math-only reading state; read-only never sends',async()=>{
 const root=await mkdtemp(join(tmpdir(),'idle-scholar-'));let sent=0;
 const paper={id:'doi:10.1234/argument',doi:'10.1234/argument',title:'Argument',url:'https://example.org/argument',source:'Philosophical Studies'};
 const opts={root,config:{enabled:true,targetGroupId:'1000000001',intervalMs:1800000,maxSharesPerDay:2},transport:{check:async()=>({online:false}),sendProactive:async()=>{sent++;throw Error('NO_WRITES');}},sources:{discover:async()=>({candidates:[paper],sources:[]})},reader:{read:async()=>({paper,scope:'html-body',blocks:[{id:'section-1',text:'A philosophical argument supported by textual evidence. '.repeat(12)}]})},curator:{choose:async()=>({id:paper.id}),review:async()=>({summary:'Read the argument',interestScore:1,share:true,shareText:'An argument',evidence:[{blockId:'section-1',quote:'A philosophical argument supported'}]})}};
 await ScholarExplorer.open(opts);
 const expanded=expandScholarSettings({...opts.config,domains:scholarDomains});
 const reader=await ScholarExplorer.open({...opts,config:expanded});
 assert.ok(reader.diagnostics.interests.includes('phenomenology'));assert.ok(reader.diagnostics.interests.includes('epistemology'));
 const result=await reader.run({readOnly:true,onlineCheck:async()=>({online:true,memberOfGroup:true})});assert.equal(result.status,'complete');assert.equal(sent,0);
});
test('real current @ persists across restart; chatter, other @, old messages, duplicate and quoted @ do not reset clock',async()=>{
 let time=1800000000000;const root=await mkdtemp(join(tmpdir(),'idle-mentions-'));
 const options={config:profile,runtimeRoot:root,now:()=>time,model:{kind:'mock',generate:async()=>{throw Error('NO_MODEL');}},transport:{kind:'mock',send:async()=>{throw Error('NO_SEND');}},knowledge:createKnowledgeBase(),store:new LocalDurableState(join(root,'state'))};
 const bot=await TeachingBot.open(options),first=bot.diagnostics.lastSelfMentionAt;
 const event=(id,segments,extra={})=>({post_type:'message',message_type:'group',self_id:profile.botId,group_id:profile.groupId,user_id:'12345678',message_id:id,message:segments,...extra});
 const text={type:'text',data:{text:'今天吃面'}},at={type:'at',data:{qq:profile.botId}};
 time+=10000;await bot.ingest(event('plain',[text]));await bot.ingest(event('other',[{type:'at',data:{qq:'11111111'}},text]));
 await bot.ingest(event('quoted',[{type:'reply',data:{id:'123'}},text],{raw_message:'[CQ:at,qq='+profile.botId+']'}));
 await bot.ingest(event('old',[at,text],{time:(time-120001)/1000}));assert.equal(bot.diagnostics.lastSelfMentionAt,first);
 time+=10000;await bot.ingest(event('new',[at,text]));const latest=time;assert.equal(bot.diagnostics.lastSelfMentionAt,latest);
 time+=10000;await bot.ingest(event('new',[at,text]));assert.equal(bot.diagnostics.lastSelfMentionAt,latest);
 const restored=await TeachingBot.open(options);assert.equal(restored.diagnostics.lastSelfMentionAt,latest);
});
test('idle window validation cannot silently become immediate or malformed',()=>{
 for(const idleReading of [null,{enabled:true,afterMs:1},{enabled:'true',afterMs:1800000}])assert.throws(()=>validateProfile({...profile,idleReading}),/INVALID_IDLE_READING_CONFIG/);
});

test('shortening the scholar interval migrates a saved three-hour deadline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'scholar-cadence-')),now=1800000000000;
 const opts={root,now:()=>now,config:{enabled:true,targetGroupId:'1000000001',intervalMs:10800000,maxSharesPerDay:0},curator:{},transport:{},sources:{},reader:{}};
 await ScholarExplorer.open(opts);const path=join(root,'scholar-state.json'),state=JSON.parse(await readFile(path,'utf8'));state.nextRunAt=now+10800000;await writeFile(path,JSON.stringify(state));
 const migrated=await ScholarExplorer.open({...opts,config:{...opts.config,intervalMs:1800000}});assert.equal(migrated.diagnostics.nextRunAt,now+1800000);
});
