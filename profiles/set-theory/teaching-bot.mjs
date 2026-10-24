import {initialAttention,validateAttention,attentionDecision,attentionReply} from '../../src/domain/cognition/attention.js';
import {normalizeReplyPresentation} from './reply-layout.mjs';
import {personaInstructions,conversationMode,PERSONA_VERSION} from './persona.mjs';
import {formatQQReply,formatWebSources,cleanBotHistory} from './response-format.mjs';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { normalizeOneBotEvent, createOneBotEventDeduplicator, getEventDedupeKey } from '../../src/channels/qq/onebot-event.js';
import { validateTeachingState } from './local-durable-state.mjs';
import {wantsReading} from './reading-memory.mjs';

export const MODEL = 'gpt-6.1-sol';
export const EFFORT = 'high';
const topic = /集合论|序数|基数|共尾|可测|紧致|扩张子|良序|可数|不可数|选择公理|幂集|强迫|连续统|Jech|冯琦|\b(ZF|ZFC|ordinal|cardinal|cofinality|forcing|set theory)\b/i;
const addressed = /集合论助手|小助手/;
const question = /[?？]|怎么|为何|为什么|如何|解释|证明|什么|哪些|谁|哪里|能否|可否|能不能|有什么|怎么办|what|why|how/i;
const management = /^\/(?:admin|owner|model|effort|shell|exec|config|管理|模型|权限|执行|设置)(?:\s|$)/i;

export function validateProfile(config) {
  if(config.attention!==undefined&&(!config.attention||typeof config.attention.enabled!=='boolean'))throw Error('INVALID_ATTENTION_CONFIG');
  if(config.allowedGroupIds!==undefined&&(!Array.isArray(config.allowedGroupIds)||config.allowedGroupIds.length>16||!config.allowedGroupIds.includes(config.groupId)||config.allowedGroupIds.some(id=>typeof id!=='string'||!/^\d{4,20}$/.test(id))))throw new Error('INVALID_ALLOWED_GROUPS');
  if (!['offline', 'live'].includes(config.mode) || !(config.allowedGroupIds || [config.groupId]).includes(config.groupId) || !/^\d{4,20}$/.test(config.groupId||'') || typeof config.botId!=='string' || !/^\d{4,20}$/.test(config.botId) ||
      config.model !== MODEL || config.reasoningEffort !== EFFORT || config.automaticApiFallback !== false ||
      config.automaticModelDowngrade !== false || config.ownerId !== null) throw new Error('UNAPPROVED_PROFILE');
  for (const key of ['maxQueue', 'contextMessages', 'maxInputChars', 'modelTimeoutMs']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`INVALID_${key}`);
  }
  if(config.dailyModelCalls!==null&&(!Number.isSafeInteger(config.dailyModelCalls)||config.dailyModelCalls<1))throw new Error('INVALID_dailyModelCalls');
  for (const key of ['perUserIntervalMs', 'proactiveIntervalMs']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 0) throw new Error(`INVALID_${key}`);
  }
  for(const [key,max] of [['workerConcurrency',6],['perGroupConcurrency',3],['optionalConcurrency',2]])if(config[key]!==undefined&&(!Number.isInteger(config[key])||config[key]<1||config[key]>max))throw Error('INVALID_'+key);
  return Object.freeze({ ...config, replyPresentation:normalizeReplyPresentation(config.replyPresentation) });
}

