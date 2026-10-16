import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {applyExpressionPolicy,expressionInstructions} from './expression-policy.mjs';
import {formatQQReply,cleanBotHistory} from './response-format.mjs';
import {personaInstructions,PERSONA_VERSION} from './persona.mjs';
import {createLiveOneBot} from './live-onebot.mjs';
import {createBilibiliSite} from './bilibili-site.mjs';
import {createBilibiliCurator} from './bilibili-curator.mjs';
import {createScholarCurator} from './scholar-curator.mjs';
import {BilibiliExplorer} from './bilibili-explorer.mjs';

test('known mocking emoji and their variants never leak while mathematical text stays intact',()=>{
 const text='κ∈A，λ⊆B，2*3=6。 (｡•ᴗ•｡) 😄🌸';
 assert.equal(applyExpressionPolicy(text),text);
 const noisy='明白了😂️🤣😅🙃😏🙄🤡🖕🏽😒😡😠🤬🤢🤮👎🏽';
 assert.equal(applyExpressionPolicy(noisy),'明白了');
 assert.equal(applyExpressionPolicy(applyExpressionPolicy(noisy)),applyExpressionPolicy(noisy));
 assert.equal(formatQQReply('**κ** 是基数😂。'),'κ 是基数。');
 assert.equal(applyExpressionPolicy('滑稽这个词和小丑鱼都是正常文字。'),'滑稽这个词和小丑鱼都是正常文字。');
});
test('named QQ faces and verified CQ ids are removed without guessing unrelated ids',()=>{
 assert.equal(applyExpressionPolicy('好的[狗头]【滑稽】[鄙视][表情：笑哭][表情:狗头][Doge]/狗头。'),'好的。');
 assert.equal(applyExpressionPolicy('文字[CQ:face,id=179,sub_type=1][CQ:face,id=105][CQ:face,id=182]'),'文字');
 assert.equal(applyExpressionPolicy('[CQ:face,id=277][CQ:face,id=74]'),'[CQ:face,id=277][CQ:face,id=74]');
 assert.equal(applyExpressionPolicy('https://example.org/[狗头]/😂?x=1'),'https://example.org/[狗头]/😂?x=1');
});
test('old bot history follows expression policy while member quotes and source state are preserved',()=>{
 const history=[{senderId:'2000000002',text:'在呢😂[狗头]'},{senderId:'12345678',text:'我发了😂'}];
 const clean=cleanBotHistory(history,'2000000002');assert.equal(clean[0].text,'在呢');assert.equal(clean[1].text,'我发了😂');assert.equal(history[0].text,'在呢😂[狗头]');
 assert.ok(personaInstructions.includes(expressionInstructions));assert.equal(PERSONA_VERSION,'2026-10-17.2');
});
test('ordinary and proactive OneBot sends enforce the same policy at the final transport',async()=>{
 const groupId='1000000001',botId='2000000002',writes=[];let last;
 const transport=createLiveOneBot({baseUrl:'http://127.0.0.1:3000/',token:'x'.repeat(32),groupId,botId,allowProactive:true,fetchFn:async(url,opt)=>{
  const action=new URL(url).pathname;let data;
  if(action==='/get_login_info')data={user_id:botId};else if(action==='/get_group_list')data=[{group_id:groupId}];
  else if(action==='/send_group_msg'){last=JSON.parse(opt.body);writes.push(last);data={message_id:42};}
  else if(action==='/get_msg')data={message_type:'group',group_id:groupId,sender:{user_id:botId},message:last.message};
  else throw Error('UNEXPECTED_ACTION');
  return new Response(JSON.stringify({status:'ok',retcode:0,data}));
 }});
 await transport.send({groupId,replyTo:'1',text:'在呢😂[狗头]'});
 const receipt=await transport.sendProactive({groupId,text:'看看这个例子🤣\n\n题目[滑稽]\nhttps://example.org/paper'});
 assert.equal(writes[0].message.find(s=>s.type==='text').data.text,'在呢');
 assert.equal(writes[1].message[0].data.text,'看看这个例子\n\n题目\nhttps://example.org/paper');assert.equal(receipt.verified,true);
});
test('Bilibili final comment boundary sanitizes before length validation and hashes the sent text',async()=>{
 const uid='4000000004',video={bvid:'BV1234567890',aid:2,duration:120},calls=[];let publicText;
 const site=createBilibiliSite({expectedUid:uid,allowComments:true,vault:{get:async()=>({uid,cookies:'SESSDATA=fixture;bili_jct=fixture'})},fetchFn:async(url,opt)=>{
  calls.push(url.pathname);let data;
  if(url.pathname.endsWith('/nav'))data={mid:uid,isLogin:true};
  else if(url.pathname.endsWith('/view'))data=video;
  else if(url.pathname.endsWith('/reply/add')){publicText=opt.body.get('message');data={rpid:99};}
  else if(url.pathname.endsWith('/reply/detail'))data={root:{rpid:99,member:{mid:uid},content:{message:publicText}}};
  else throw Error('UNEXPECTED_ENDPOINT');
  return new Response(JSON.stringify({code:0,data}));
 }});
 await assert.rejects(site.comment(video,'hi😂'),/COMMENT_CONTENT_DENIED/);assert.equal(calls.length,0);
 const receipt=await site.comment(video,'这里把例子讲清楚了😂[狗头]');assert.equal(publicText,'AI学习笔记：这里把例子讲清楚了');
 assert.equal(receipt.contentHash,createHash('sha256').update(publicText).digest('hex'));assert.equal((await site.verifyComment(receipt)).verified,true);
});
test('Bilibili explorer sanitizes comments even with an injected custom site implementation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'expression-browse-')),video={bvid:'BV1234567890',aid:2,title:'fixture',url:'https://www.bilibili.com/video/BV1234567890',duration:120};let comment;
 const explorer=await BilibiliExplorer.open({root,site:{check:async()=>({connected:true,uidMatched:true}),feed:async()=>[video],comment:async(_v,text)=>{comment=text;return {rpid:'42'};},verifyComment:async()=>({verified:true})},media:{prepare:async()=>({video,frames:[]})},curator:{choose:async()=>({bvid:video.bvid}),review:async()=>({summary:'visible example',interestScore:0.9,share:false,commentWorthwhile:true,comment:'这个例子讲清楚了😏[鄙视]',evidenceTimes:[20],continueBrowsing:false})},transport:{check:async()=>({online:true,memberOfGroup:true})},config:{enabled:true,targetGroupId:'1000000001',intervalMs:1800000,maxSharesPerDay:1,maxCommentsPerDay:1,commentsEnabled:true}});
 assert.equal((await explorer.run()).status,'complete');assert.equal(comment,'这个例子讲清楚了');
});
test('independent Bilibili and scholarship model prompts include the shared expression rule without model inference',async()=>{
 const root=await mkdtemp(join(tmpdir(),'expression-curators-')),auth=join(root,'auth');await mkdir(auth);
 const access='fixture.'+Buffer.from(JSON.stringify({exp:4102444800})).toString('base64url')+'.fixture';await writeFile(join(auth,'auth.json'),JSON.stringify({tokens:{access_token:access,account_id:'fixture'}}));
 const calls=[],runtime={codexPath:'fixture',authHome:auth,isolatedHome:join(root,'home')};
 const fake=async options=>{calls.push(options);return {finalResponse:JSON.stringify({bvid:null,id:null,reason:'none',nextQueries:[]})};};
 const bili=createBilibiliCurator(runtime,{runTurn:fake}),scholar=createScholarCurator(runtime,{runTurn:fake});
 await bili.choose({candidates:[],interests:[],recent:[],workspace:root});await scholar.choose({candidates:[],interests:[],recent:[],workspace:root});
 assert.equal(calls.length,2);for(const call of calls){assert.ok(call.developerInstructions.includes(expressionInstructions));assert.equal(call.model,'gpt-6.1-sol');assert.equal(call.reasoningEffort,'high');assert.equal(call.dynamicTools.length,0);}
});
