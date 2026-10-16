import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { launchHub } from '../../src/app/launch-hub.js';
import { selectHubProfile } from '../../src/config/teaching-profile.js';
import { createSimulationHost } from './simulation-host.mjs';
import { createKnowledgeBase } from './knowledge.mjs';
const profile = JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));
const event = id => ({ post_type:'message', message_type:'group', self_id:profile.botId, group_id:profile.groupId,
  user_id:'12345678', message_id:id, message:[{type:'at',data:{qq:profile.botId}},{type:'text',data:{text:'What is an ordinal?'}}] });
async function setup(t, extra={}) {
  const h = await createSimulationHost({config:{...profile,perUserIntervalMs:0}, knowledge:createKnowledgeBase(),
    runtimeRoot:await mkdtemp(join(tmpdir(),'qq-hub-test-')),autoDrain:false,...extra});
  t.after(()=>h.close()); return h;
}
function request(h,path,body,headers={}) { return fetch(h.baseUrl+path,{method:body===undefined?'GET':'POST',
  headers:{authorization:`Bearer ${h.token}`,'content-type':'application/json',...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)})}); }

test('profile is opt-in; offline branch never imports legacy or honors live mode',async()=>{
  let legacy=0, teaching=0;
  const deps={loadLegacy:async()=>legacy++,startTeaching:async()=>teaching++};
  await launchHub({...deps,env:{},args:[]}); assert.equal(legacy,1);assert.equal(teaching,0);
  await launchHub({...deps,env:{CODEX_QQ_PROFILE:'set-theory-offline'},args:['--once']});
  await launchHub({...deps,env:{},args:['--set-theory-offline']});
  assert.equal(legacy,1);assert.equal(teaching,2);
  assert.throws(()=>selectHubProfile({CODEX_QQ_PROFILE:'set-theory-live'}),/UNAPPROVED/);
  assert.throws(()=>selectHubProfile({},['--set-theory-live']),/UNAPPROVED/);
  assert.throws(()=>selectHubProfile({},['--set-theory-offline','--live']),/UNAPPROVED/);
});
test('production Hub exposes only authenticated safe status and isolated dashboard',async t=>{
  const h=await setup(t);
  const state=await request(h,'/api/state');assert.equal(state.status,200);
  const body=await state.json();assert.equal(body.liveEnabled,false);assert.equal(body.model,'gpt-6.1-sol');
  assert.equal((await request(h,'/api/maintenance')).status,200);
  assert.equal((await fetch(h.baseUrl+'/api/state')).status,403);
  assert.equal((await request(h,'/api/state',undefined,{origin:'https://attacker.example'})).status,403);
  // Fetch rewrites Host; use a raw HTTP request to actually exercise this boundary.
  const hostileHostStatus = await new Promise((resolve,reject)=>{
    const req=httpRequest(h.baseUrl+'/api/state',{headers:{host:'attacker.example',authorization:`Bearer ${h.token}`}},res=>{res.resume();resolve(res.statusCode);});
    req.on('error',reject);req.end();
  });
  assert.equal(hostileHostStatus,403);
  assert.equal((await request(h,'/api/settings',{ai:{model:'other'}})).status,404);
  assert.equal((await request(h,'/api/qq/event',event(1))).status,404);
  assert.match(await (await fetch(h.baseUrl+'/')).text(),/offline simulation/);
  assert.equal(h.protocol.length,0); assert.equal(h.deliveries.length,0);
});
test('Hub rejects oversized or malformed intake and never accepts alternate URL or methods',async t=>{
  const h=await setup(t);
  assert.equal((await request(h,'/api/onebot/event')).status,405);
  assert.equal((await request(h,'/api/onebot/event?bypass=1',event(1))).status,404);
  assert.equal((await request(h,'/api/onebot/event',event(1),{'content-type':'text/plain'})).status,415);
  assert.equal((await request(h,'/api/onebot/event',{text:'x'.repeat(70000)})).status,413);
  const bad=await fetch(h.baseUrl+'/api/onebot/event',{method:'POST',headers:{authorization:`Bearer ${h.token}`,'content-type':'application/json'},body:'{'});
  assert.equal(bad.status,400);assert.equal(h.protocol.length,0);assert.equal(h.bot.diagnostics.queued,0);
});
test('Hub persists HTTP acceptance and deduplication across a complete listener restart',async t=>{
  const root=await mkdtemp(join(tmpdir(),'qq-hub-restart-'));
  const first=await setup(t,{runtimeRoot:root});
  await request(first,'/api/onebot/event',event('restart'));await first.drain();await first.close();
  const second=await setup(t,{runtimeRoot:root});
  const response=await request(second,'/api/onebot/event',event('restart'));
  assert.equal((await response.json()).status,'duplicate');await second.drain();
  assert.equal(second.protocol.length,0);assert.equal(second.deliveries.length,0);
  assert.equal(second.bot.diagnostics.modelCalls,1);assert.equal(second.bot.diagnostics.receipts[0].delivered,true);
});
test('HTTP queue overflow, daily budget and unknown administrator give feedback without alternate commands',async t=>{
  const h=await setup(t,{config:{...profile,maxQueue:1,dailyModelCalls:1,perUserIntervalMs:0}});
  await request(h,'/api/onebot/event',event(1));
  assert.equal((await (await request(h,'/api/onebot/event',event(2))).json()).status,'queue_full');
  await h.drain();await request(h,'/api/onebot/event',event(3));await h.drain();
  const admin=event(4);admin.message[1].data.text='/exec powershell';
  await request(h,'/api/onebot/event',admin);
  assert.equal(h.protocol.length,1);const messages=h.deliveries.map(d=>d.message[1].data.text).join('\n');
  assert.match(messages,/QUEUE_FULL/);assert.match(messages,/DAILY_BUDGET/);
  assert.equal(h.bot.diagnostics.receipts.at(-1).status,'management_denied');
});

test('NapCat raw-body HMAC authenticates only the event endpoint and rejects tampering',async t=>{
  const {createHmac}=await import('node:crypto');
  const h=await setup(t);
  const raw='  '+JSON.stringify(event('signed'))+'\n';
  const sign=body=>'sha1='+createHmac('sha1',h.token).update(body).digest('hex');
  const signed=(path,body,signature)=>fetch(h.baseUrl+path,{method:'POST',headers:{'content-type':'application/json','x-signature':signature},body});
  assert.equal((await signed('/api/onebot/event',raw,sign(raw))).status,202);
  assert.equal(h.bot.diagnostics.queued,1);
  assert.equal((await signed('/api/onebot/event',raw+' ',sign(raw))).status,403);
  assert.equal((await signed('/api/onebot/event',raw,'sha1=bad')).status,403);
  assert.equal((await signed('/api/state',raw,sign(raw))).status,403);
  const wrong='sha1='+createHmac('sha1','wrong-key').update(raw).digest('hex');
  assert.equal((await signed('/api/onebot/event',raw,wrong)).status,403);
  const tooBig=JSON.stringify({text:'x'.repeat(70000)});
  assert.equal((await signed('/api/onebot/event',tooBig,sign(tooBig))).status,413);
  assert.equal(h.bot.diagnostics.queued,1);
});