import test from 'node:test';import assert from 'node:assert/strict';import {formatQQReply,cleanBotHistory} from './response-format.mjs';import {createLiveOneBot} from './live-onebot.mjs';
test('screenshot footer and spaced/invisible variants never reach QQ',()=>{
 for(const footer of ['本次未引用已检索教材；回答需独立核对。','本次未引用已检索教材。\n回答需要独立核对。','本 次 未 引 用 已 检 索 教 材；回\u200b答需独立核对。','**本次未引用已检索教材**；**回答需独立核对**。']){
  assert.equal(formatQQReply('我是群里的AI，什么都可以聊😄\n\n'+footer),'我是群里的AI，什么都可以聊😄');
 }
});
test('generic knowledge-boundary and confidence labels are removed, concrete math limits remain',()=>{
 assert.equal(formatQQReply('超出我的知识库范围。\n这些是可以相信的部分。\n这个概念可能不够准确。'),'');
 const text='这个论证需要选择公理。CH 在 ZFC 中不可判定。2*3=6。';assert.equal(formatQQReply(text),text);
});
test('old bot disclaimers are removed from model history without altering member text or original state',()=>{
 const history=[{senderId:'2000000002',text:'在呢。\n本次未引用已检索教材；回答需独立核对。'},{senderId:'12345678',text:'不要再说回答需独立核对。'}];const clean=cleanBotHistory(history);
 assert.equal(clean[0].text,'在呢。');assert.equal(clean[1].text,history[1].text);assert.match(history[0].text,/独立核对/);
});
test('final transport applies the screenshot policy independently of domain code',async()=>{
 let sent;const t=createLiveOneBot({baseUrl:'http://127.0.0.1:3000/',token:'x'.repeat(32),groupId:'1000000001',botId:'2000000002',fetchFn:async(url,opt)=>{const action=new URL(url).pathname;if(action==='/send_group_msg')sent=JSON.parse(opt.body);return {ok:true,json:async()=>({status:'ok',retcode:0,data:action==='/get_login_info'?{user_id:'2000000002'}:action==='/get_group_list'?[{group_id:'1000000001'}]:{message_id:42}})};}});
 await t.send({groupId:'1000000001',replyTo:'1',text:'**在呢**。\n本 次 未引用已检索教材；回答需独立核对。'});assert.equal(sent.message.find(s=>s.type==='text').data.text,'在呢。');
});
test('quoted text is bounded and must belong to the same allowlisted group',async()=>{
 let data={message_type:'group',group_id:'1000000001',sender:{user_id:'12345678'},message:[{type:'text',data:{text:'引用内容'}},{type:'file',data:{file:'C:/private/file.pdf'}}]};let reads=0;
 const t=createLiveOneBot({baseUrl:'http://127.0.0.1:3000/',token:'x'.repeat(32),groupId:'1000000001',botId:'2000000002',fetchFn:async()=>{reads++;return {ok:true,json:async()=>({status:'ok',retcode:0,data})};}});
 assert.equal((await t.readQuote({groupId:'1000000001',messageId:'42'})).text,'引用内容');
 data={...data,group_id:'99999'};assert.equal(await t.readQuote({groupId:'1000000001',messageId:'42'}),null);
 assert.equal(await t.readQuote({groupId:'99999',messageId:'42'}),null);assert.equal(reads,2);
});

test('public-topic lookup recognizes ordinary public interests without sending group text',async()=>{
 const {choosePublicTopics,publicTopicLabels,needsPublicLookup}=await import('./public-topics.mjs');
 assert.equal(needsPublicLookup('GTA6怎么又延期了',[]),true);
 assert.deepEqual(publicTopicLabels(choosePublicTopics('GTA6怎么又延期了')),['Grand Theft Auto VI']);
 assert(publicTopicLabels(choosePublicTopics('联网查自指引擎')).includes('Self-Reference ENGINE EnJoe'));
});
