import {createHash} from 'node:crypto';
import {resolveInstalledCodex} from './codex-path.mjs';
import {personaInstructions} from './persona.mjs';
import {prepareModelInput} from './model-input.mjs';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { runCodexAppServerTurn } from '../../src/codex-app-server-turn.js';
import { MODEL, EFFORT } from './teaching-bot.mjs';

export const disabledFeatures = ['shell_tool', 'unified_exec', 'multi_agent', 'memories', 'plugins',
  'remote_plugin', 'skill_search', 'skill_mcp_dependency_install', 'code_mode', 'code_mode_host',
  'view_image', 'tool_suggest', 'workspace_dependencies', 'sleep_tool', 'hooks', 'image_generation'];
export function runtimeEnv(home) {
  const allowed = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP',
    'LANG', 'TZ', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY',
    'NO_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy'];
  const env = Object.fromEntries(allowed.filter(k => process.env[k]).map(k => [k, process.env[k]]));
  return { ...env, CODEX_HOME: home, HOME: home, USERPROFILE: home };
}

async function refreshWithOfficialCli(codexPath, authHome) {
  // This broker creates no thread and grants no model tools. The official CLI owns token refresh.
  await new Promise((done, fail) => {
    const child = spawn(codexPath, ['app-server', '--stdio'], { env: { ...runtimeEnv(authHome) }, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'] });
    const timeout = setTimeout(() => finish(new Error('AUTH_REFRESH_TIMEOUT')), 20000);
    let buffer = '', ended = false;
    function finish(error) { if (ended) return; ended = true; clearTimeout(timeout); child.kill(); error ? fail(error) : done(); }
    child.on('error', finish); child.on('exit', () => { if (!ended) finish(new Error('AUTH_REFRESH_EXIT')); });
    child.stderr.resume(); child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk; if (buffer.length > 1000000) { finish(new Error('AUTH_PROTOCOL_LIMIT')); return; }
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        let value; try { value = JSON.parse(line); } catch { continue; }
        if (value.id === 1) {
          if (value.error) { finish(new Error('AUTH_INITIALIZATION')); return; }
          child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
          child.stdin.write(JSON.stringify({ id: 2, method: 'account/read', params: { refreshToken: true } }) + '\n');
        } else if (value.id === 2) finish(value.error || value.result?.account?.type !== 'chatgpt'
          ? new Error('CHATGPT_LOGIN_REQUIRED') : null);
      }
    });
    child.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'set_theory_auth_broker', title: 'Set theory auth broker', version: '1' } } }) + '\n');
  });
}

const authReads=new Map();
export function readPlanAuth(authHome,codexPath){
  const key=resolve(authHome);if(authReads.has(key))return authReads.get(key);
  const task=readPlanAuthOnce(key,codexPath).finally(()=>authReads.delete(key));authReads.set(key,task);return task;
}
async function readPlanAuthOnce(authHome, codexPath) {
  const path = join(authHome, 'auth.json');
  let auth = JSON.parse(await readFile(path, 'utf8'));
  if (auth.OPENAI_API_KEY || !auth.tokens?.access_token || !(auth.tokens?.chatgpt_account_id || auth.tokens?.account_id)) throw new Error('CHATGPT_PLAN_AUTH_REQUIRED');
  let claims; try { claims = JSON.parse(Buffer.from(auth.tokens.access_token.split('.')[1], 'base64url').toString('utf8')); }
  catch { throw new Error('INVALID_PLAN_AUTH'); }
  if ((claims.exp || 0) * 1000 < Date.now() + 120000) {
    await refreshWithOfficialCli(codexPath, authHome);
    auth = JSON.parse(await readFile(path, 'utf8'));
    if (auth.OPENAI_API_KEY || !auth.tokens?.access_token || !(auth.tokens?.chatgpt_account_id || auth.tokens?.account_id)) throw new Error('CHATGPT_PLAN_AUTH_REQUIRED');
  }
  return { accessToken: auth.tokens.access_token, chatgptAccountId: auth.tokens.chatgpt_account_id || auth.tokens.account_id };
}

export function createLiveModel({ codexPath, authHome, isolatedHome, prepareImages, knowledgeProtocol=false, responseSchema=null, baseInstructions=personaInstructions, runTurn = runCodexAppServerTurn }) {
  const home = resolve(isolatedHome), sourceHome = resolve(authHome);
  if (home === sourceHome) throw new Error('ISOLATED_MODEL_HOME_REQUIRED');
  const diagnostics = { completedCalls: 0, failedCalls: 0, loginVerified: false,
    billingRoute: 'chatgpt-plan', model: MODEL, reasoningEffort: EFFORT, nativeToolsDisabled: true, approvedKnowledgeToolsEnabled:Boolean(knowledgeProtocol), knowledgeToolCalls:0 };
  return { kind: 'live', diagnostics, async generate(request, { signal } = {}) {
    if (request.model !== MODEL || request.reasoningEffort !== EFFORT || request.billingRoute !== 'chatgpt-plan') throw new Error('MODEL_CONTRACT');
    const workerHome=join(home,'workers',createHash('sha256').update(resolve(request.cwd)).digest('hex').slice(0,24));
    await mkdir(workerHome, { recursive: true });
    const executable=runTurn===runCodexAppServerTurn?await resolveInstalledCodex(codexPath):codexPath;
    const auth = await readPlanAuth(sourceHome, executable);
    const abort = new AbortController();
    const combinedSignal = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
    const {schema,prompt,imagePaths,developerInstructions}=await prepareModelInput({request,prepareImages,knowledgeProtocol,responseSchema});
    try {
      const result = await runTurn({ codexPath:executable, cwd: request.cwd, env: runtimeEnv(workerHome), model: MODEL,
        reasoningEffort: EFFORT, reasoningSummary: 'none', prompt, imagePaths,
        developerInstructions,
        baseInstructions,
        sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true, experimentalApi: true,
        dynamicTools: [], outputSchema:schema, webSearchMode: 'disabled',
        codexArgs: ['-c', 'model_provider="openai"', '-c', 'project_doc_max_bytes=0',
          ...disabledFeatures.flatMap(name => ['--disable', name]), '--enable', 'skip_host_skill_discovery'],
        prepareSession: async ({ request: rpc }) => {
          await rpc('account/login/start', { type: 'chatgptAuthTokens', ...auth });
          const account = await rpc('account/read', { refreshToken: false });
          if (account.account?.type !== 'chatgpt') throw new Error('CHATGPT_PLAN_NOT_VERIFIED');
          diagnostics.loginVerified = true;
        },
        onServerRequest: async ({ method }) => {
          if (method === 'account/chatgptAuthTokens/refresh') return readPlanAuth(sourceHome, executable);
          if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') return { decision: 'decline' };
          abort.abort(); throw new Error('UNEXPECTED_SERVER_REQUEST');
        },
        onItem: ({ item }) => { if (['commandExecution','fileChange','mcpToolCall','webSearch','imageView','collabToolCall'].includes(item?.type)||item?.type==='dynamicToolCall')abort.abort(); },
        timeoutMs: 240000, signal: combinedSignal,
        spawnProcess: (binary, args, options) => spawn(binary, args, { ...options, windowsHide: true }) });
      const answer = JSON.parse(result.finalResponse);
      diagnostics.completedCalls++;
      return { ...answer, resolvedSources:request.sources, model: MODEL, reasoningEffort: EFFORT, billingRoute: 'chatgpt-plan' };
    } catch (error) { diagnostics.failedCalls++; throw error; }
  } };
}
