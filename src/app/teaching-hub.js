import {createPrivateScopes} from '../../profiles/set-theory/private-scopes.mjs';
import {LongTermMemory} from '../../profiles/set-theory/long-term-memory.mjs';
import {PERSONA_VERSION} from '../../profiles/set-theory/persona.mjs';
import {QuestionWorkerPool} from '../../profiles/set-theory/question-worker-pool.mjs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { createHubHttpServer } from '../channels/http/hub-http-server.js';
import { createConcurrencyLimiter } from '../concurrency-limiter.js';
import { requestHasValidToken } from '../request-auth.js';
import { readBody, sendJson, HttpError, isLoopbackAddress, isLoopbackRequestHost, isRequestOriginSameHost } from '../http-utils.js';
import { TeachingBot } from '../../profiles/set-theory/teaching-bot.mjs';
import { LocalDurableState } from '../../profiles/set-theory/local-durable-state.mjs';

// Isolated application composition using the production Hub HTTP adapter.
// No fallback into legacy commands, other groups, model selection, or tools.
export async function createTeachingHub({ config, model, transport, knowledge, resources=null, reading=null, memory=null, runtimeRoot, token, autoDrain = true, privateAdapters = null, additionalScopes = [], backgroundStatus = () => null, runAutonomousBrowse = null, scholarStatus = () => null, runAutonomousScholar = null, idleReadingStatus = () => null }) {
  if (typeof token !== 'string' || token.length < 24) throw new Error('AUTH_TOKEN_REQUIRED');
  memory ||= await LongTermMemory.open(join(runtimeRoot,'long-term-memory'),{groupId:config.groupId,botId:config.botId,personaVersion:PERSONA_VERSION,personaEvolution:config.personaEvolution?.enabled===true,socialMemory:config.socialMemory?.enabled===true,timeZone:config.quotaTimeZone});
  const bot = await TeachingBot.open({ config, model, transport, knowledge, resources, reading, memory,
    runtimeRoot: join(runtimeRoot, 'turns'), store: new LocalDurableState(join(runtimeRoot, 'state'),{groupId:config.groupId,botId:config.botId}) });
  const scopes=new Map([[config.groupId,{config,bot,model,transport,knowledge,memory}]]);
  for(const scope of additionalScopes){
    if(!config.allowedGroupIds?.includes(scope.config.groupId)||scopes.has(scope.config.groupId)||scope.config.botId!==config.botId)throw Error('UNAPPROVED_GROUP_SCOPE');
    const scopedMemory=scope.memory||await LongTermMemory.open(join(scope.runtimeRoot,'long-term-memory'),{groupId:scope.config.groupId,botId:scope.config.botId,personaVersion:PERSONA_VERSION,personaEvolution:scope.config.personaEvolution?.enabled===true,socialMemory:scope.config.socialMemory?.enabled===true,timeZone:scope.config.quotaTimeZone});
    const scopedBot=await TeachingBot.open({...scope,memory:scopedMemory,runtimeRoot:join(scope.runtimeRoot,'turns'),store:new LocalDurableState(join(scope.runtimeRoot,'state'),{groupId:scope.config.groupId,botId:scope.config.botId})});
    scopes.set(scope.config.groupId,{...scope,bot:scopedBot,memory:scopedMemory});
  }
  const controller = new AbortController();
  const limiter = createConcurrencyLimiter(1, { maxPending: 32 });
  const failures = [];
  let closing = false, closePromise;
  const workers=new QuestionWorkerPool(scopes,{concurrency:config.workerConcurrency||1,perGroup:config.perGroupConcurrency||1,optional:config.optionalConcurrency||1,onError:()=>{failures.push('TEACHING_DRAIN_FAILED');if(failures.length>20)failures.shift();}});
  const direct=await createPrivateScopes({config,runtimeRoot,authorize:privateAdapters?.authorize,createAdapters:privateAdapters?.createAdapters,authorizationKind:privateAdapters?.authorizationKind,onScope:scope=>{scopes.set(scope.config.groupId,scope);workers.addScope(scope);}});
  function drain(){return workers.drain();}
  function scheduleDrain() {
    if (autoDrain) void drain().catch(() => { failures.push('TEACHING_DRAIN_FAILED'); if (failures.length > 20) failures.shift(); });
  }
  function state() {
    const d = bot.diagnostics;
    const all=[...scopes.values()].map(s=>s.bot.diagnostics);
    const groups=[...scopes.values()].filter(s=>s.config.scopeType!=='private').map(s=>({groupId:s.config.groupId,name:s.config.groupName||null,...s.bot.diagnostics,receipts:undefined,transport:s.transport.diagnostics||null,indexedPages:s.knowledge.pageCount}));
    return { profile: 'set-theory', mode: config.mode, liveEnabled: config.mode === 'live', model: config.model,
      personaVersion: d.personaVersion, secondaryPersona:d.secondaryPersona, indexedPages: knowledge.pageCount, textbookCount: knowledge.catalog?.length || 0,
      channel:transport.diagnostics?.provider||'onebot',identityNamespace:transport.diagnostics?.identityNamespace||null,capabilities:transport.capabilities||null,
      dailyModelCallLimit: config.dailyModelCalls, proactiveIntervalMs: config.proactiveIntervalMs, longReplyForwardingEnabled:transport.capabilities?.forwardCards??true, replyPresentation:transport.diagnostics?.replyPresentation||config.replyPresentation||null, plainTextFilteringEnabled: true, cannedDisclaimerFilteringEnabled:true, autonomousTopicsEnabled:config.replyPolicy!=='mentions-only', quotedTextReadingEnabled:typeof transport.readQuote==='function',
      reasoningEffort: config.reasoningEffort, groupId: config.groupId, botId: config.botId,
      privateMessages:direct.diagnostics, quotaTimeZone:bot.diagnostics.quotaTimeZone, queued: all.reduce((n,g)=>n+g.queued,0), active:workers.diagnostics.active, bilibiliExplorer:backgroundStatus(), scholarExplorer:scholarStatus(), idleReading:idleReadingStatus(), workers:workers.diagnostics, groups, allowedGroupIds:groups.map(g=>g.groupId), modelCalls:all.reduce((n,g)=>n+g.modelCalls,0), storageFaulted:all.some(g=>g.storageFaulted), reading:d.reading, longTermMemory:d.longTermMemory,
      receiptCount: [...scopes.values()].reduce((n,s)=>n+s.bot.diagnostics.receipts.length,0), closing };
  }
  const server = createHubHttpServer({
    oneBotWebhookLimiter: limiter, shutdownSignal: controller.signal, sendJson,
    logger: { error() { failures.push('HTTP_REQUEST_FAILED'); if (failures.length > 20) failures.shift(); } },
    handleDashboardAsset: async (req, res) => {
      if (req.method !== 'GET' || req.url !== '/') return false;
      if (!isLoopbackAddress(req.socket.remoteAddress) || !isLoopbackRequestHost(req.headers.host)) {
        sendJson(res, 403, { error: 'Loopback required' }); return true;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' });
      res.end(config.mode === 'live'
        ? '<!doctype html><meta charset="utf-8"><title>集合论助手</title><h1>集合论助手</h1><p>指定群聊的后台服务。状态 API 需要认证。账号和模型连通性以实际验收记录为准。</p>'
        : '<!doctype html><meta charset="utf-8"><title>Set theory Hub — offline</title><h1>Set theory Hub: offline simulation</h1><p>Real QQ sending and real model calls are disabled. State and maintenance APIs require authentication. No administration commands are available.</p>');
      return true;
    },
    handleApi: async (req, res) => {
      const tokenAuthenticated = requestHasValidToken(req, token, { alternativeHeaders: ['x-onebot-access-token'] });
      const signature = req.headers['x-signature'];
      const signedEvent = req.method === 'POST' && req.url === '/api/onebot/event' &&
        typeof signature === 'string' && /^sha1=[a-f0-9]{40}$/.test(signature);
      if (!isLoopbackAddress(req.socket.remoteAddress) || !isLoopbackRequestHost(req.headers.host) ||
          (req.headers.origin && !isRequestOriginSameHost(req.headers.origin, req.headers.host)) ||
          (!tokenAuthenticated && !signedEvent)) {
        sendJson(res, 403, { error: 'Authenticated loopback request required' }); return;
      }
      if (closing) { sendJson(res, 503, { error: 'Hub closing' }); return; }
      if(req.method==='POST'&&req.url==='/api/maintenance/social-memory'){
        const body=await readBody(req,{requireJson:true,maxBytes:2048});
        if(!body||Object.keys(body).some(k=>!['groupId','persona','action','userId','query','messageId'].includes(k))||!['axu','hui'].includes(body.persona)||!['stats','cards','card','dialogue','search'].includes(body.action)||body.userId!==undefined&&(typeof body.userId!=='string'||!/^\d{4,20}$/.test(body.userId))||body.query!==undefined&&(typeof body.query!=='string'||body.query.length>300)||body.messageId!==undefined&&(typeof body.messageId!=='string'||body.messageId.length>128)){sendJson(res,400,{error:'INVALID_SOCIAL_MEMORY_REQUEST'});return;}
        const scope=scopes.get(body.groupId);if(!scope||scope.config.scopeType==='private'){sendJson(res,404,{error:'GROUP_NOT_FOUND'});return;}
        const value=scope.bot.socialMemoryQuery(body);sendJson(res,value===null||value===undefined?404:200,value??{error:'SOCIAL_MEMORY_UNAVAILABLE'});return;
      }
      if(req.method==='POST'&&req.url==='/api/maintenance/persona-review'){
        const body=await readBody(req,{requireJson:true,maxBytes:1024});
        if(!body||Object.keys(body).some(k=>!['groupId','persona','action','id','expectedRevision'].includes(k))||!['axu','hui'].includes(body.persona)||!['list','approve','reject','rollback'].includes(body.action)){sendJson(res,400,{error:'INVALID_PERSONA_REVIEW_REQUEST'});return;}
        const scope=scopes.get(body.groupId);
        if(!scope||scope.config.scopeType==='private'){sendJson(res,404,{error:'GROUP_NOT_FOUND'});return;}
        try{const result=body.action==='list'?await scope.bot.personaReview(body.persona):await scope.bot.decidePersona({persona:body.persona,id:body.id,decision:body.action,expectedRevision:body.expectedRevision});sendJson(res,result?200:404,result||{error:'PERSONA_EVOLUTION_DISABLED'});}
        catch(e){sendJson(res,409,{error:['PERSONA_REVIEW_STALE','PERSONA_REVIEW_STATE_CONFLICT','PERSONA_PROPOSAL_NOT_FOUND','PERSONA_PATCH_LIMIT','PERSONA_EVOLUTION_DISABLED'].includes(e.message)?e.message:'PERSONA_REVIEW_FAILED'});}return;
      }
      if(req.method==='POST'&&['/api/maintenance/bilibili/run','/api/maintenance/scholar/run'].includes(req.url)){
        const body=await readBody(req,{requireJson:true,maxBytes:128});
        if(!body||Object.keys(body).length){sendJson(res,400,{error:'EMPTY_OBJECT_REQUIRED'});return;}
        const run=req.url.includes('/scholar/')?runAutonomousScholar:runAutonomousBrowse;
        if(!run){sendJson(res,404,{error:'BROWSING_DISABLED'});return;}
        const task=run();if(!task){sendJson(res,409,{error:'QUESTIONS_HAVE_PRIORITY'});return;}
        void task.catch(()=>{});sendJson(res,202,{started:true});return;
      }
      if(req.method==='POST'&&req.url==='/api/maintenance/pause-workers'){await readBody(req,{requireJson:true,maxBytes:128});workers.pause();sendJson(res,200,workers.diagnostics);return;}
      if (req.method === 'GET' && req.url === '/api/state') { sendJson(res, 200, state()); return; }
      if (req.method === 'GET' && req.url === '/api/maintenance') {
        sendJson(res, 200, { ...state(), ...model.diagnostics, transport: transport.diagnostics || null,
          credentialChecksPerformed: [...scopes.values()].some(s=>s.model.diagnostics?.loginVerified===true), realQQCalls: [...scopes.values()].reduce((n,s)=>n+(s.transport.diagnostics?.sends||0),0),
          realModelCalls: [...scopes.values()].reduce((n,s)=>n+(s.model.diagnostics?.completedCalls||0),0),
          failureCount: failures.length, deploymentAccepted: false }); return;
      }
      if (req.url !== '/api/onebot/event') { sendJson(res, 404, { error: 'Route unavailable in teaching profile' }); return; }
      if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST required' }); return; }
      const payload = await readBody(req, { requireJson: true, maxBytes: 65536,
        verifyRawBody: tokenAuthenticated ? undefined : raw => {
          const expected = 'sha1=' + createHmac('sha1', token).update(raw).digest('hex');
          if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new HttpError(403, 'Invalid OneBot signature');
        } });
      const target=payload.message_type==='group'?scopes.get(String(payload.group_id)):null;
      const result=payload.message_type==='private'?await direct.ingest(payload):target?await target.bot.ingest(payload):{status:'ignored'};
      // Accepted is returned only after the durable checkpoint succeeds.
      sendJson(res, 202, result);
      scheduleDrain();
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return { server, bot, scopes, workers, failures, drain,
    async refreshPrivateScopes(){await direct.refresh?.();scheduleDrain();},
    async listen(port = 0) {
      if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('INVALID_PORT');
      await new Promise((resolve, reject) => {
        const fail = error => { server.off('listening', ready); reject(error); };
        const ready = () => { server.off('error', fail); resolve(); };
        server.once('error', fail); server.once('listening', ready); server.listen(port, '127.0.0.1');
      });
      scheduleDrain();
      return `http://127.0.0.1:${server.address().port}`;
    },
    close() {
      if (!closePromise) closePromise = (async () => {
        closing = true; controller.abort(); limiter.close();
        if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeIdleConnections?.(); });
        await drain();
        for(const scope of scopes.values())scope.memory?.close?.();
      })();
      return closePromise;
    }
  };
}
