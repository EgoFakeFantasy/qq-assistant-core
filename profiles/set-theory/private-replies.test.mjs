import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTeachingHub} from '../../src/app/teaching-hub.js';
import {createKnowledgeBase} from './knowledge.mjs';
import {createLivePrivateOneBot,createPrivatePeerAuthorizer} from './live-private-onebot.mjs';
const profile=JSON.parse(await readFile(new URL('./profile.json',import.meta.url)));
const alice='12345678',bob='23456789',token='synthetic-local-test-token-123456';
const event=(userId,id,text='你好')=>({post_type:'message',message_type:'private',sub_type:'friend',self_id:profile.botId,user_id:userId,message_id:id,message:[{type:'text',data:{text}}]});
async function fixture(t,{root,enabled=true,maxConversations=64,send,authorize}={}){
 root||=await mkdtemp(join(tmpdir(),'qq-private-'));const requests=[],deliveries=[];
 const config={...profile,perUserIntervalMs:0,privateMessages:{enabled,maxConversations}};
 const knowledge=createKnowledgeBase(),model={kind:'mock',generate:async r=>{requests.push(r);return {status:'answer',text:'收到当前消息。',citations:[],model:profile.model,reasoningEffort:'high',billingRoute:'chatgpt-plan'};}};
 const transport={kind:'mock',send:async m=>{deliveries.push(m);return send?send(m):{ok:true,messageId:'100',verified:true};}};
 const adapters={authorize:authorize|| (async id=>[alice,bob].includes(id)),createAdapters:async()=>({knowledge,model,transport})};
 const hub=await createTeachingHub({config,knowledge,model,transport,runtimeRoot:root,token,autoDrain:false,privateAdapters:adapters});
 const url=await hub.listen();t.after(()=>hub.close());
 const post=async payload=>{const r=await fetch(url+'/api/onebot/event',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(payload)});assert.equal(r.status,202);return r.json();};
 return {hub,url,root,requests,deliveries,post};
}
test('friend DMs need no mention; each peer has isolated context/memory and cannot invoke Hui',async t=>{
 const h=await fixture(t);t.after(()=>rm(h.root,{recursive:true,force:true}));
 assert.equal((await h.post(event(alice,'1','我喜欢先看具体例子再理解抽象定义。'))).status,'queued');await h.hub.drain();
 assert.equal((await h.post(event(bob,'1','回，请解释什么是序数'))).status,'queued');await h.hub.drain();
 assert.equal(h.requests.length,2);assert.equal(h.requests[1].scopeType,'private');assert.equal(h.requests[1].requestedPersona,null);
 assert(!JSON.stringify(h.requests[1].context).includes('先看具体'));assert(!JSON.stringify(h.requests[1].memoryContext).includes('先看具体'));
 assert.equal(h.deliveries[0].groupId,'private:'+alice);assert.equal(h.deliveries[1].groupId,'private:'+bob);
 assert.equal((await h.post(event(alice,'1','duplicate'))).status,'duplicate');await h.hub.drain();assert.equal(h.requests.length,2);
 const state=await (await fetch(h.url+'/api/state',{headers:{authorization:'Bearer '+token}})).json();
 assert.deepEqual(state.allowedGroupIds,[profile.groupId]);assert.equal(state.groups.length,1);assert.equal(state.privateMessages.conversations,2);
 assert.equal(state.groups[0].longTermMemory.observedMessages,0);
 const a=JSON.parse(await readFile(join(h.root,'private-conversations',alice,'state','teaching-state.json')));
 assert.equal(a.groupId,'private:'+alice);assert.equal(a.receipts[0].verified,true);
 const memory=JSON.parse(await readFile(join(h.root,'private-conversations',alice,'long-term-memory','memory.json')));
 assert(memory.items.length>0);assert(memory.items.every(i=>i.scope==='private:'+alice));
});
test('strangers, temp sessions, forged group scopes, self echoes and disabled intake create no private conversations',async t=>{
 const h=await fixture(t);t.after(()=>rm(h.root,{recursive:true,force:true}));
 for(const e of [event('34567890','2'),{...event(alice,'3'),sub_type:'group'},{...event(alice,'4'),group_id:profile.groupId},event(profile.botId,'5'),{...event(alice,'6'),self_id:'99999999'},{...event(alice,'7'),sender:{is_robot:true}}])assert.equal((await h.post(e)).status,'ignored');
 await h.hub.drain();assert.equal(h.requests.length,0);assert.deepEqual(await readdir(join(h.root,'private-conversations')),[]);
 const off=await fixture(t,{enabled:false});t.after(()=>rm(off.root,{recursive:true,force:true}));
 assert.equal((await off.post(event(alice,'8'))).status,'ignored');
});
test('private durable queue resumes after restart; uncertain sends and duplicate IDs never resend',async t=>{
 const h=await fixture(t,{send:()=>{throw Error('uncertain send');}});h.hub.workers.pause();
 await h.post(event(alice,'9'));await h.hub.close();
 const next=await fixture(t,{root:h.root,send:()=>{throw Error('uncertain send');}});await next.hub.drain();
 assert.equal(next.requests.length,1);assert.equal(next.deliveries.length,1);await next.hub.close();
 const third=await fixture(t,{root:h.root});t.after(()=>rm(h.root,{recursive:true,force:true}));
 assert.equal((await third.post(event(alice,'9'))).status,'duplicate');await third.hub.drain();assert.equal(third.deliveries.length,0);
});
test('private conversation capacity does not change group acceptance',async t=>{
 const h=await fixture(t,{maxConversations:1});t.after(()=>rm(h.root,{recursive:true,force:true}));
 await h.post(event(alice,'10'));assert.equal((await h.post(event(bob,'11'))).status,'private_capacity');
 const group={...event(bob,'12'),message_type:'group',group_id:profile.groupId,message:[{type:'at',data:{qq:profile.botId}},{type:'text',data:{text:'群消息'}}]};
 assert.equal((await h.post(group)).status,'queued');await h.hub.drain();assert.equal(h.requests.length,2);
});
function rpcFixture(){
 const calls=[];let nodes=null,offline=false,friend=true,wrong=false,uncertain=false;
 const messages=new Map([
  [1,{message_type:'private',message_id:1,sender:{user_id:Number(alice)},message:[{type:'text',data:{text:'hello'}}]}],
  [2,{message_type:'private',message_id:2,sender:{user_id:Number(bob)},message:[{type:'text',data:{text:'other peer secret'}}]}],
  [3,{message_type:'group',group_id:profile.groupId,sender:{user_id:Number(alice)},message:[]}]
 ]);
 const fetchFn=async(url,options)=>{
  const action=url.pathname.slice(1),p=JSON.parse(options.body);calls.push({action,p});
  let data;if(action==='get_status')data={online:!offline};
  else if(action==='get_login_info')data={user_id:wrong?'99999999':profile.botId};
  else if(action==='get_friend_list')data=friend?[{user_id:alice}]:[];
  else if(action==='get_msg')data=messages.get(p.message_id);
  else if(action==='get_forward_msg')data={messages:nodes};
  else if(action==='send_private_msg'||action==='send_private_forward_msg'){
   nodes=p.messages;messages.set(88,{message_type:'private',message_id:88,sender:{user_id:profile.botId},target_id:alice,message:nodes?[{type:'forward',data:{id:'fixture-forward'}}]:p.message});
   if(uncertain)throw Error('network failed after write');data={message_id:88};
  }else throw Error('Unexpected RPC '+action);
  return {ok:true,json:async()=>({retcode:0,status:'ok',data})};
 };
 const options={baseUrl:'http://127.0.0.1:3000/',token,botId:profile.botId,fetchFn};
 return {options,calls,messages,setOffline:()=>offline=true,revoke:()=>friend=false,wrongAccount:()=>wrong=true,uncertain:()=>uncertain=true};
}
test('private transport enforces exact peer and original message, sends inline and verifies readback',async()=>{
 const f=rpcFixture(),transport=createLivePrivateOneBot({...f.options,userId:alice});
 f.messages.set(4,{message_type:'private',message_id:4,sender:{user_id:profile.botId},user_id:alice,target_id:bob,message:[{type:'text',data:{text:'conflicting recipient'}}]});
 assert.equal((await transport.readQuote({groupId:'private:'+alice,messageId:'4'})),null);
 assert.equal((await transport.readQuote({groupId:'private:'+alice,messageId:'2'})),null);
 assert.equal((await transport.readQuote({groupId:'private:'+alice,messageId:'1'})).text,'hello');
 await assert.rejects(transport.send({groupId:'private:'+alice,replyTo:'2',text:'no'}),/SCOPE/);
 await assert.rejects(transport.send({groupId:'private:'+alice,replyTo:'3',text:'no'}),/SCOPE/);
 const receipt=await transport.send({groupId:'private:'+alice,replyTo:'1',text:'**accepted**'});
 assert.equal(receipt.verified,true);assert.equal(receipt.deliveryMode,'inline');
 const writes=f.calls.filter(c=>c.action.startsWith('send_'));assert.equal(writes.length,1);assert.equal(writes[0].p.user_id,Number(alice));assert.equal(writes[0].p.message[1].data.text,'accepted');
});
test('private long replies use peer forward API with content and scope verification',async()=>{
 const f=rpcFixture(),transport=createLivePrivateOneBot({...f.options,userId:alice});
 const receipt=await transport.send({groupId:'private:'+alice,replyTo:'1',text:'正文内容。'.repeat(200)});
 assert.equal(receipt.deliveryMode,'forward');assert.equal(receipt.verified,true);assert.equal(f.calls.filter(c=>c.action==='send_private_forward_msg').length,1);
});
test('offline, wrong-account and revoked friendship cannot send; uncertain writes have no automatic retry',async()=>{
 for(const condition of ['setOffline','wrongAccount','revoke']){
  const f=rpcFixture();f[condition]();const transport=createLivePrivateOneBot({...f.options,userId:alice});
  await assert.rejects(transport.send({groupId:'private:'+alice,replyTo:'1',text:'no'}),/FRIEND_REQUIRED/);
  assert.equal(f.calls.filter(c=>c.action.startsWith('send_')).length,0);
 }
 const f=rpcFixture();f.uncertain();const transport=createLivePrivateOneBot({...f.options,userId:alice});
 await assert.rejects(transport.send({groupId:'private:'+alice,replyTo:'1',text:'once'}),/network failed/);
 assert.equal(f.calls.filter(c=>c.action==='send_private_msg').length,1);
 assert.throws(()=>createPrivatePeerAuthorizer({...f.options,baseUrl:'https://external.example/'}),/LOOPBACK/);
});

test('offline friend verification does not prevent Hub startup; queued DMs resume on a later health refresh',async t=>{
 const first=await fixture(t);first.hub.workers.pause();await first.post(event(alice,'reconnect'));await first.hub.close();
 let online=false;const second=await fixture(t,{root:first.root,authorize:async()=>{if(!online)throw Error('QQ temporarily unavailable');return true;}});t.after(()=>rm(first.root,{recursive:true,force:true}));
 await second.hub.drain();assert.equal(second.requests.length,0);online=true;await second.hub.refreshPrivateScopes();await second.hub.drain();assert.equal(second.requests.length,1);assert.equal(second.deliveries.length,1);
});
