import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeachingBot, MODEL, EFFORT } from './teaching-bot.mjs';
import { createKnowledgeBase } from './knowledge.mjs';
const config = JSON.parse(await readFile(new URL('./profile.json', import.meta.url), 'utf8'));
let now = Date.now();
const bot = new TeachingBot({ config, knowledge: createKnowledgeBase(), runtimeRoot: await mkdtemp(join(tmpdir(), 'qq-demo-')),
  now: () => now, sleep: async ms => { now += ms; },
  model: { kind: 'mock', generate: async request => ({ status: 'answer', text: `离线模拟：已接收“${request.question}”`, citations: [], model: MODEL, reasoningEffort: EFFORT, billingRoute: 'chatgpt-plan' }) },
  transport: { kind: 'mock', send: async message => { console.log(JSON.stringify({ mockDelivery: message })); return { ok: true, messageId: 'mock-only' }; } }
});
for (const [id, text, at] of [[1, '普通聊天', false], [2, '讨论序数和基数', false], [3, '请解释共尾度', true]]) {
  await bot.ingest({ post_type: 'message', message_type: 'group', group_id: config.groupId, self_id: config.botId, user_id: '12345678', message_id: id,
    message: [...(at ? [{ type: 'at', data: { qq: config.botId } }] : []), { type: 'text', data: { text } }] });
}
await bot.drain(); console.log(JSON.stringify(bot.diagnostics));
