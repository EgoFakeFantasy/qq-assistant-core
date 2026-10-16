import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSimulationHost } from './simulation-host.mjs';
import { createKnowledgeBase } from './knowledge.mjs';
const profile=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));
const event=(id,extra={})=>({post_type:'message',message_type:'group',self_id:profile.botId,group_id:profile.groupId,user_id:'12345678',message_id:id,
  message:[{type:'at',data:{qq:profile.botId}},{type:'text',data:{text:'什么是可数集合'}}],...extra});
async function setup(t,extra={}){
  const host=await createSimulationHost({config:{...profile,perUserIntervalMs:0},knowledge:createKnowledgeBase({pages:[{bookId:'a'.repeat(64),title:'Synthetic textbook',page:7,text:'A countable set has an injection into the natural numbers.'}]}),
    runtimeRoot:await mkdtemp(join(tmpdir(),'qq-e2e-')),autoDrain:false,...extra});
  t.after(()=>host.close());return host;
}
const post=(h,payload,token=h.token)=>fetch(h.baseUrl+'/api/onebot/event',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(payload)});
test('HTTP ingress -> durable queue -> real upstream protocol runner -> fake child -> fake OneBot receipt',async t=>{
  const h=await setup(t);assert.equal((await post(h,event(1))).status,202);await h.drain();
  assert.equal(h.deliveries.length,1);assert.match(h.deliveries[0].message[1].data.text,/PDF第7页/);
  assert.equal(h.protocol[0].model,'gpt-6.1-sol');assert.equal(h.protocol[0].reasoningEffort,'high');
  assert.deepEqual(h.protocol[0].envKeys,['SystemRoot']);assert.equal(h.bot.diagnostics.receipts[0].delivered,true);
});
test('authentication, scope, duplicate delivery and management are enforced across HTTP',async t=>{
  const h=await setup(t);assert.equal((await post(h,event(1),'wrong')).status,403);
  assert.equal((await (await post(h,event(2,{group_id:'99999'}))).json()).status,'ignored');
  await post(h,event(3));assert.equal((await (await post(h,event(3))).json()).status,'duplicate');await h.drain();
  const admin=event(4);admin.message[1].data.text='/model weak';await post(h,admin);await h.drain();
  assert.equal(h.protocol.length,1);assert.equal(h.deliveries.length,2);assert.match(h.deliveries[1].message[1].data.text,/管理功能尚未配置/);
});
test('subprocess model failure produces explicit mock service feedback',async t=>{
  const h=await setup(t,{fixtureBehavior:'fail'});await post(h,event(1));await h.drain();
  assert.equal(h.deliveries.length,1);assert.match(h.deliveries[0].message[1].data.text,/MODEL_OR_RETRIEVAL_FAILURE/);
});
test('failed OneBot response is not treated as successful or blindly retried',async t=>{
  const h=await setup(t,{failDelivery:true});await post(h,event(1));await h.drain();
  assert.equal(h.deliveries.length,0);assert.equal(h.protocol.length,1);assert.equal(h.bot.diagnostics.receipts[0].delivered,false);
});
