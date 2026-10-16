import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalDurableState } from './local-durable-state.mjs';
import { TeachingBot, MODEL, EFFORT } from './teaching-bot.mjs';
import { createKnowledgeBase } from './knowledge.mjs';
const profile=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));
const message=id=>({post_type:'message',message_type:'group',group_id:profile.groupId,self_id:profile.botId,user_id:'12345678',message_id:id,message:[{type:'at',data:{qq:profile.botId}},{type:'text',data:{text:'解释序数'}}]});
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'qq-durable-')); const sent=[]; let now=Date.UTC(2026,9,11);
  const options={config:{...profile,dailyModelCalls:1},runtimeRoot:join(root,'turns'),knowledge:createKnowledgeBase(),
    now:()=>now,sleep:async ms=>{now+=ms;},
    model:{kind:'mock',generate:async()=>({status:'answer',text:'mock',citations:[],model:MODEL,reasoningEffort:EFFORT,billingRoute:'chatgpt-plan'})},
    transport:{kind:'mock',send:async msg=>{sent.push(msg);return{ok:true,messageId:'sent'};}}};
  return {root,options,sent,store:()=>new LocalDurableState(join(root,'state'))};
}
test('accepted queue, deduplication and budget survive orderly restart',async()=>{
  const f=await fixture(); const first=await TeachingBot.open({...f.options,store:f.store()});
  await first.ingest(message(1));
  const second=await TeachingBot.open({...f.options,store:f.store()});
  assert.equal((await second.ingest(message(1))).status,'duplicate');
  await second.drain(); assert.equal(f.sent.length,1);
  const third=await TeachingBot.open({...f.options,store:f.store()});
  await third.ingest(message(2)); await third.drain(); assert.match(f.sent[1].text,/DAILY_BUDGET/);
});
test('in-flight generation resumes but an uncertain send is held instead of duplicated',async()=>{
  for(const phase of ['generating','sending']) {
    const f=await fixture(); const first=await TeachingBot.open({...f.options,store:f.store()}); await first.ingest(message(1));
    const store=f.store(); const state=await store.load(); state.version=1;delete state.activeJobs;state.active={job:state.queue.shift(),phase}; await store.save(state);
    const recovered=await TeachingBot.open({...f.options,store:f.store()}); await recovered.drain();
    assert.equal(f.sent.length,phase==='generating'?1:0);
    if(phase==='sending')assert.equal(recovered.diagnostics.receipts[0].status,'delivery_uncertain_after_restart');
  }
});
test('corrupt state is preserved and cannot be silently overwritten',async()=>{
  const f=await fixture(); const store=f.store(); await store.load(); const path=join(f.root,'state','teaching-state.json');
  await writeFile(path,'{broken'); await assert.rejects(store.load());
  assert.equal(await readFile(path,'utf8'),'{broken');
});
test('state validation rejects wrong group and oversized state; previous bytes remain intact',async()=>{
  const f=await fixture(); const bot=await TeachingBot.open({...f.options,store:f.store()}); await bot.ingest(message(1));
  const state=await f.store().load(); assert.throws(()=>f.store().save({...state,groupId:'99999'}),/INVALID_STATE/);
  const small=new LocalDurableState(join(f.root,'state'),{maxBytes:50}); await assert.rejects(small.save(state),/STATE_TOO_LARGE/);
  assert.equal((await f.store().load()).queue.length,1);
});
test('concurrent saves are serialized and published as whole JSON documents',async()=>{
  const f=await fixture(); const bot=await TeachingBot.open({...f.options,store:f.store()}); await bot.ingest(message(1));
  const store=f.store(); const state=await store.load(); await Promise.all([1,2,3].map(calls=>store.save({...state,calls})));
  assert.equal((await store.load()).calls,3);
});
test('directory in place of a state file fails closed',async()=>{
  const f=await fixture(); await mkdir(join(f.root,'state','teaching-state.json'),{recursive:true}); await assert.rejects(f.store().load(),/UNSAFE_STATE_FILE/);
});
test('a persisted successful receipt is not downgraded to uncertain on restart',async()=>{
  const f=await fixture();const first=await TeachingBot.open({...f.options,store:f.store()});await first.ingest(message(1));
  const store=f.store();const state=await store.load();state.version=1;delete state.activeJobs;state.active={job:state.queue.shift(),phase:'sending'};
  state.receipts.push({eventId:'1',status:'answer',delivered:true});await store.save(state);
  const recovered=await TeachingBot.open({...f.options,store:f.store()});await recovered.drain();
  assert.equal(f.sent.length,0);assert.deepEqual(recovered.diagnostics.receipts,[{eventId:'1',status:'answer',delivered:true}]);
});

test('version two recovers every generating job while holding uncertain sends and known receipts',async()=>{
 const f=await fixture(),first=await TeachingBot.open({...f.options,config:{...f.options.config,dailyModelCalls:null},store:f.store()});
 for(const id of [11,12,13,14])await first.ingest({...message(id),user_id:String(100000+id)});
 const store=f.store(),state=await store.load();
 state.activeJobs=state.queue.splice(0).map((job,i)=>({job,phase:i<2?'generating':'sending'}));state.active=state.activeJobs[0];
 state.receipts.push({eventId:'14',status:'answer',delivered:true});await store.save(state);
 const recovered=await TeachingBot.open({...f.options,config:{...f.options.config,dailyModelCalls:null},store:f.store()});await recovered.drain();
 assert.deepEqual(f.sent.map(m=>m.replyTo).sort(),['11','12']);
 assert.deepEqual(recovered.diagnostics.receipts.filter(r=>r.status==='delivery_uncertain_after_restart').map(r=>r.eventId),['13']);
 assert.equal(recovered.diagnostics.receipts.find(r=>r.eventId==='14').delivered,true);
 const stable=await store.load();assert.equal(stable.version,2);assert.equal(stable.active,null);assert.deepEqual(stable.activeJobs,[]);
});