export class TeachingBot {
  #config; #model; #transport; #knowledge; #root; #now; #sleep; #dedupe;
  #queue = []; #context = []; #lastUser = new Map(); #lastProactive = -Infinity;
  #day = ''; #calls = 0; #draining = null; #receipts = [];
  #resources = null;
  #reading = null;
  #attention=initialAttention();
  #store = null; #activeJobs = new Map(); #running = new Map(); #seen = new Map(); #faulted = false;
  constructor({ config, model, transport, knowledge, resources=null, reading=null, runtimeRoot, now = Date.now,
    sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
    this.#config = validateProfile(config);
    const requiredKind = config.mode === 'live' ? 'live' : 'mock';
    if (model?.kind !== requiredKind || transport?.kind !== requiredKind || typeof model.generate !== 'function' ||
        typeof transport.send !== 'function') throw new Error('LIVE_ADAPTER_NOT_APPROVED');
    this.#model = model; this.#transport = transport; this.#knowledge = knowledge;
    this.#resources=resources;
    this.#reading=reading;
    this.#root = resolve(runtimeRoot); this.#now = now; this.#sleep = sleep;
    this.#dedupe = createOneBotEventDeduplicator({ now });
  }
  static async open(options) {
    const bot = new TeachingBot(options);
    bot.#store = options.store || null;
    const state = await bot.#store?.load();
    if (state) {
      validateTeachingState(state,{groupId:bot.#config.groupId,botId:bot.#config.botId});
      bot.#queue = state.queue; bot.#context = cleanBotHistory(state.context,bot.#config.botId); bot.#seen = new Map(state.seen);
      bot.#lastUser = new Map(state.lastUser); bot.#day = state.day; bot.#calls = state.calls;
      bot.#attention=state.attention?validateAttention(state.attention):initialAttention();
      bot.#lastProactive = state.lastProactive ?? -Infinity; bot.#receipts = state.receipts;
      for(const active of state.activeJobs||(state.active?[state.active]:[])){
        if(active.phase==='generating'&&!state.receipts.some(r=>r.eventId===active.job.event.raw.message_id&&r.delivered))bot.#queue.unshift(active.job);
        if(active.phase==='sending'&&!state.receipts.some(r=>r.eventId===active.job.event.raw.message_id&&r.delivered))bot.#receipts.push({eventId:active.job.event.raw.message_id,status:'delivery_uncertain_after_restart',delivered:false});
      }
      bot.#receipts = bot.#receipts.slice(-200);
      await bot.#checkpoint();
    }
    return bot;
  }
  async #checkpoint() {
    if (!this.#store) return;
    const state = { version:2, groupId:this.#config.groupId, botId:this.#config.botId,
      queue:this.#queue, active:[...this.#activeJobs.values()][0]||null, activeJobs:[...this.#activeJobs.values()], context:this.#context, seen:[...this.#seen],
      lastUser:[...this.#lastUser], day:this.#day, calls:this.#calls,
      attention:this.#attention, lastProactive:Number.isFinite(this.#lastProactive) ? this.#lastProactive : null, receipts:this.#receipts };
    try { await this.#store.save(state); } catch (error) { this.#faulted = true; throw error; }
  }
  get diagnostics() {
    return { attention:{enabled:this.#config.attention?.enabled===true,...this.#attention,recent:undefined,automatic:undefined}, queued: this.#queue.length, active: this.#activeJobs.size>0, activeCount:this.#activeJobs.size, modelCalls: this.#calls, receipts: structuredClone(this.#receipts), contextMessages: this.#context.length, storageFaulted:this.#faulted, personaVersion:PERSONA_VERSION, reading:this.#reading?.diagnostics||null };
  }
  async rememberProactive(text) {
    if(this.#faulted)throw Error('STORAGE_UNAVAILABLE');
    text=formatQQReply(text);if(!text)throw Error('EMPTY_PLAIN_TEXT');
    this.#context.push({senderId:this.#config.botId,text:text.slice(0,2000)});this.#context=this.#context.slice(-this.#config.contextMessages);await this.#checkpoint();
  }
  async #send(event, text, status, images=[]) {
    // QQ renders text literally; never expose Markdown bold delimiters.
    text = formatQQReply(text);
    if (!text) throw new Error("EMPTY_PLAIN_TEXT");
    let receipt;
    let timer;
    const active=this.#activeJobs.get(String(event.raw.message_id));if(active)active.phase='sending';
    await this.#checkpoint();
    try {
      const result = await Promise.race([
        this.#transport.send({ groupId: this.#config.groupId, replyTo: String(event.raw.message_id), question:event.text, text,images }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DELIVERY_TIMEOUT')), 30000); })
      ]);
      receipt = { eventId: String(event.raw.message_id), status, delivered: result?.ok === true && Boolean(result.messageId), replyId:result?.messageId?String(result.messageId):null, ...(result?.deliveryMode==='forward'?{deliveryMode:'forward',forwardId:result.forwardId||null,verified:result.verified===true,nodeCount:result.nodeCount}: {}) };
    } catch { receipt = { eventId: String(event.raw.message_id), status, delivered: false }; }
    finally { clearTimeout(timer); }
    if(receipt?.delivered)this.#attention=attentionReply(this.#attention,{now:this.#now(),senderId:event.senderId,delivered:true});
    // Do not retry an uncertain write: a timeout may have happened after delivery.
    if (receipt.delivered) { this.#context.push({ senderId: this.#config.botId, text: text.slice(0, 2000) }); this.#context = this.#context.slice(-this.#config.contextMessages); }
    this.#receipts.push(receipt);
    this.#receipts = this.#receipts.slice(-200);
    await this.#checkpoint();
    return receipt;
  }
  async #error(event, code) {
    const messages = {INPUT_TOO_LARGE:'消息过长，请分段提问。',QUEUE_FULL:'当前排队已满，请稍后重新提问。',
      DAILY_BUDGET:'今天助教已达到部署者设置的推理调用上限，请稍后再试或联系部署者。',
      EMPTY_ANSWER:'本次未能形成有效答案，请换一种说法重试。',
      MODEL_OR_RETRIEVAL_FAILURE:'本次回答未完成，可能是模型连接、检索或超时问题，请稍后重试。'};
    return this.#send(event, `${messages[code] || '服务暂不可用，请稍后重试。'}（${code}）`, 'service_error');
  }
  async ingest(payload) {
    if (this.#faulted) throw new Error('STORAGE_UNAVAILABLE');
    if (payload?.post_type !== 'message' || payload.message_type !== 'group' ||
        String(payload.group_id) !== this.#config.groupId || String(payload.self_id) !== this.#config.botId ||
        !/^\d{4,20}$/.test(String(payload.user_id)) || payload.message_id == null || String(payload.message_id).length > 128) return { status: 'ignored' };
    const normalized = normalizeOneBotEvent(payload);
    const event = {groupId:normalized.groupId,senderId:normalized.senderId,text:normalized.text,
      officialRobotMarker:normalized.officialRobotMarker,hasSelfAtSegment:normalized.hasSelfAtSegment,hasAtSegment:normalized.hasAtSegment,
      replyTo:Array.isArray(payload.message)?payload.message.find(s=>s.type==='reply'&&/^-?\d{1,20}$/.test(String(s.data?.id)))?.data?.id:null,
      files:normalized.files.map(() => ({unread:true})),images:Array.isArray(payload.message)?payload.message.filter(s=>s.type==='image').slice(0,3).map(()=>({unread:true})):[],raw:{message_id:String(payload.message_id)}};
    if (event.senderId === this.#config.botId || event.officialRobotMarker === true) return { status: 'ignored' };
    const key = `${event.groupId}:${getEventDedupeKey(event)}`;
    for (const [id, timestamp] of this.#seen) if (this.#now() - timestamp > 10 * 60_000) this.#seen.delete(id);
    if (this.#seen.has(key)) return {status:'duplicate'};
    if (this.#dedupe.remember(key)) return { status: 'duplicate' };
    if (this.#seen.size >= 10000) this.#seen.delete(this.#seen.keys().next().value);
    this.#seen.set(key, this.#now());
    const mandatory = event.hasSelfAtSegment;
    if (event.text.length > this.#config.maxInputChars) {
      if (mandatory) await this.#error(event, 'INPUT_TOO_LARGE');
      return { status: 'rejected' };
    }
    // Public context contains this allowlisted group's text only, never file paths or raw events.
    this.#context.push({ senderId: event.senderId, text: event.text.slice(0, 2000) });
    this.#context = this.#context.slice(-this.#config.contextMessages);
    if (management.test(event.text.trim())) {
      if (mandatory) await this.#send(event, '管理功能尚未配置，无法修改模型、权限或执行命令。', 'management_denied');
      return { status: 'management_denied' };
    }
    const recentTopic = this.#context.slice(-8).some(item => topic.test(item.text));
    const interest = topic.test(event.text) || event.text.replace(/\s/g,'').length>=6 || question.test(event.text) || addressed.test(event.text) || /帮我|请|推荐|查一下|找一下|有没有|你觉得|求助|建议/.test(event.text) || (recentTopic && event.text.length > 12);
    if (!mandatory && (!interest || (event.hasAtSegment && !event.hasSelfAtSegment) ||
        this.#now() - this.#lastProactive < this.#config.proactiveIntervalMs)) { await this.#checkpoint(); return { status: 'context_only' }; }
    if(!mandatory&&this.#config.attention?.enabled===true){const gate=attentionDecision(this.#attention,{now:this.#now(),text:event.text,senderId:event.senderId,topic:topic.test(event.text),question:question.test(event.text),addressed:addressed.test(event.text),cooldownMs:this.#config.proactiveIntervalMs});this.#attention=gate.state;if(!gate.allow){await this.#checkpoint();return {status:'context_only',attentionReason:gate.reason};}}
    if (this.#queue.length >= this.#config.maxQueue) {
      if (mandatory) await this.#error(event, 'QUEUE_FULL');
      return { status: 'queue_full' };
    }
    if (!mandatory) this.#lastProactive = this.#now();
    this.#queue.push({ event, mandatory, enqueuedAt:this.#now(), context: structuredClone(this.#context) });
    await this.#checkpoint();
    return { status: 'queued', mandatory };
  }
  peekJob(){
    if(this.#faulted||this.#activeJobs.size>=(this.#config.perGroupConcurrency||1))return null;
    const users=new Set([...this.#activeJobs.values()].map(a=>a.job.event.senderId));
    const waitingUsers=new Set();
    const ready=this.#queue.filter(j=>{const user=j.event.senderId;if(users.has(user)||waitingUsers.has(user))return false;waitingUsers.add(user);return true;});
    const job=ready.find(j=>j.mandatory)||ready[0];
    return job?{messageId:String(job.event.raw.message_id),senderId:job.event.senderId,mandatory:job.mandatory,enqueuedAt:job.enqueuedAt||0}:null;
  }
  startNext(){
    const next=this.peekJob();if(!next)return null;
    const index=this.#queue.findIndex(j=>String(j.event.raw.message_id)===next.messageId);
    const job=this.#queue.splice(index,1)[0];
    this.#activeJobs.set(next.messageId,{job,phase:'generating'});
    const promise=(async()=>{try{await this.#checkpoint();await this.#runJob(job);}finally{this.#activeJobs.delete(next.messageId);await this.#checkpoint();}})().finally(()=>this.#running.delete(next.messageId));
    this.#running.set(next.messageId,promise);return promise;
  }
  drain(){
    if(!this.#draining)this.#draining=(async()=>{while(this.#queue.length||this.#running.size){const task=this.startNext();if(task)await task;else if(this.#running.size)await Promise.race(this.#running.values());else break;}})().finally(()=>{this.#draining=null;});
    return this.#draining;
  }
  async #runJob(job){
      const {event,mandatory,context}=job;
      const delay = Math.max(0, (this.#lastUser.get(event.senderId) ?? -Infinity) + this.#config.perUserIntervalMs - this.#now());
      if (delay) await this.#sleep(delay);
      if(this.#reading){
        try{const reply=await this.#reading.command(event.text,{userId:event.senderId,messageId:event.raw.message_id,replyTo:event.replyTo});
          if(reply!==null){await this.#send(event,reply,'reading_command');await this.#checkpoint();return;}
        }catch{if(mandatory)await this.#send(event,'阅读记录暂时无法保存，请稍后重试。','service_error');await this.#checkpoint();return;}
      }
      const fileCommand=event.text.trim().match(/^\/(?:搜群文件|群文件|files)(?:\s+(.*))?$/i);
      if(fileCommand&&this.#resources){try{const files=await this.#resources.list(fileCommand[1]||'');const text=files.length?`找到${files.length}个群文件：\n`+files.slice(0,20).map((f,i)=>`${i+1}. ${f.name}\n编号：${f.id}；${(f.size/1048576).toFixed(2)} MB${f.folder?'；目录：'+f.folder:''}`).join('\n')+(files.length>20?'\n仅显示前20个，请增加关键词。':'')+'\n可用 /读群文件 编号 第N页 继续阅读。':'没有找到匹配的群文件。';await this.#send(event,text,'file_search');}catch{await this.#send(event,'群文件目录暂时无法获取，请稍后重试。','service_error');}finally{await this.#checkpoint();}return;}
      const day = new Date(this.#now()).toISOString().slice(0, 10);
      if (day !== this.#day) { this.#day = day; this.#calls = 0; }
      if (this.#config.dailyModelCalls!==null && this.#calls >= this.#config.dailyModelCalls) {
        if (mandatory) await this.#error(event, 'DAILY_BUDGET');
         await this.#checkpoint();
        return;
      }
      this.#calls++;
      if(this.#lastUser.size>=10000&&!this.#lastUser.has(event.senderId))this.#lastUser.delete(this.#lastUser.keys().next().value);
      this.#lastUser.set(event.senderId, this.#now());
      await this.#checkpoint();
      let timer;
      const abort = new AbortController();
      try {
        await mkdir(this.#root, { recursive: true });
        if (resolve(await realpath(this.#root)) !== this.#root) throw new Error('RUNTIME_SYMLINK');
        const workspace = await mkdtemp(join(this.#root, 'turn-'));
        const quotedMessage=event.replyTo&&typeof this.#transport.readQuote==='function'?await this.#transport.readQuote({groupId:event.groupId,messageId:String(event.replyTo)}).catch(()=>null):null;
        const readingText=[event.text,quotedMessage?.text].filter(Boolean).join('\n');
        const mode = conversationMode(readingText);
        const recommendation=wantsReading(readingText);
        let sources = mode === 'mathematics'||recommendation ? this.#knowledge.search(readingText, { limit: 4, maxCharacters: 16000 }) : [];
        if(recommendation&&this.#reading)sources=this.#reading.rank(sources,event.senderId);
        const request = {
          model: MODEL, reasoningEffort: EFFORT, billingRoute: 'chatgpt-plan',
          developerInstructions: personaInstructions, conversationMode: mode, context:cleanBotHistory(context,this.#config.botId), quotedMessage, question: event.text, sources,
          messageId:String(event.raw.message_id),hasMedia:Boolean(event.images.length||event.files.length),quotedMessageId:event.replyTo?String(event.replyTo):null,
          mandatory, cwd: workspace, tools: [], shellAccess: false, attachments: [],
          attachmentNotice: null, readingContext:this.#reading?.context(event.senderId)||null, recommendationRequested:recommendation
        };
        await writeFile(join(workspace, 'request.json'), JSON.stringify(request, null, 2), { flag: 'wx', mode: 0o600 });
        const answer = await Promise.race([
          this.#model.generate(structuredClone(request), { signal: abort.signal, onAdditionalModelCall:async()=>{const currentDay=new Date(this.#now()).toISOString().slice(0,10);if(currentDay!==this.#day){this.#day=currentDay;this.#calls=0;}if(this.#config.dailyModelCalls!==null&&this.#calls>=this.#config.dailyModelCalls)throw new Error('DAILY_BUDGET');this.#calls++;await this.#checkpoint();} }),
          new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('TIMEOUT')); }, this.#config.modelTimeoutMs); })
        ]);
        if (answer?.model !== MODEL || answer?.reasoningEffort !== EFFORT || answer?.billingRoute !== 'chatgpt-plan') throw new Error('MODEL_CONTRACT');
        if (answer.status === 'silent') {
          if (mandatory) await this.#error(event, 'EMPTY_ANSWER');
          return;
        }
        if (answer.status !== 'answer' || typeof answer.text !== 'string' || !answer.text.trim() || answer.text.length > 6000 || !Array.isArray(answer.citations)) throw new Error('INVALID_ANSWER');
        const byId = new Map((answer.resolvedSources||sources).map(s => [s.citation, s]));
        const inlineCitations = [...answer.text.matchAll(/[a-f0-9]{12}:p\d+/g)].map(match => match[0]);
        answer.citations = [...new Set([...answer.citations, ...inlineCitations])];
        if (answer.citations.some(id => !byId.has(id))) throw new Error('UNKNOWN_CITATION');
        const cited = [...new Set(answer.citations)].map(id => byId.get(id));
        const references = cited.length ? cited.map((s,i) => `〔${i+1}〕${s.title}，${s.referenceKind==='document-section'?'内容第':'PDF第'}${s.pdfPage}${s.referenceKind==='document-section'?'段':'页'}`).join('\n') : '';
        const webReferences = formatWebSources(answer.webSources || []);
        for (const [i, source] of cited.entries()) answer.text = answer.text.replace(new RegExp('\\[?' + source.citation + '\\]?', 'g'), `〔${i+1}〕`);
        const supplied=answer.resolvedSources||sources;
        const recorded=this.#reading?await this.#reading.observe({sources:supplied,citations:answer.citations,knowledgeTrace:answer.knowledgeTrace||[],messageId:event.raw.message_id,userId:event.senderId,recommendation}):[];
        const feedback=recorded.length?'资料编号：'+recorded.map(x=>x.id).join('、')+'；可用 /反馈 有帮助、已经会了、不感兴趣 或 意外收获。':'';
        const receipt=await this.#send(event, [answer.text, references, webReferences, feedback, request.attachmentNotice,...(answer.outgoingImages||[]).filter(i=>i.kind!=='local-sticker').map(i=>`图片：${i.title}；来源：${i.sourceUrl}；作者：${i.author||'见来源页面'}；许可：${i.license||'见来源页面'}`)].filter(Boolean).join('\n\n'), 'answer',answer.outgoingImages||[]);
        if(this.#reading&&receipt.delivered)await this.#reading.observe({sources:supplied,citations:answer.citations,knowledgeTrace:answer.knowledgeTrace||[],messageId:event.raw.message_id,userId:event.senderId,recommendation,delivered:true,replyId:receipt.replyId});
      } catch (error) {
        // No backend error text, path, prompt or credentials leak to the group.
        if (mandatory) await this.#error(event, error?.message==='DAILY_BUDGET'?'DAILY_BUDGET':'MODEL_OR_RETRIEVAL_FAILURE');
      } finally { clearTimeout(timer);  await this.#checkpoint(); }
  }
}
