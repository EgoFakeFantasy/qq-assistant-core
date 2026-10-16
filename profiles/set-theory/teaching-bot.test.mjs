import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeachingBot, MODEL, EFFORT, validateProfile } from './teaching-bot.mjs';
import { createKnowledgeBase } from './knowledge.mjs';

const base = JSON.parse(await readFile(new URL('./profile.json', import.meta.url), 'utf8'));
const bookId = 'a'.repeat(64);
const kb = createKnowledgeBase({ version: 1, pages: [
  { bookId, title: 'Synthetic teaching fixture', page: 2, text: 'A countable set can be injected into the natural numbers.' },
  { bookId, title: 'Synthetic teaching fixture', page: 99, text: 'The cofinality of an ordinal is discussed here.' }
] });
const event = (id, text = '解释可数集合', mention = true, extra = {}) => ({
  post_type: 'message', message_type: 'group', self_id: base.botId,
  group_id: base.groupId, user_id: '12345678', message_id: id,
  message: [...(mention ? [{ type: 'at', data: { qq: base.botId } }] : []), { type: 'text', data: { text } }], ...extra
});
async function setup(config = {}, implementation) {
  let time = Date.UTC(2026, 9, 11);
  const requests = [], sent = [], waits = [];
  const root = await mkdtemp(join(tmpdir(), 'qq-teaching-test-'));
  const bot = new TeachingBot({ config: { ...base, ...config }, knowledge: kb, runtimeRoot: root,
    now: () => time, sleep: async ms => { waits.push(ms); time += ms; },
    model: { kind: 'mock', generate: async (r, options) => {
      requests.push(r);
      return implementation ? implementation(r, options) : { status: 'answer', text: '这是离线模拟答案。',
        model: MODEL, reasoningEffort: EFFORT, billingRoute: 'chatgpt-plan', citations: r.sources.slice(0, 1).map(s => s.citation) };
    } }, transport: { kind: 'mock', send: async message => { sent.push(message); return { ok: true, messageId: `sent-${sent.length}` }; } }
  });
  return { bot, root, sent, requests, waits, advance: ms => { time += ms; } };
}
test('strict group, account, private-message and bot-loop boundaries', async () => {
  const s = await setup();
  for (const patch of [{ group_id: '99999' }, { self_id: '99999' }, { message_type: 'private' },
    { user_id: base.botId }, { sender: { is_robot: true } }, { user_id: 'bad' }, { message_id: null }, { post_type: 'notice' }]) {
    assert.equal((await s.bot.ingest(event(1, undefined, true, patch))).status, 'ignored');
  }
  await s.bot.drain(); assert.equal(s.requests.length, 0); assert.equal(s.sent.length, 0);
});
test('@ answers with locked model, no tools and verified source labels', async () => {
  const s = await setup(); assert.equal((await s.bot.ingest(event(1))).status, 'queued'); await s.bot.drain();
  assert.equal(s.requests[0].model, MODEL); assert.equal(s.requests[0].reasoningEffort, EFFORT);
  assert.deepEqual(s.requests[0].tools, []); assert.equal(s.requests[0].shellAccess, false);
  assert.match(s.sent[0].text, /PDF第2页/); assert.equal(s.bot.diagnostics.receipts[0].delivered, true);
});
test('all allowed ordinary messages become context; topic priority and cooldown limit participation', async () => {
  const s = await setup(); assert.equal((await s.bot.ingest(event(1, '今天吃面', false))).status, 'context_only');
  assert.equal((await s.bot.ingest(event(2, '讨论基数', false))).status, 'queued');
  assert.equal((await s.bot.ingest(event(3, '讨论序数', false))).status, 'context_only');
  await s.bot.drain(); assert.equal(s.requests[0].context[0].text, '今天吃面');
  s.advance(base.proactiveIntervalMs); assert.equal((await s.bot.ingest(event(4, '小助手能解释一下吗？', false))).status, 'queued');
});
test('do not interject into messages explicitly addressed to another participant', async () => {
  const s = await setup(); const p = event(1, '证明序数性质', false); p.message.unshift({ type: 'at', data: { qq: '777777' } });
  assert.equal((await s.bot.ingest(p)).status, 'context_only');
});
test('duplicate webhook never causes duplicate model call or delivery', async () => {
  const s = await setup(); await s.bot.ingest(event(1)); assert.equal((await s.bot.ingest(event(1))).status, 'duplicate');
  await s.bot.drain(); assert.equal(s.requests.length, 1); assert.equal(s.sent.length, 1);
});
test('mandatory jobs precede other users optional jobs while each users questions remain ordered', async () => {
  const s = await setup(); await s.bot.ingest(event(1, '基数', false)); await s.bot.ingest(event(2, '为什么可数？'));
  await s.bot.ingest(event(3, '解释序数', true, {user_id:'87654321'}));
  await s.bot.drain(); assert.deepEqual(s.requests.map(r=>r.messageId), ['3','1','2']);
  assert.deepEqual(s.waits, [base.perUserIntervalMs]);
});
test('full queue gives explicit mandatory feedback', async () => {
  const s = await setup({ maxQueue: 1 }); await s.bot.ingest(event(1));
  assert.equal((await s.bot.ingest(event(2))).status, 'queue_full'); assert.match(s.sent[0].text, /QUEUE_FULL/);
});
test('daily budget fails closed; next UTC day resets only the profile budget', async () => {
  const s = await setup({ dailyModelCalls: 1 }); await s.bot.ingest(event(1)); await s.bot.ingest(event(2)); await s.bot.drain();
  assert.equal(s.requests.length, 1); assert.match(s.sent[1].text, /DAILY_BUDGET/);
  s.advance(86400000); await s.bot.ingest(event(3)); await s.bot.drain(); assert.equal(s.requests.length, 2);
});
test('unknown admin is denied, including sender-supplied owner claims', async () => {
  const s = await setup(); assert.equal((await s.bot.ingest(event(1, '/model cheap', true, { owner: true, sender: { role: 'owner' } }))).status, 'management_denied');
  await s.bot.drain(); assert.equal(s.requests.length, 0); assert.match(s.sent[0].text, /管理功能尚未配置/);
});
test('profile refuses changed model, billing fallback, admin and live adapters', async () => {
  for (const patch of [{ model: 'other' }, { reasoningEffort: 'low' }, { automaticApiFallback: true }, { ownerId: base.botId }, { mode: 'unrecognized' }]) {
    assert.throws(() => validateProfile({ ...base, ...patch }), /UNAPPROVED_PROFILE/);
  }
  assert.throws(() => new TeachingBot({ config: base, model: { kind: 'live' } }), /LIVE_ADAPTER_NOT_APPROVED/);
});
test('provider exception exposes no backend details and no fallback', async () => {
  const s = await setup({}, () => { throw new Error('secret backend path'); }); await s.bot.ingest(event(1)); await s.bot.drain();
  assert.equal(s.requests.length, 1); assert.match(s.sent[0].text, /MODEL_OR_RETRIEVAL_FAILURE/); assert.doesNotMatch(s.sent[0].text, /secret/);
});
test('model mismatch, invented citation and mandatory silence produce explicit errors', async () => {
  for (const patch of [{ model: 'cheap' }, { citations: ['invented:p1'] }, { status: 'silent' }, { billingRoute: 'paid-api' }]) {
    const s = await setup({}, () => ({ status: 'answer', text: 'test', model: MODEL, reasoningEffort: EFFORT, billingRoute: 'chatgpt-plan', citations: [], ...patch }));
    await s.bot.ingest(event(1)); await s.bot.drain(); assert.equal(s.bot.diagnostics.receipts[0].status, 'service_error');
  }
});
test('ordinary-model silence does not send anything', async () => {
  const s = await setup({}, () => ({ model: MODEL, reasoningEffort: EFFORT, billingRoute: 'chatgpt-plan', status: 'silent' }));
  await s.bot.ingest(event(1, '基数', false)); await s.bot.drain(); assert.equal(s.sent.length, 0);
});
test('timeout aborts the model and returns service feedback', async () => {
  let aborted = false;
  const s = await setup({ modelTimeoutMs: 10 }, (_r, { signal }) => new Promise(() => signal.addEventListener('abort', () => { aborted = true; })));
  await s.bot.ingest(event(1)); await s.bot.drain(); assert.equal(aborted, true); assert.equal(s.sent.length, 1);
});
test('each question gets a fresh workspace; no raw file paths cross into model input', async () => {
  const s = await setup(); const p = event(1); p.message.push({ type: 'file', data: { name: 'test.pdf', file: 'C:/private/secret.pdf' } });
  await s.bot.ingest(p); await s.bot.ingest(event(2)); await s.bot.drain();
  assert.notEqual(s.requests[0].cwd, s.requests[1].cwd); assert.equal((await readdir(s.root)).length, 2);
  assert.deepEqual(s.requests[0].attachments, []); assert.doesNotMatch(JSON.stringify(s.requests), /C:\/private/);
});
test('Chinese query can retrieve an English page with stable PDF page citation', () => {
  const hit = kb.search('什么是共尾度？')[0]; assert.equal(hit.pdfPage, 99); assert.equal(hit.printedPage, null);
  assert.equal(hit.citation, 'aaaaaaaaaaaa:p99'); assert.deepEqual(kb.search('zzunknownword'), []);
});
test('oversize @ receives explicit error and bounded context never grows indefinitely', async () => {
  const s = await setup({ contextMessages: 3 }); await s.bot.ingest(event(1, 'x'.repeat(12001))); assert.match(s.sent[0].text, /INPUT_TOO_LARGE/);
  for (let i = 2; i < 10; i++) await s.bot.ingest(event(i, '普通聊天', false));
  assert.equal(s.bot.diagnostics.contextMessages, 3);
});
test('explicit page lookup never accepts a local path or invents a missing page', () => {
  assert.equal(kb.readPage(bookId, 99).pdfPage, 99);
  assert.equal(kb.readPage('C:/private/secret.pdf', 1), null);
  assert.equal(kb.readPage(bookId, 100), null);
});
test('failed or uncertain mock delivery is recorded and never retried', async () => {
  let attempts = 0;
  const bot = new TeachingBot({ config: base, knowledge: kb, runtimeRoot: await mkdtemp(join(tmpdir(), 'qq-delivery-')),
    model: { kind: 'mock', generate: async () => ({ status: 'answer', text: 'mock', citations: [], model: MODEL, reasoningEffort: EFFORT, billingRoute: 'chatgpt-plan' }) },
    transport: { kind: 'mock', send: async () => { attempts++; throw new Error('uncertain'); } } });
  await bot.ingest(event(1)); await bot.drain(); assert.equal(attempts, 1); assert.equal(bot.diagnostics.receipts[0].delivered, false);
});
test('term frequency ranks substantive pages ahead of a single passing mention', () => {
  const index = createKnowledgeBase({ pages: [
    { bookId, title: 'fixture', page: 1, text: 'forcing ' + 'preface '.repeat(100) },
    { bookId, title: 'fixture', page: 80, text: 'forcing conditions forcing extension forcing relation ' + 'definition '.repeat(50) }
  ] });
  assert.equal(index.search('forcing')[0].pdfPage, 80);
});


