import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {planReply,normalizeReplyPresentation,makeReplyNodes,parseForwardRecords,forwardReplyText} from './reply-layout.mjs';
import {createLiveOneBot} from './live-onebot.mjs';
import {TeachingBot,MODEL,EFFORT} from './teaching-bot.mjs';
import {createKnowledgeBase} from './knowledge.mjs';
const groupId='1000000001',botId='2000000002';
function mock({parentGroup=groupId,corrupt=false,postError=false}={}){
 const calls=[];let nodes=[];
 const fetchFn=async(url,options)=>{
  const action=new URL(url).pathname.slice(1),body=JSON.parse(options.body);calls.push({action,body});
  let data;
  if(action==='get_login_info')data={user_id:botId,nickname:'Assistant'};
  else if(action==='get_group_list')data=[{group_id:groupId}];
  else if(action==='send_group_forward_msg'){nodes=body.messages;if(postError)throw Error('NETWORK_RESULT_UNKNOWN');data={message_id:42,res_id:'res-1'};}
  else if(action==='send_group_msg')data={message_id:41};
  else if(action==='get_msg')data={message_type:'group',group_id:parentGroup,sender:{user_id:botId},message:[{type:'forward',data:{id:'res-1'}}]};
  else if(action==='get_forward_msg'){
   data={messages:nodes.map(n=>({sender:{user_id:n.data.user_id},content:n.data.content.filter(s=>s.type!=='reply')}))};
   if(corrupt)data.messages.pop();
  }else throw Error('UNEXPECTED_ACTION');
  return new Response(JSON.stringify({status:'ok',retcode:0,data}));
 };
 return {calls,fetchFn,get nodes(){return nodes;}};
}
const transport=m=>createLiveOneBot({baseUrl:'http://127.0.0.1:3000/',token:'x'.repeat(32),groupId,botId,allowProactive:true,fetchFn:m.fetchFn});
test('visible character and line thresholds fold only long replies',()=>{
 assert.equal(planReply('a'.repeat(500)).mode,'inline');
 assert.equal(planReply('a'.repeat(501)).mode,'forward');
 assert.equal(planReply(Array(12).fill('x').join('\n')).mode,'inline');
 assert.equal(planReply(Array(13).fill('x').join('\n')).mode,'forward');
 assert.equal(planReply('🌸'.repeat(500)).mode,'inline');
 assert.equal(planReply('x'.repeat(600),{inlineMaxCharacters:800}).mode,'inline');
 assert.throws(()=>normalizeReplyPresentation({inlineMaxCharacters:0}),/INVALID_REPLY/);
 assert.throws(()=>normalizeReplyPresentation({untrustedPath:'x'}),/INVALID_REPLY/);
 assert.throws(()=>planReply('x'.repeat(16001)),/OUTGOING_REPLY_LIMIT/);
});
test('paragraph splitting preserves every symbol without separating joined Unicode glyphs',()=>{
 const text=('定义：κ∈A。a\u0301 👩‍🔬\n\n'+('这是完整证明。'.repeat(110))+'\n').repeat(4)+'来源：https://example.org/paper';
 const plan=planReply(text);
 assert.equal(plan.parts.join(''),text);assert(plan.parts.length>2);
 const segmenter=new Intl.Segmenter('zh',{granularity:'grapheme'});
 for(const part of plan.parts)assert([...segmenter.segment(part)].length<=800);
 assert(!plan.parts.some(p=>p.startsWith('\u0301')||p.startsWith('\u200d')||p.endsWith('\u200d')));
});
test('long replies use one genuine forward card with bot-only nodes, original quote and checked images',async()=>{
 const root=await mkdtemp(join(tmpdir(),'forward-image-'));const image=join(root,'fixture.png');
 await writeFile(image,Buffer.from([137,80,78,71,13,10,26,10,0]));
 const m=mock(),t=transport(m),text='完整数学说明。'.repeat(130)+'\n〔1〕来源：https://example.org/paper';
 const receipt=await t.send({groupId,replyTo:'7',question:'请完整说明这个数学例子',text:'😂**'+text+'**',images:[{path:image}]});
 assert.equal(receipt.deliveryMode,'forward');assert.equal(receipt.verified,true);
 assert.equal(m.calls.filter(c=>c.action==='send_group_forward_msg').length,1);
 assert.equal(m.calls.filter(c=>c.action==='send_group_msg').length,0);
 assert(m.nodes.every(n=>n.data.user_id===botId&&n.data.nickname==='Assistant'));
 assert.equal(m.nodes[0].data.content[0].data.id,'7');
 assert.match(m.nodes[0].data.content.find(s=>s.type==='text').data.text,/回复：请完整说明这个数学例子/);
 assert.equal(m.nodes.at(-1).data.content[0].type,'image');
 assert.match(m.nodes.at(-1).data.content[0].data.file,/^base64:\/\//);
 assert.equal(m.nodes.slice(1).flatMap(n=>n.data.content).filter(s=>s.type==='text').map(s=>s.data.text).join(''),text);
 assert.equal(t.diagnostics.forwardReadbacks,1);
});
test('proactive video and paper shares obey the same folding threshold',async()=>{
 const m=mock(),t=transport(m);const receipt=await t.sendProactive({groupId,text:'资料推荐。'.repeat(130)});
 assert.equal(receipt.deliveryMode,'forward');assert.equal(receipt.verified,true);
 assert(!m.nodes[0].data.content.some(s=>s.type==='reply'));
});
test('uncertain forward writes are never retried or replaced by a long plain message',async()=>{
 const m=mock({postError:true}),t=transport(m);
 await assert.rejects(t.send({groupId,replyTo:'7',text:'x'.repeat(501)}),/NETWORK_RESULT_UNKNOWN/);
 assert.equal(m.calls.filter(c=>c.action.startsWith('send_')).length,1);
 assert.equal(t.diagnostics.failedSends,1);
});
test('truncated and wrong-scope readbacks cannot be accepted as verified cards',async()=>{
 const broken=mock({corrupt:true});assert.equal((await transport(broken).send({groupId,replyTo:'7',text:'x'.repeat(900)})).verified,false);
 const wrong=mock({parentGroup:'999999999'});assert.equal((await transport(wrong).send({groupId,replyTo:'7',text:'x'.repeat(900)})).verified,false);
 assert(!wrong.calls.some(c=>c.action==='get_forward_msg'));
});
test('replying to our card reads its full text and images only after parent group and author checks',async()=>{
 const m=mock(),t=transport(m),text='完整回答。'.repeat(220);
 await t.send({groupId,replyTo:'7',text});
 const quote=await t.readQuote({groupId,messageId:'42'});assert.equal(quote.text,text);
 const media=await t.messageMedia('42');assert.deepEqual(media.images,[]);
 const wrong=mock({parentGroup:'999999999'});await assert.rejects(transport(wrong).messageMedia('42'),/SCOPE/);
 assert.equal(await transport(wrong).readQuote({groupId,messageId:'42'}),null);
 assert(!wrong.calls.some(c=>c.action==='get_forward_msg'));
});
test('forward parser tolerates known node envelopes but rejects nested and foreign-sender payloads',()=>{
 const plan=planReply('x'.repeat(501));
 const nodes=makeReplyNodes({plan,botId,nickname:'Assistant'});
 assert.equal(forwardReplyText(parseForwardRecords({messages:nodes},botId)),'x'.repeat(501));
 const foreign=structuredClone(nodes);foreign[1].data.user_id='12345678';
 assert.throws(()=>parseForwardRecords({messages:foreign},botId),/INVALID_FORWARD/);
 const nested=structuredClone(nodes);nested[1].data.content=[{type:'node',data:{content:[]}}];
 assert.throws(()=>parseForwardRecords({messages:nested},botId),/INVALID_FORWARD/);
});
test('TeachingBot keeps the forward delivery mode and readback fact in its receipt',async()=>{
 const root=await mkdtemp(join(tmpdir(),'forward-receipt-'));
 const base=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));
 const m=mock(),t=transport(m);
 const bot=new TeachingBot({config:{...base,mode:'live'},knowledge:createKnowledgeBase({pages:[]}),runtimeRoot:root,transport:t,
 model:{kind:'live',generate:async()=>({status:'answer',text:'说明内容。'.repeat(140),citations:[],model:MODEL,reasoningEffort:EFFORT,billingRoute:'chatgpt-plan'})}});
 await bot.ingest({post_type:'message',message_type:'group',self_id:botId,group_id:groupId,user_id:'12345678',message_id:'7',message:[{type:'at',data:{qq:botId}},{type:'text',data:{text:'说明一下'}}]});
 await bot.drain();const receipt=bot.diagnostics.receipts[0];
 assert.equal(receipt.delivered,true);assert.equal(receipt.deliveryMode,'forward');assert.equal(receipt.verified,true);
 assert.equal(receipt.replyId,'42');assert(receipt.nodeCount>=2);
});
