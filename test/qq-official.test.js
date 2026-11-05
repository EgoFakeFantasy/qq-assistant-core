import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {QQBot} from '@tencent-connect/qqbot-nodejs';
import {createOfficialChannel,validateOfficialSettings} from '../src/channels/qq/official-channel.js';
import {openOfficialState} from '../src/channels/qq/official-state.js';
import {openOfficialRuntime,createOfficialHubIngress,probeOfficialConnection} from '../profiles/set-theory/official-runtime.mjs';
import {prepareOfficialRuntime} from '../scripts/prepare-qq-official.mjs';
import {officialReadiness} from '../scripts/check-qq-official.mjs';
import {writeFile} from 'node:fs/promises';
import {TeachingBot} from '../profiles/set-theory/teaching-bot.mjs';
import {createTeachingHub} from '../src/app/teaching-hub.js';
import {humanitiesTopicForRequest,requestsGemini,normalizeSecondary} from '../profiles/set-theory/provider-policy.mjs';

const base=JSON.parse(await readFile(new URL('../profiles/set-theory/profile.json',import.meta.url),'utf8'));
const secondary={...normalizeSecondary(),enabled:true,activationMode:'mentioned-name',canary:null,routeHumanities:true};
const config={...base,mode:'live',additionalGroups:[],groupId:'1000000001',privateMessages:{enabled:true,maxConversations:4},perUserIntervalMs:0,secondaryPersona:secondary};
const settings={appId:'123456',groups:[{groupId:'1000000001',openid:'GROUP_A',botMemberOpenid:'BOT_A',allowProactive:true},{groupId:'1000000004',openid:'GROUP_B',botMemberOpenid:'BOT_B'}]};
class FakeSDK{
  appId='123456';handlers=new Map();writes=[];uploads=[];stateAllowed=true;failAt=0;
  api={get:async path=>{if(!this.stateAllowed)throw Error('NO_PERMISSION');return {member_openid:path.includes('GROUP_A')?'BOT_A':'BOT_B',allow_proactive_msg:true,recv_msg_setting:'all'};}};
  on(event,fn){this.handlers.set(event,fn);return this;}
  emit(event,...args){return this.handlers.get(event)?.(...args);}
  stop(){}
  async start(){}
  async write(kind,...args){this.writes.push({kind,args});if(this.failAt===this.writes.length)throw Error('SIMULATED_TIMEOUT');return {id:'SENT_'+this.writes.length};}
  send(...a){const o=a[0];return this.write(o.msgType===7?(o.media.file_info==='FILE_4'?'file':'image'):'text',...a);}
  async uploadMedia(options){this.uploads.push(options);return {file_info:'FILE_'+options.fileType};}
}
function event(overrides={}){return {kind:'group',rawEventType:'GROUP_AT_MESSAGE_CREATE',senderId:'HUMAN',senderName:'test',messageId:'MESSAGE_1',groupOpenid:'GROUP_A',timestamp:new Date().toISOString(),content:'<@BOT_A> 请解释集合论',msgIdx:'REF_1',raw:{author:{member_openid:'HUMAN',bot:false}},replyTarget:{scope:'group',targetId:'GROUP_A',msgId:'MESSAGE_1'},...overrides};}
async function setup(t,{cfg=config,clock}={}){
  const root=await mkdtemp(join(tmpdir(),'qq-official-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const sdk=new FakeSDK(),incoming=[];const path=join(root,'official','state.json');
  const channel=await createOfficialChannel({settings,config:cfg,statePath:path,sdk,...(clock?{now:clock}:{})});
  channel.bindIngress(async p=>{incoming.push(p);return {status:'accepted'};});sdk.emit('ready',{});
  return {root,path,sdk,channel,incoming,async emit(e=event()){await sdk.emit('message',{},e);return incoming.at(-1);}};
}

test('official SDK is installed and runtime fails closed before any network use',async t=>{
  const sdk=new QQBot({appId:'123456',appSecret:'test-not-a-real-credential'});
  assert.equal(typeof sdk.send,'function');assert.equal(typeof sdk.api.get,'function');sdk.stop();
  await assert.rejects(openOfficialRuntime({transport:'qq-official',runtimeRoot:'same',legacyRuntimeRoot:'same',hubPort:3000,legacyHubPort:3000,qqOfficial:settings},config,{env:{}}),/ISOLATED/);
  await assert.rejects(openOfficialRuntime({transport:'qq-official',runtimeRoot:'new',legacyRuntimeRoot:'old',hubPort:3001,legacyHubPort:3000,qqOfficial:settings},config,{env:{}}),/SECRET_REQUIRED/);
  assert.throws(()=>validateOfficialSettings({...settings,groups:[...settings.groups,settings.groups[0]]},config),/BINDING/);
});
test('trusted SDK input receives scoped internal identities, never old QQ numbers',async t=>{
  const f=await setup(t);const a=await f.emit();assert.match(a.user_id,/^8\d{14}$/);assert.notEqual(a.user_id,'HUMAN');assert.equal(a.self_id,'2000000002');
  const duplicate=await f.emit();assert.equal(a.message_id,duplicate.message_id);assert.equal(a.user_id,duplicate.user_id);
  const b=await f.emit(event({messageId:'B',groupOpenid:'GROUP_B',content:'<@BOT_B> hi',replyTarget:{scope:'group',targetId:'GROUP_B',msgId:'B'}}));assert.notEqual(a.user_id,b.user_id);
  const c=await f.emit(event({kind:'c2c',rawEventType:'C2C_MESSAGE_CREATE',groupOpenid:undefined,messageId:'C',content:'你好',raw:{author:{user_openid:'HUMAN'}},replyTarget:{scope:'c2c',targetId:'HUMAN',msgId:'C'}}));assert.notEqual(a.user_id,c.user_id);
  assert.equal(await f.channel.authorizePrivate(c.user_id),true);assert.equal(f.channel.diagnostics.internalAliasesAreQqNumbers,false);
});
test('unknown groups, mismatched targets, stale timestamps, bots, and pre-ready events are rejected',async t=>{
  const f=await setup(t);
  for(const e of [event({groupOpenid:'UNKNOWN'}),event({replyTarget:{scope:'group',targetId:'WRONG',msgId:'MESSAGE_1'}}),event({timestamp:new Date(Date.now()-360000).toISOString()}),event({raw:{author:{bot:true}}}),event({rawEventType:'FAKE'})])await f.sdk.emit('message',{},e);
  f.sdk.emit('disconnected',{});await f.sdk.emit('message',{},event());assert.equal(f.incoming.length,0);
});
test('quotes, @all, another member, and old mention metadata never bypass mentions-only',async t=>{
  const f=await setup(t);const tx=f.channel.transport({groupId:'1000000001',replyPolicy:'mentions-only'});
  const a=await f.emit(event({rawEventType:'GROUP_MESSAGE_CREATE',content:'<@OTHER> 文学哲学',mentions:[{member_openid:'BOT_A'}],msgElements:[{content:'<@BOT_A> 回'}]}));
  assert.equal(a.message.some(s=>s.type==='at'&&s.data.qq===config.botId),false);
  await assert.rejects(tx.send({groupId:config.groupId,replyTo:a.message_id,text:'禁止绕过'}),/MENTION_REQUIRED/);assert.equal(f.sdk.writes.length,0);
  const payload=await f.emit(event({messageId:'REAL',replyTarget:{scope:'group',targetId:'GROUP_A',msgId:'REAL'},content:'<@BOT_A> 回，请谈哲学'}));
  await tx.send({groupId:config.groupId,replyTo:payload.message_id,text:'可以回复'});assert.equal(f.sdk.writes.length,1);
});
test('long text uses complete file, receipts remain unverified, duplicate writes cannot retry after restart',async t=>{
  const f=await setup(t),p=await f.emit(),tx=f.channel.transport({groupId:config.groupId});
  const full='数学证明。'.repeat(700);const result=await tx.send({groupId:config.groupId,replyTo:p.message_id,text:full});
  assert.equal(result.verified,false);assert.equal(result.verification,'platform-accepted-no-readback');assert.equal(f.sdk.writes.length,2);
  assert.equal(f.sdk.uploads[0].buffer.toString('utf8'),full);assert.equal(f.sdk.uploads[0].srvSendMsg,false);
  assert.equal(f.sdk.writes[0].args[0].target.msgId,'MESSAGE_1');assert.equal(f.sdk.writes[0].args[0].messageReference.message_id,'REF_1');
  const sdk=new FakeSDK(),again=await createOfficialChannel({settings,config,statePath:f.path,sdk});again.bindIngress(async()=>{});sdk.emit('ready',{});
  await assert.rejects(again.transport({groupId:config.groupId}).send({groupId:config.groupId,replyTo:p.message_id,text:full}),/ALREADY_ATTEMPTED/);assert.equal(sdk.writes.length,0);
});
test('partial delivery is uncertain and permanently reserves the same write',async t=>{
  const f=await setup(t),p=await f.emit(),tx=f.channel.transport({groupId:config.groupId});f.sdk.failAt=2;
  await assert.rejects(tx.send({groupId:config.groupId,replyTo:p.message_id,text:'甲'.repeat(1300)}),e=>e.code==='OFFICIAL_DELIVERY_UNCERTAIN'&&e.partialMessageIds.length===1);
  await assert.rejects(tx.send({groupId:config.groupId,replyTo:p.message_id,text:'甲'.repeat(1300)}),/ALREADY_ATTEMPTED/);assert.equal(f.sdk.writes.length,2);
});
test('per-trigger reply limits and expiry survive adapter recreation',async t=>{
  let time=Date.now();const f=await setup(t,{clock:()=>time}),p=await f.emit(),tx=f.channel.transport({groupId:config.groupId});
  for(let i=0;i<5;i++)await tx.send({groupId:config.groupId,replyTo:p.message_id,text:'回答'+i});
  await assert.rejects(tx.send({groupId:config.groupId,replyTo:p.message_id,text:'第六条'}),/REPLY_LIMIT/);
  time+=301000;assert.equal(tx.replyTimeRemaining(p.message_id),0);await assert.rejects(tx.send({groupId:config.groupId,replyTo:p.message_id,text:'过期'}),/EXPIRED/);
});
test('media and received file listing are group-scoped and do not promise full history',async t=>{
  const f=await setup(t);const a=await f.emit(event({attachments:[{content_type:'image/png',url:'https://multimedia.nt.qq.com.cn/download?id=x'},{content_type:'file',url:'https://file.qq.com/book',filename:'book.pdf',size:10},{content_type:'image/png',url:'http://127.0.0.1/secret'}]}));
  const tx=f.channel.transport({groupId:config.groupId}),other=f.channel.transport({groupId:'1000000004'});
  assert.equal((await tx.messageMedia(a.message_id)).images.length,1);assert.equal((await other.messageMedia(a.message_id)).images.length,0);
  const files=await tx.listGroupFiles();assert.equal(files.length,1);assert.equal((await other.listGroupFiles()).length,0);
  await assert.rejects(other.groupFileUrl(files[0].fileId),/NOT_RECEIVED/);assert.equal(await other.readQuote({groupId:'1000000004',messageId:a.message_id}),null);
  assert.equal(tx.capabilities.historicalFetch,false);assert.equal(tx.capabilities.forwardCards,false);
});
test('proactive sending requires explicit config, fresh platform permission, and adaptive group',async t=>{
  const f=await setup(t);const tx=f.channel.transport({groupId:config.groupId,allowProactive:true});
  await tx.sendProactive({groupId:config.groupId,text:'分享'});assert.equal(f.sdk.writes.length,1);
  f.sdk.stateAllowed=false;assert.equal((await tx.check()).memberOfGroup,false);
  await assert.rejects(tx.sendProactive({groupId:config.groupId,text:'不允许'}),/PROACTIVE_DISABLED/);
  await assert.rejects(f.channel.transport({groupId:'1000000004',replyPolicy:'mentions-only',allowProactive:true}).sendProactive({groupId:'1000000004',text:'禁止'}),/MENTION_REQUIRED/);
});
test('durable internal identity is isolated by AppID and rejects invalid state',async t=>{
  const f=await setup(t);const p=await f.emit();assert.match(p.user_id,/^8/);
  await assert.rejects(openOfficialState(f.path,'ANOTHER_APP'),/STATE_INVALID/);
});
test('authenticated loopback Hub receives official events; provider routes and real mention gating remain intact',async t=>{
  const f=await setup(t);const payload=await f.emit();const knowledge={pageCount:0,catalog:[],search:()=>[]};
  const groupConfig={...config,replyPolicy:'mentions-only',attention:{enabled:false}};
  let generated=0;const model={kind:'live',diagnostics:{},async generate(){generated++;return {status:'answer',text:'这是测试回答',citations:[]};}};
  const hub=await createTeachingHub({config:{...groupConfig,privateMessages:{enabled:false}},model,transport:f.channel.transport({groupId:config.groupId,replyPolicy:'mentions-only'}),knowledge,runtimeRoot:join(f.root,'hub'),token:'x'.repeat(32),autoDrain:false});t.after(()=>hub.close());
  const address=await hub.listen();const ingress=createOfficialHubIngress({address,token:'x'.repeat(32)});
  assert.equal((await ingress(payload)).status,'queued');await hub.drain();assert.equal(generated,1);assert.equal(f.sdk.writes.length,1);
  const receipt=hub.bot.diagnostics.receipts.at(-1);assert.equal(receipt.delivered,true);assert.equal(receipt.verified,false);
  assert.equal((await ingress(payload)).status,'duplicate');await hub.drain();assert.equal(generated,1);
  const unmentioned=await f.emit(event({messageId:'NO_AT',rawEventType:'GROUP_MESSAGE_CREATE',content:'回，文学历史哲学',replyTarget:{scope:'group',targetId:'GROUP_A',msgId:'NO_AT'}}));
  assert.equal((await ingress(unmentioned)).status,'context_only');await hub.drain();assert.equal(generated,1);
  assert.equal(requestsGemini('回，请帮忙',secondary,{hasSelfAt:true}),true);
  assert.equal(requestsGemini('阿序，请帮忙',secondary,{hasSelfAt:true}),false);
  assert.equal(humanitiesTopicForRequest(secondary,{groupId:'1000000004',replyPolicy:'mentions-only',question:'讨论哲学',hasSelfAt:false}),null);
});
test('expired official queue items consume no model calls',async t=>{
  const f=await setup(t);let calls=0;const transport={kind:'live',send:async()=>{throw Error('must not send');},replyTimeRemaining:()=>0};
  const bot=new TeachingBot({config,model:{kind:'live',generate:async()=>{calls++;}},transport,knowledge:{search:()=>[]},runtimeRoot:f.root});
  const p=await f.emit();assert.equal((await bot.ingest(p)).status,'queued');await bot.drain();assert.equal(calls,0);assert.equal(bot.diagnostics.receipts.at(-1).status,'reply_window_expired');
});
test('preparation preserves accepted profile/model and never overwrites source or destination',async t=>{
  const f=await setup(t);const profile=join(f.root,'profile.json'),source=join(f.root,'live.json'),dest=join(f.root,'official.json');
  await writeFile(profile,JSON.stringify(config));const original=JSON.stringify({profilePath:profile,runtimeRoot:join(f.root,'old-runtime'),hubPort:3789,hubToken:'x'.repeat(32),oneBotToken:'old-private-credential',webuiToken:'old-panel-secret'});await writeFile(source,original);
  await prepareOfficialRuntime({source,destination:dest});assert.equal(await readFile(source,'utf8'),original);
  const prepared=JSON.parse(await readFile(dest,'utf8'));assert.equal(prepared.profilePath,profile);assert.equal(prepared.oneBotToken,undefined);assert.equal(prepared.webuiToken,undefined);assert.notEqual(prepared.hubToken,'x'.repeat(32));
  assert.equal(prepared.runtimeRoot,join(f.root,'old-runtime')+'-official');
  const readiness=await officialReadiness(dest,{env:{}});assert.equal(readiness.readyToConnect,false);assert.equal(readiness.mainModelPreserved,true);assert.equal(readiness.huiEnabled,true);assert.equal(readiness.humanitiesRouting,true);
  await assert.rejects(prepareOfficialRuntime({source,destination:dest}),{code:'EEXIST'});
});
test('embedded quoted @ is readable context but never a current @ permission',async t=>{
  const f=await setup(t);const p=await f.emit(event({rawEventType:'GROUP_MESSAGE_CREATE',content:'回，帮忙看一下',refMsgIdx:'OLD_REF',msgElements:[{content:'<@BOT_A> 旧问题',author:{member_openid:'OLD_HUMAN'}}]}));
  assert.equal(p.message.some(s=>s.type==='at'&&s.data.qq===config.botId),false);
  const replyId=p.message.find(s=>s.type==='reply').data.id;const tx=f.channel.transport({groupId:config.groupId,replyPolicy:'mentions-only'});
  assert.equal((await tx.readQuote({groupId:config.groupId,messageId:replyId})).text,'<@BOT_A> 旧问题');await assert.rejects(tx.send({groupId:config.groupId,replyTo:p.message_id,text:'不能越权'}),/MENTION_REQUIRED/);
});
test('official C2C reaches isolated private Hub scopes and disables Hui',async t=>{
  const f=await setup(t);const p=await f.emit(event({kind:'c2c',rawEventType:'C2C_MESSAGE_CREATE',groupOpenid:undefined,messageId:'PRIVATE',content:'回，请说文学',raw:{author:{user_openid:'PRIVATE_HUMAN'}},replyTarget:{scope:'c2c',targetId:'PRIVATE_HUMAN',msgId:'PRIVATE'}}));
  const knowledge={pageCount:0,catalog:[],search:()=>[]};let receivedRequest;
  const model={kind:'live',diagnostics:{},async generate(request){receivedRequest=request;return {status:'answer',text:'私聊由阿序回复',citations:[]};}};
  const hub=await createTeachingHub({config,model,knowledge,transport:f.channel.transport({groupId:config.groupId}),runtimeRoot:join(f.root,'private-hub'),token:'y'.repeat(32),autoDrain:false,privateAdapters:{authorizationKind:'official-c2c-event',authorize:id=>f.channel.authorizePrivate(id),createAdapters:async({userId})=>({model,knowledge,transport:f.channel.transport({userId})})}});t.after(()=>hub.close());
  const ingress=createOfficialHubIngress({address:await hub.listen(),token:'y'.repeat(32)});assert.equal((await ingress(p)).status,'queued');await hub.drain();
  const scope=hub.scopes.get('private:'+p.user_id);assert.equal(scope.config.secondaryPersona.enabled,false);assert.equal(receivedRequest.scopeType,'private');assert.equal(f.sdk.writes[0].args[0].target.scope,'c2c');
});
test('outgoing image validation precedes every external send',async t=>{
  const f=await setup(t),p=await f.emit(),tx=f.channel.transport({groupId:config.groupId}),path=join(f.root,'bad.png');await writeFile(path,'not an image');
  await assert.rejects(tx.send({groupId:config.groupId,replyTo:p.message_id,text:'图片',images:[{path}]}),/INVALID_OUTGOING_IMAGE/);assert.equal(f.sdk.writes.length,0);
  const bytes=Buffer.from([137,80,78,71,13,10,26,10]);await writeFile(path,bytes);const result=await tx.send({groupId:config.groupId,replyTo:p.message_id,text:'图片',images:[{path}]});assert.equal(result.verified,false);assert.equal(f.sdk.writes[1].kind,'image');assert.deepEqual(f.sdk.uploads[0].buffer,bytes);
});
test('official health probe verifies configured bindings and never calls a model or sends a message',async t=>{
  const root=await mkdtemp(join(tmpdir(),'qq-official-probe-'));t.after(()=>rm(root,{recursive:true,force:true}));const sdk=new FakeSDK();
  sdk.start=async signal=>{sdk.emit('ready',{});await new Promise(r=>signal.addEventListener('abort',r,{once:true}));};
  const channel=await createOfficialChannel({settings,config,statePath:join(root,'state.json'),sdk});
  const result=await probeOfficialConnection(channel,settings);assert.equal(result.online,true);assert.equal(result.allGroupsVerified,true);assert.equal(result.groups.length,2);assert.equal(sdk.writes.length,0);
});

test('installed SDK builds real media payloads and durable msg_seq across restart without network',async t=>{
  const root=await mkdtemp(join(tmpdir(),'qq-official-sdk-contract-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const statePath=join(root,'state.json'),requests=[];
  async function open(){
    const sdk=new QQBot({appId:settings.appId,appSecret:'offline-not-a-real-secret',markdownSupport:false});
    sdk.tokenManager.getAccessToken=async()=> 'offline-token';
    sdk.apiClient.request=async(_token,method,path,body)=>{
      assert.equal(method,'POST');requests.push({path,body});
      return path.endsWith('/files')?{file_info:'uploaded-file',file_uuid:'offline',ttl:1}:{id:'WIRE_'+requests.length};
    };
    const channel=await createOfficialChannel({settings,config,statePath,sdk});let payload;
    channel.bindIngress(async p=>{payload=p;});await sdk.emit('ready',{});
    return {sdk,channel,tx:channel.transport({groupId:config.groupId}),get payload(){return payload;}};
  }
  const first=await open();await first.sdk.emit('message',{},event());const id=first.payload.message_id;
  const text='完整正文。'.repeat(700);await first.tx.send({groupId:config.groupId,replyTo:id,text});await first.channel.close();
  const second=await open(),image=join(root,'image.png');await writeFile(image,Buffer.from([137,80,78,71,13,10,26,10]));
  await second.tx.send({groupId:config.groupId,replyTo:id,text:'补充图像',images:[{path:image}]});await second.channel.close();
  const messages=requests.filter(r=>r.path.endsWith('/messages')).map(r=>r.body),uploads=requests.filter(r=>r.path.endsWith('/files')).map(r=>r.body);
  assert.deepEqual(messages.map(m=>m.msg_seq),[1,2,3,4]);assert.deepEqual(messages.map(m=>m.msg_type),[0,7,0,7]);
  assert(messages.every(m=>m.msg_id==='MESSAGE_1'));assert(uploads.every(u=>u.srv_send_msg===false));
  assert.equal(Buffer.from(uploads[0].file_data,'base64').toString('utf8'),text);assert.equal(uploads[0].file_type,4);assert.equal(uploads[1].file_type,1);
});