test('QQ delivery removes bold delimiters while preserving single-star mathematics', async () => {
  const s = await setup({}, r => ({status:'answer',text:'**基数**表示大小。\n2*3=6。未配对**也不显示。',
    model:MODEL,reasoningEffort:EFFORT,billingRoute:'chatgpt-plan',citations:r.sources.slice(0,1).map(p=>p.citation)}));
  await s.bot.ingest(event('plain-text')); await s.bot.drain();
  assert.equal(s.sent.length,1);
  assert.doesNotMatch(s.sent[0].text,/\*\*/);
  assert.match(s.sent[0].text,/基数表示大小/);
  assert.match(s.sent[0].text,/2\*3=6/);
  assert.match(s.sent[0].text,/PDF第2页/);
});

test('uncited familiar answers and casual questions have no defensive footer', async () => {
  const s = await setup({},()=>({status:'answer',text:'周末可以一起聊聊新看的书。',model:MODEL,reasoningEffort:EFFORT,billingRoute:'chatgpt-plan',citations:[]}));
  assert.equal((await s.bot.ingest(event('casual','周末有什么活动推荐？',false))).status,'queued');
  await s.bot.drain();assert.equal(s.sent[0].text,'周末可以一起聊聊新看的书。');
  assert.equal(s.requests[0].conversationMode,'conversation');
  assert.match(s.requests[0].developerInstructions,/模型自身已有知识/);
  assert.doesNotMatch(s.sent[0].text,/知识库范围|独立核对|可以相信/);
});
test('ordinary interest-sharing statements can enter optional conversation mode',async()=>{
 const s=await setup({},()=>({status:'silent',model:MODEL,reasoningEffort:EFFORT,billingRoute:'chatgpt-plan'}));
 assert.equal((await s.bot.ingest(event('new-topic','刚看完一本有意思的科幻小说',false))).status,'queued');await s.bot.drain();assert.equal(s.requests[0].conversationMode,'conversation');assert.equal(s.sent.length,0);
});
test('a quote is supplied to the model and can determine the mathematical context',async()=>{
 const requests=[];const quoted={messageId:'42',senderId:'12345678',text:'非零后继序数的共尾度是1。'};
 const bot=new TeachingBot({config:base,knowledge:kb,runtimeRoot:await mkdtemp(join(tmpdir(),'qq-quote-test-')),model:{kind:'mock',generate:async r=>{requests.push(r);return {status:'answer',text:'因为最后一个元素单独构成共尾子集。',citations:[],model:MODEL,reasoningEffort:EFFORT,billingRoute:'chatgpt-plan'};}},transport:{kind:'mock',readQuote:async r=>{assert.equal(r.messageId,'42');return quoted;},send:async()=>({ok:true,messageId:'sent'})}});
 const e=event('quote-question','为什么是这样？');e.message.unshift({type:'reply',data:{id:'42'}});await bot.ingest(e);await bot.drain();assert.deepEqual(requests[0].quotedMessage,quoted);assert.equal(requests[0].conversationMode,'mathematics');
});
