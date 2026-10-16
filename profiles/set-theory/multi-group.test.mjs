import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTeachingHub} from '../../src/app/teaching-hub.js';
import {createKnowledgeBase} from './knowledge.mjs';
import {LocalDurableState} from './local-durable-state.mjs';
const base=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));
const ids=['1000000001','1000000002','1000000003'];
base.allowedGroupIds=ids;
const token='multigroup-test-token-0123456789';
const event=(group,id,text='hello',mention=true)=>({post_type:'message',message_type:'group',self_id:base.botId,group_id:group,user_id:'12345678',message_id:id,message:[...(mention?[{type:'at',data:{qq:base.botId}}]:[]),{type:'text',data:{text}}]});
async function setup(t,root,overrides={}){
 root ||= await mkdtemp(join(tmpdir(),'qq-multigroup-'));
 const requests=[],sent=[],listed=[];
 const make=id=>({config:{...base,mode:'offline',groupId:id,perUserIntervalMs:0},runtimeRoot:id===base.groupId?root:join(root,'groups',id),knowledge:createKnowledgeBase(),
  model:{kind:'mock',generate:async r=>{requests.push({groupId:id,request:r});return {status:'answer',text:'**'+id+'** reply',citations:[],model:base.model,reasoningEffort:base.reasoningEffort,billingRoute:'chatgpt-plan'};}},
  transport:{kind:'mock',send:async m=>{assert.equal(m.groupId,id);sent.push(m);return {ok:true,messageId:'reply-'+id+'-'+m.replyTo};}},
  resources:{list:async()=>{listed.push(id);return [{name:'file-'+id+'.pdf',id:'gf-'+id,size:123,folder:''}];}}
 });
 const primary=make(ids[0]),hub=await createTeachingHub({...primary,additionalScopes:ids.slice(1).map(make),token,autoDrain:false,...overrides});
 const url=await hub.listen(0);t.after(()=>hub.close());
 const post=async body=>{const r=await fetch(url+'/api/onebot/event',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,202);return r.json();};
 const state=async()=>{const r=await fetch(url+'/api/maintenance',{headers:{authorization:'Bearer '+token}});return r.json();};
 return {hub,root,url,post,state,requests,sent,listed};
}
test('authenticated route accepts mentions in three approved groups and rejects all others',async t=>{
 const f=await setup(t);
 assert.equal((await fetch(f.url+'/api/onebot/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(event(ids[1],1))})).status,403);
 for(const id of ids)assert.deepEqual(await f.post(event(id,1,'private context '+id)),{status:'queued',mandatory:true});
 assert.equal((await f.post({...event('555555',2),group_name:'Example mathematics group',owner:true})).status,'ignored');
 assert.equal((await f.post({...event(ids[1],2),self_id:'555555'})).status,'ignored');
 await f.hub.drain();assert.equal(f.sent.length,3);
 for(const {groupId,request} of f.requests){assert.equal(request.mandatory,true);assert.equal(request.model,base.model);assert.equal(request.reasoningEffort,'high');assert.deepEqual(request.context.map(c=>c.text),['private context '+groupId]);assert.ok(!f.sent.find(m=>m.groupId===groupId).text.includes('**'));}
 const state=await f.state();assert.deepEqual(state.allowedGroupIds,ids);assert.equal(state.queued,0);assert.equal(state.active,0);assert.equal(state.modelCalls,3);
});
test('group files and reply targets stay bound to the source group',async t=>{
 const f=await setup(t);for(const id of ids)await f.post(event(id,22,'/群文件'));
 await f.hub.drain();assert.deepEqual([...f.listed].sort(),[...ids].sort());assert.equal(f.requests.length,0);
 for(const message of f.sent){assert.equal(message.replyTo,'22');assert.match(message.text,new RegExp('file-'+message.groupId));for(const other of ids.filter(x=>x!==message.groupId))assert.ok(!message.text.includes('file-'+other));}
});
test('same message ids remain independent and context and dedupe survive restart per group',async t=>{
 const first=await setup(t);for(const id of ids)await first.post(event(id,3,'remember '+id));await first.hub.drain();await first.hub.close();
 const second=await setup(t,first.root);
 for(const id of ids){assert.equal((await second.post(event(id,3))).status,'duplicate');assert.equal((await second.post(event(id,4,'next '+id))).status,'queued');}
 await second.hub.drain();assert.equal(second.requests.length,3);
 for(const {groupId,request} of second.requests){assert.ok(request.context.some(c=>c.text==='remember '+groupId));for(const other of ids.filter(x=>x!==groupId))assert.ok(!JSON.stringify(request.context).includes('remember '+other));}
});
test('persistent group identity mismatch fails closed and retains original bytes',async t=>{
 const f=await setup(t);await f.post(event(ids[1],9));await f.hub.drain();
 const path=join(f.root,'groups',ids[1],'state','teaching-state.json'),bytes=await readFile(path,'utf8');
 await assert.rejects(new LocalDurableState(join(f.root,'groups',ids[1],'state'),{groupId:ids[2]}).load(),/INVALID_STATE/);
 assert.equal(await readFile(path,'utf8'),bytes);
});

test('three real bot workers overlap while same-user questions remain ordered and receipts remain scoped',async t=>{
 const f=await setup(t),pending=new Map(),started=[];
 for(const scope of f.hub.scopes.values())scope.model.generate=async request=>{
  started.push({groupId:scope.config.groupId,id:request.messageId,user:request.context.at(-1).senderId});
  await new Promise(resolve=>pending.set(request.messageId,resolve));
  return {status:'answer',text:'answer '+request.messageId,citations:[],model:base.model,reasoningEffort:'high',billingRoute:'chatgpt-plan'};
 };
 const post=(group,id,user)=>f.post({...event(group,id),user_id:String(user)});
 await post(ids[0],101,111111);await post(ids[0],102,111111);await post(ids[0],103,222222);await post(ids[1],104,333333);await post(ids[2],105,444444);
 const waitFor=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('worker timeout');};
 const drained=f.hub.drain();
 const releaseTimer=setInterval(()=>{if(cleaning){for(const [key,done] of pending){pending.delete(key);done();}}},5);let cleaning=false;
 try{
  await waitFor(()=>started.length===3);const state=await f.state();assert.equal(state.active,3);assert.equal(state.queued,2);assert.equal(state.workers.concurrency,3);
  assert.ok(started.some(x=>x.id==='101'));assert.ok(!started.some(x=>x.id==='102'));
  const a=JSON.parse(await readFile(join(f.root,'state','teaching-state.json'),'utf8'));assert.equal(a.version,2);assert.ok(a.activeJobs.length>=1);
  pending.get('101')();pending.delete('101');await waitFor(()=>started.length===4);
  if(!pending.has('102')){const [key,done]=[...pending][0];done();pending.delete(key);await waitFor(()=>pending.has('102'));}
  assert.ok(f.sent.some(m=>m.replyTo==='101'));assert.ok(started.findIndex(x=>x.id==='101')<started.findIndex(x=>x.id==='102'));
 }finally{
  cleaning=true;
  for(let i=0;i<200;i++){for(const [key,done] of pending){pending.delete(key);done();}if((await f.state()).active===0)break;await new Promise(r=>setTimeout(r,5));}
  await drained;clearInterval(releaseTimer);
 }
 assert.equal(f.sent.length,5);assert.equal(new Set(f.sent.map(x=>x.replyTo)).size,5);
 for(const sent of f.sent)assert.equal(sent.groupId,started.find(x=>x.id===sent.replyTo).groupId);
});

test('worker pause endpoint remains authenticated and retains accepted queue',async t=>{
 const f=await setup(t);
 assert.equal((await fetch(f.url+'/api/maintenance/pause-workers',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
 const paused=await fetch(f.url+'/api/maintenance/pause-workers',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{}'});assert.equal(paused.status,200);
 await f.post(event(ids[0],301));await f.hub.drain();assert.equal((await f.state()).queued,1);assert.equal(f.sent.length,0);
 await f.hub.workers.resume();assert.equal(f.sent.length,1);
});

test('manual autonomous browse start is host-authenticated and cannot accept group or video overrides',async t=>{
 let starts=0;const f=await setup(t,null,{runAutonomousBrowse:()=>{starts++;return Promise.resolve();}});
 const route=f.url+'/api/maintenance/bilibili/run',options={method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{}'};
 assert.equal((await fetch(route,{...options,headers:{'content-type':'application/json'}})).status,403);
 assert.equal((await fetch(route,{...options,body:JSON.stringify({groupId:ids[1],bvid:'untrusted'})})).status,400);assert.equal(starts,0);
 assert.equal((await fetch(route,options)).status,202);assert.equal(starts,1);
});
