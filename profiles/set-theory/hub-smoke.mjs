import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSimulationHost } from './simulation-host.mjs';
import { createKnowledgeBase } from './knowledge.mjs';

export async function runHubSmoke() {
  const config = JSON.parse(await readFile(new URL('./profile.json', import.meta.url), 'utf8'));
  const runtimeRoot = await mkdtemp(join(tmpdir(), 'qq-hub-offline-'));
  const host = await createSimulationHost({ config, knowledge: createKnowledgeBase(), runtimeRoot, autoDrain: false });
  try {
    const headers = { authorization: `Bearer ${host.token}` };
    const state = await fetch(host.baseUrl + '/api/state', { headers });
    const maintenance = await fetch(host.baseUrl + '/api/maintenance', { headers });
    const dashboard = await fetch(host.baseUrl + '/');
    if (state.status !== 200 || maintenance.status !== 200 || dashboard.status !== 200) throw new Error('HUB_HEALTH_FAILED');
    const payload = { post_type: 'message', message_type: 'group', group_id: config.groupId, self_id: config.botId,
      user_id: '12345678', message_id: 'hub-fixture-1', message: [
        { type: 'at', data: { qq: config.botId } }, { type: 'text', data: { text: 'Explain countable sets.' } }] };
    const response = await fetch(host.baseUrl + '/api/onebot/event', { method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (response.status !== 202) throw new Error('HUB_INGRESS_FAILED');
    await host.drain();
    const success = host.bot.diagnostics.receipts.length === 1 && host.bot.diagnostics.receipts[0].delivered === true;
    const evidence = { mode: 'offline', hubAdapter: 'src/channels/http/hub-http-server.js', success,
      stateStatus: state.status, maintenanceStatus: maintenance.status, dashboardStatus: dashboard.status,
      realQQMessages: 0, realModelCalls: 0, mockChildProcesses: host.protocol.length, mockDeliveries: host.deliveries.length,
      personalConfigLoaded: false, persistentAutoStart: false };
    console.log(JSON.stringify(evidence));
    if (!success) throw new Error('HUB_DELIVERY_FAILED');
    return evidence;
  } finally { await host.close(); }
}
