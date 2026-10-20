import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializeAssistant} from '../../scripts/init-assistant.mjs';
import {validateProfile} from './teaching-bot.mjs';
import {createPlatformAccounts} from './platform-accounts.mjs';
import {createBilibiliSite} from './bilibili-site.mjs';
import {ReadingMemory} from './reading-memory.mjs';
import {createTeachingHub} from '../../src/app/teaching-hub.js';
import {createKnowledgeBase} from './knowledge.mjs';

test('fresh deployment uses operator account and groups, preserves secrets on repeated initialization',async()=>{
 const root=await mkdtemp(join(tmpdir(),'assistant-init-'));
 const r=await initializeAssistant({root,botId:'2888888888',groupIds:['1888888888','1888888889'],bilibiliUid:'4888888888'});
 const c=JSON.parse(await readFile(r.configPath,'utf8')),p=JSON.parse(await readFile(r.profilePath,'utf8'));
 assert.equal(validateProfile(p).botId,'2888888888');assert.equal(p.groupId,'1888888888');
 assert.deepEqual(p.allowedGroupIds,['1888888888','1888888889']);assert.equal(c.bilibiliUid,'4888888888');
 assert.equal(p.dailyModelCalls,null);assert.equal(p.autonomousBilibili.enabled,false);assert.equal(p.autonomousBilibili.commentsEnabled,false);
 assert.notEqual(c.hubToken,c.oneBotToken);
 await assert.rejects(initializeAssistant({root,botId:'2888888888',groupIds:['1888888888']}),/ALREADY_EXISTS/);
 assert.equal(JSON.parse(await readFile(r.configPath,'utf8')).hubToken,c.hubToken);
});

test('platform account binding is mandatory before authentication and rejects another saved account without network',async()=>{
 let fetched=0;
 const fetchFn=async()=>{fetched++;throw Error('UNEXPECTED_NETWORK');};
 const vault={get:async()=>({uid:'4999999999',cookies:'fixture-only'}),set:async()=>{}};
 await assert.rejects(createPlatformAccounts({vault,fetchFn}).startBilibili(),/UID_NOT_CONFIGURED/);
 await assert.rejects(createBilibiliSite({vault,fetchFn,expectedUid:'4888888888'}).check(),/WRONG_BILIBILI_ACCOUNT/);
 assert.equal(fetched,0);
});

test('reading state from a different configured group cannot be reused',async()=>{
 const root=await mkdtemp(join(tmpdir(),'assistant-reading-scope-')),file=join(root,'reading.json');
 await writeFile(file,JSON.stringify({version:1,groupId:'1888888888',items:[],events:[],deliveries:[]}));
 await ReadingMemory.open(file,{groupId:'1888888888'});
 await assert.rejects(ReadingMemory.open(file,{groupId:'1888888889'}),/INVALID_READING_STATE/);
});


test('configured non-example bot receives and persists a mention only in its own group',async()=>{
 const root=await mkdtemp(join(tmpdir(),'assistant-configured-hub-'));
 const r=await initializeAssistant({root,botId:'2888888888',groupIds:['1888888888']});
 const c=JSON.parse(await readFile(r.configPath,'utf8')),config=JSON.parse(await readFile(r.profilePath,'utf8'));
 let sent=0;const hub=await createTeachingHub({config,runtimeRoot:c.runtimeRoot,token:c.hubToken,autoDrain:false,knowledge:createKnowledgeBase(),model:{kind:'mock',generate:async()=>({status:'answer',text:'synthetic configured reply',citations:[],model:config.model,reasoningEffort:config.reasoningEffort,billingRoute:'chatgpt-plan'})},transport:{kind:'mock',send:async m=>{assert.equal(m.groupId,config.groupId);sent++;return {ok:true,messageId:'fixture-reply'};}}});
 try{
  const url=await hub.listen(0);
  const post=group_id=>fetch(url+'/api/onebot/event',{method:'POST',headers:{authorization:'Bearer '+c.hubToken,'content-type':'application/json'},body:JSON.stringify({post_type:'message',message_type:'group',self_id:config.botId,group_id,user_id:'5555555555',message_id:'fixture-mention',message:[{type:'at',data:{qq:config.botId}},{type:'text',data:{text:'hello'}}]})});
  assert.equal((await (await post('1888888889')).json()).status,'ignored');
  assert.equal((await (await post(config.groupId)).json()).status,'queued');await hub.drain();assert.equal(sent,1);
  const state=JSON.parse(await readFile(join(c.runtimeRoot,'state','teaching-state.json'),'utf8'));
  assert.equal(state.botId,config.botId);assert.equal(state.groupId,config.groupId);assert.equal(state.receipts.length,1);
 }finally{await hub.close();}
});

test('custom bot and group scoped memory survive an entire Hub restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'custom-memory-restart-'));
 const base=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));
 const config={...base,mode:'offline',botId:'2888888888',groupId:'1888888888',allowedGroupIds:['1888888888'],additionalGroups:[]};
 const options={config,runtimeRoot:root,token:'x'.repeat(32),autoDrain:false,knowledge:createKnowledgeBase(),model:{kind:'mock',generate:async()=>{throw Error('NO_MODEL_ALLOWED');}},transport:{kind:'mock',send:async()=>{throw Error('NO_QQ_ALLOWED');}}};
 const first=await createTeachingHub(options);await first.close();
 const second=await createTeachingHub(options);try{assert.equal(second.bot.diagnostics.longTermMemory.faulted,false);assert.equal(second.bot.diagnostics.longTermMemory.autoApply,false);}finally{await second.close();}
});
