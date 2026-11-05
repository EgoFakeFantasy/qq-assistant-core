import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac,createHash} from 'node:crypto';
import {buildLLBotConfig,probeLLBot,LLBOT_GROUPS} from '../profiles/set-theory/llbot-runtime.mjs';
import {createTeachingHub} from '../src/app/teaching-hub.js';

const profile=JSON.parse(await readFile(new URL('../profiles/set-theory/profile.json',import.meta.url),'utf8'));
const runtime={oneBotBase:'http://127.0.0.1:3000/',oneBotToken:'a'.repeat(32),hubToken:'b'.repeat(32),hubPort:3789};
test('LLBot preparation preserves the protected group and stages only authenticated loopback OneBot',()=>{
 const defaults={webui:{host:'0.0.0.0'},milky:{enable:true},satori:{enable:true},ob11:{},log:true};const before=structuredClone(defaults);
 const c=buildLLBotConfig({runtime,profile,defaults});assert.deepEqual(defaults,before);assert.equal(c.webui.host,'127.0.0.1');assert.equal(c.milky.enable,false);assert.equal(c.satori.enable,false);
 assert.equal(c.ob11.connect[0].token,runtime.oneBotToken);assert.equal(c.ob11.connect[1].token,runtime.hubToken);assert.equal(c.ob11.connect[1].enable,false);assert.equal(c.ob11.connect[1].reportOfflineMessage,false);assert(c.msgCacheExpire*1000>profile.modelTimeoutMs);
 assert.throws(()=>buildLLBotConfig({runtime:{...runtime,oneBotBase:'http://192.0.2.1/'},profile,defaults}),/LOOPBACK/);
 assert.throws(()=>buildLLBotConfig({runtime,profile:{...profile,botId:'not-an-account'},defaults}),/ACCOUNT/);
 assert.throws(()=>buildLLBotConfig({runtime,profile:{...profile,additionalGroups:profile.additionalGroups.map(g=>({...g,replyPolicy:'adaptive'}))},defaults}),/PROTECTED/);
});
test('LLBot panel authentication alone cannot establish actual QQ online or group membership',async()=>{
 let writes=0;const fetchFn=async(url,options={})=>{const u=new URL(url);if(options.method==='POST'&&u.port==='3000')return new Response('unavailable',{status:503});
 if(u.pathname==='/api/login-info'){assert.equal(options.headers['X-Webui-Token'],createHash('sha256').update('local-panel-password').digest('hex'));return Response.json({success:true,data:{online:true,mode:'pmhq'}});}
 if(u.pathname==='/api/maintenance')return Response.json({profile:'set-theory',queued:0,active:0});writes+=options.method==='POST'?1:0;return new Response('panel');};
 const h=await probeLLBot({runtime,webuiToken:'local-panel-password',fetchFn});assert.equal(h.panelAuthenticated,true);assert.equal(h.panelSessionOnline,true);assert.equal(h.qqOnline,false);assert.equal(h.allGroupsVerified,false);assert.equal(writes,0);
});
test('LLBot acceptance independently checks actual account, online status and all four groups',async()=>{
 for(const scenario of ['good','wrong-account','missing-group']){
 const calls=[];const fetchFn=async(url,options={})=>{const u=new URL(url);calls.push(u.pathname);if(u.port!=='3000')return u.pathname==='/api/maintenance'?Response.json({profile:'set-theory'}):Response.json({success:true,data:{mode:'pmhq'}});
 assert.equal(options.headers.authorization,'Bearer '+runtime.oneBotToken);const data=u.pathname==='/get_status'?{online:true}:u.pathname==='/get_login_info'?{user_id:scenario==='wrong-account'?12345:2000000002}:LLBOT_GROUPS.slice(0,scenario==='missing-group'?3:4).map(group_id=>({group_id}));return Response.json({status:'ok',retcode:0,data});};
 const h=await probeLLBot({runtime,webuiToken:'panel',fetchFn});assert.equal(h.allGroupsVerified,scenario==='good');assert.equal(h.accountMismatch,scenario==='wrong-account');assert.equal(h.qqOnline,scenario!=='wrong-account');assert(calls.every(p=>!p.startsWith('/send')));
 }
});
test('real LLBot SHA1 webhook form reaches the protected Hub only after signature validation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'llbot-hmac-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0;
 const c={...profile,mode:'live',groupId:'1000000004',additionalGroups:[],replyPolicy:'mentions-only',perUserIntervalMs:0,attention:{enabled:false},privateMessages:{enabled:false}};
 const hub=await createTeachingHub({config:c,model:{kind:'live',diagnostics:{},generate:async()=>{calls++;throw Error('no inference in ingestion test');}},transport:{kind:'live',diagnostics:{},send:async()=>assert.fail()},knowledge:{pageCount:0,catalog:[],search:()=>[]},runtimeRoot:root,token:runtime.hubToken,autoDrain:false});t.after(()=>hub.close());const address=await hub.listen();
 const payload={post_type:'message',message_type:'group',group_id:1000000004,self_id:2000000002,user_id:12345678,message_id:1,time:Date.now()/1000,message:[{type:'text',data:{text:'回，讨论哲学'}}]};
 const post=async(body,valid=true)=>{const raw=JSON.stringify(body);return fetch(address+'/api/onebot/event',{method:'POST',headers:{'content-type':'application/json','x-self-id':'2000000002','x-signature':'sha1='+createHmac('sha1',valid?runtime.hubToken:'wrong').update(raw).digest('hex')},body:raw});};
 assert.equal((await post(payload,false)).status,403);let r=await post(payload);assert.equal(r.status,202);assert.equal((await r.json()).status,'context_only');
 r=await post({...payload,message_id:2,message:[{type:'at',data:{qq:'2000000002'}},{type:'text',data:{text:'回，请解释'}}]});assert.equal((await r.json()).status,'queued');assert.equal(calls,0);
});
