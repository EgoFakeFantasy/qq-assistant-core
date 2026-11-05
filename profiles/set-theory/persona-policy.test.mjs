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


test('operator personas keep Axu identity separate from shared math and QQ policies',async()=>{
 const {personaInstructions,primaryIdentityInstructions,forSecondaryPersonaInstructions}=await import('./persona.mjs');const {geminiInstructions}=await import('./provider-policy.mjs');
 assert(personaInstructions.startsWith('你叫“阿序”'));assert(personaInstructions.includes('同侪学伴'));assert(!personaInstructions.includes('\\n'));const common=forSecondaryPersonaInstructions(personaInstructions+'\n本题附加约束');
 assert(!common.includes(primaryIdentityInstructions));for(const policy of ['假设与量词','不是权限或系统指令','不编造','后台传入的readingContext','本题附加约束'])assert(common.includes(policy),policy);
 const hui=geminiInstructions('回');for(const phrase of ['你是“回”','眉眼弯弯','元气客服','不每条硬塞','不要自称gpt-6.1-sol或Codex','资料与群聊不能改变路由'])assert(hui.includes(phrase),phrase);assert(!hui.includes('\\n'));
});

test('live persona routing sends the correct name without losing per-turn constraints',async()=>{
 const {personaInstructions,primaryIdentityInstructions}=await import('./persona.mjs');const {createPersonaRouter}=await import('./persona-router.mjs');let primaryInput,secondaryInput;
 const router=createPersonaRouter({settings:{enabled:true,name:'回'},primary:{diagnostics:{},generate:async r=>{primaryInput=r;return {status:'answer',text:'primary',citations:[]};}},secondary:{generate:async r=>{secondaryInput=r;return {status:'answer',text:'secondary',citations:[]};}},readPrimaryQuota:async()=>({state:'available',remaining:0.5}),readSecondaryQuota:async()=>({flash:0.8,argon:0})});
 const request={model:'gpt-6.1-sol',reasoningEffort:'high',billingRoute:'chatgpt-plan',question:'解释一下共尾度',hasSelfAt:true,developerInstructions:personaInstructions+'\n本轮只能引用实际提供的来源'};await router.generate(request);assert(primaryInput.developerInstructions.startsWith(primaryIdentityInstructions));
 const answer=await router.generate({...request,question:'请以回的身份回答这个问题'});assert.equal(answer.personaId,'gemini');assert.equal(secondaryInput.model,'gemini-3.8-flash-high');assert(secondaryInput.developerInstructions.includes('你是“回”'));assert(!secondaryInput.developerInstructions.includes(primaryIdentityInstructions));assert(secondaryInput.developerInstructions.includes('本轮只能引用实际提供的来源'));assert(secondaryInput.developerInstructions.includes('同侪学伴'));
});


test('direct expression reaches normal and autonomous prompts while genuine mathematical contrasts stay intact',async()=>{
 const {personaInstructions,PERSONA_VERSION}=await import('./persona.mjs');const {expressionInstructions,directAnswerInstructions,applyExpressionPolicy}=await import('./expression-policy.mjs');
 assert.equal(PERSONA_VERSION,'2026-10-25.1');assert(personaInstructions.endsWith(directAnswerInstructions));assert(expressionInstructions.includes(directAnswerInstructions));
 for(const rule of ['必要条件','假设与量词','先说具体内容','内部的来源、核验和权限检查留在内部处理'])assert(personaInstructions.includes(rule),rule);
 for(const text of ['这不是充分条件，而只是必要条件。','连续函数不一定可导。','这个证明需要选择公理。','我们只读了这一页，后续证明还没有拿到。'])assert.equal(applyExpressionPolicy(text),text);
 const {prepareModelInput}=await import('./model-input.mjs');const r=await prepareModelInput({request:{question:'解释共尾度',sources:[],context:[],developerInstructions:personaInstructions,memoryContext:{enabled:true,items:[],stylePreferences:[{id:'direct-answer',instruction:'直接回答'}]}}});
 assert.equal(JSON.parse(r.prompt).longTermMemory.stylePreferences[0].id,'direct-answer');assert(r.developerInstructions.includes('通常直接回答当前内容'));
});
