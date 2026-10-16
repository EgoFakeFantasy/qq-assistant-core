import {syncDirectory} from '../../src/file-store.js';
import {mkdir,readFile,writeFile,rename,lstat,realpath,mkdtemp,unlink,open} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {publicQuery} from './public-fetch.mjs';
import {formatQQReply} from './response-format.mjs';
const broadInterests=['集合论','动画','游戏','音乐','生活日常'];
const interestList=(config,learned=[])=>[...new Set([...(config.interestScope==='broad'?broadInterests:[]),...queries(learned)])].slice(0,10);
const today=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
const codes=e=>/^[A-Z_0-9]+$/.test(e?.message||'')?e.message:'BROWSE_OPERATION_FAILED';
function queries(values){return [...new Set((values||[]).slice(0,3).flatMap(q=>{try{return [publicQuery(q).slice(0,80)];}catch{return [];}}))];}
export class BilibiliExplorer{
 #root;#file;#state;#site;#media;#curator;#transport;#config;#now;#busy=false;#onShare;#writeTail=Promise.resolve();
 constructor({root,state,site,media,curator,transport,config,now,onShare}){this.#root=root;this.#file=join(root,'browse-state.json');this.#state=state;this.#site=site;this.#media=media;this.#curator=curator;this.#transport=transport;this.#config=config;this.#now=now;this.#onShare=onShare;}
 static async open({root,site,media,curator,transport,config,now=Date.now,onShare=async()=>{}}){
  const TARGET=String(config.targetGroupId||'');
  if(!/^\d{4,20}$/.test(TARGET))throw Error('UNAPPROVED_BROWSE_CONFIG');
  if(!Number.isSafeInteger(config.intervalMs)||!Number.isInteger(config.maxSharesPerDay)||!Number.isInteger(config.maxCommentsPerDay)||config.intervalMs<1800000||config.maxSharesPerDay>4||config.maxCommentsPerDay>2||config.maxSharesPerDay<1||config.maxCommentsPerDay<1)throw Error('UNAPPROVED_BROWSE_CONFIG');
  root=resolve(root);await mkdir(root,{recursive:true});if(resolve(await realpath(root))!==root)throw Error('LINKED_BROWSE_ROOT');
  const file=join(root,'browse-state.json'),info=await lstat(file).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});if(info&&(!info.isFile()||info.isSymbolicLink()||info.size>4*1024*1024))throw Error('UNSAFE_BROWSE_STATE');
  const state=info?JSON.parse(await readFile(file,'utf8')):{version:1,targetGroupId:TARGET,nextRunAt:0,interests:['集合论','数理逻辑','数学直觉'],seen:[],visits:[],commentDay:'',comments:0,shareDay:'',shares:0,phase:'ready',lastError:null};
  if(info&&state.targetGroupId!==TARGET)throw Error('UNAPPROVED_BROWSE_CONFIG');
  if(state.version!==1||state.targetGroupId!==TARGET||!Array.isArray(state.visits)||!Array.isArray(state.seen)||state.visits.length>100||state.seen.length>1000)throw Error('INVALID_BROWSE_STATE');
  for(const visit of state.visits){if(visit.comment?.phase==='sending')visit.comment.phase='uncertain_after_restart';if(visit.share?.phase==='sending')visit.share.phase='uncertain_after_restart';}
  if(['discovering','watching','reviewing','posting','sharing'].includes(state.phase)){state.phase='interrupted';state.nextRunAt=now()+config.intervalMs;}
  if(config.interestScope==='broad')state.interests=interestList(config,state.interests);
  const e=new BilibiliExplorer({root,state,site,media,curator,transport,config,now,onShare});await e.#save();return e;
 }
 get diagnostics(){const s=this.#state;return {enabled:this.#config.enabled,busy:this.#busy,targetGroupId:this.#config.targetGroupId,phase:s.phase,nextRunAt:s.nextRunAt,lastError:s.lastError,interests:s.interests,intervalMs:this.#config.intervalMs,maxSharesPerDay:this.#config.maxSharesPerDay,maxCommentsPerDay:this.#config.maxCommentsPerDay,commentsEnabled:this.#config.commentsEnabled,interestScope:this.#config.interestScope||'mathematics',model:this.#curator.diagnostics,recent:s.visits.slice(-5).map(v=>({bvid:v.bvid,title:v.title,url:v.url,at:v.at,phase:v.phase,transcriptKind:v.transcriptKind,frameCount:v.frameCount,visualFramesSupplied:v.visualFramesSupplied,summary:v.summary,comment:v.comment,share:v.share}))};}
 get due(){return this.#config.enabled&&!this.#busy&&this.#now()>=this.#state.nextRunAt;}
 async #save(){const body=JSON.stringify(this.#state);if(Buffer.byteLength(body)>4*1024*1024)throw Error('BROWSE_STATE_TOO_LARGE');const task=this.#writeTail.then(async()=>{const p=this.#file+'.'+randomUUID()+'.pending';let handle;try{handle=await open(p,'wx',0o600);await handle.writeFile(body);await handle.sync();await handle.close();handle=null;await rename(p,this.#file);await syncDirectory(this.#root);await writeFile(join(this.#root,'browse-status.json'),JSON.stringify(this.diagnostics),{mode:0o600});}finally{await handle?.close();await unlink(p).catch(()=>{});}});this.#writeTail=task.catch(()=>{});return task;}
 async run({signal,manual=false}={}){
  if(this.#busy||!this.#config.enabled||(!manual&&!this.due))return {status:'not-due'};this.#busy=true;let visit,workspace;
  const state=this.#state,at=this.#now();state.nextRunAt=at+this.#config.intervalMs;state.phase='discovering';state.lastError=null;
  try{
   await this.#save();
   const online=await this.#transport.check();if(!online.online||!online.memberOfGroup)throw Error('TARGET_QQ_GROUP_OFFLINE');
   const identity=await this.#site.check({signal});if(!identity.connected||!identity.uidMatched)throw Error('BILIBILI_LOGIN_REQUIRED');
   for(const previous of state.visits.slice(-5))if(previous.comment?.phase==='submitted'&&previous.comment.rpid){
    try{const check=await this.#site.verifyComment(previous.comment,{signal});if(check.verified)previous.comment={...previous.comment,phase:'verified',verified:true};}catch(e){previous.comment.readbackReason=codes(e);}
   }
   await this.#save();
   const topic=state.interests[state.visits.length%Math.max(1,state.interests.length)]||'集合论';
   const candidates=[...await this.#site.discover(topic,{signal})];
   try{if(state.visits.length%3===2)candidates.push(...await this.#site.feed({signal}));else if(state.visits.length)candidates.push(...await this.#site.related(state.visits.at(-1).bvid,{signal}));}catch(e){if(/RESTRICTION|VERIFICATION|BACKOFF/.test(codes(e)))throw e;}
   const choices=[...new Map(candidates.filter(v=>v.duration>=10&&v.duration<=1800&&!state.seen.includes(v.bvid)).map(v=>[v.bvid,v])).values()].slice(0,12);
   if(!choices.length){state.phase='no-candidate';await this.#save();return {status:state.phase};}
   workspace=await mkdtemp(join(this.#root,'visit-'));
   const plan=await this.#curator.choose({candidates:choices,interests:state.interests,recent:state.visits.slice(-3).map(v=>({title:v.title,summary:v.summary})),workspace},{signal});
   if(plan.bvid===null){state.phase='no-interest';state.interests=queries(plan.nextQueries).length?interestList(this.#config,plan.nextQueries):state.interests;await this.#save();return {status:state.phase};}
   const selected=choices.find(v=>v.bvid===plan.bvid);if(!selected)throw Error('CURATOR_UNKNOWN_VIDEO');
   visit={bvid:selected.bvid,title:selected.title,url:selected.url,at:new Date(at).toISOString(),phase:'watching',comment:{phase:'not-requested'},share:{phase:'not-requested'}};state.visits.push(visit);state.visits=state.visits.slice(-100);state.seen.push(selected.bvid);state.seen=state.seen.slice(-1000);state.phase='watching';await this.#save();
   const evidence=await this.#media.prepare(selected.bvid,workspace,{signal});visit.transcriptKind=evidence.transcriptKind;visit.frameCount=evidence.frames.length;visit.scope=evidence.scope;visit.transcriptEnd=evidence.transcriptEnd;visit.duration=evidence.video.duration;visit.phase='reviewing';state.phase='reviewing';await this.#save();
   const review=await this.#curator.review(evidence,{signal});
   if(typeof review.summary!=='string'||!Number.isFinite(review.interestScore)||review.interestScore<0||review.interestScore>1||!Array.isArray(review.evidenceTimes)||review.evidenceTimes.some(t=>!Number.isFinite(t)||t<0||t>evidence.video.duration))throw Error('CURATOR_REVIEW_INVALID');
   visit.visualFramesSupplied=review.visualFramesSupplied||null;visit.summary=review.summary.slice(0,1500);visit.interestScore=review.interestScore;visit.evidenceTimes=review.evidenceTimes;
   state.interests=queries(review.nextQueries).length?interestList(this.#config,review.nextQueries):state.interests;
   const day=today(at);if(state.commentDay!==day){state.commentDay=day;state.comments=0;}if(state.shareDay!==day){state.shareDay=day;state.shares=0;}
   if(this.#config.commentsEnabled&&review.commentWorthwhile&&review.interestScore>=0.7&&state.comments<this.#config.maxCommentsPerDay&&review.evidenceTimes.length){
    const text=String(review.comment||'').trim();if(text.length>=12&&text.length<=320&&/\d{1,3}:\d{2}/.test(text)&&!/[\r\n]|https?:\/\/|@|看完全部|完整看完/.test(text)){
     signal?.throwIfAborted();state.phase='posting';visit.comment={phase:'sending'};state.comments++;await this.#save();
     try{const receipt=await this.#site.comment(evidence.video,text,{signal});visit.comment={phase:'submitted',...receipt};await this.#save();try{const readback=await this.#site.verifyComment(receipt,{signal});if(readback.verified)visit.comment={...visit.comment,phase:'verified',verified:true};else visit.comment.readbackReason='COMMENT_NOT_YET_VISIBLE';}catch(e){visit.comment.readbackReason=codes(e);}await this.#save();}
     catch(e){visit.comment={phase:'uncertain',reason:codes(e)};await this.#save();}
    }
   }
   if(review.share&&review.interestScore>=0.65&&state.shares<this.#config.maxSharesPerDay&&review.evidenceTimes.length){
    const text=formatQQReply(String(review.shareText||'').slice(0,1000));if(!text||text.length>700)throw Error('CURATOR_SHARE_INVALID');
    signal?.throwIfAborted();state.phase='sharing';visit.share={phase:'sending'};state.shares++;await this.#save();
    try{const publicText=text+'\n\n'+evidence.video.title+'\n'+evidence.video.url;const receipt=await this.#transport.sendProactive({groupId:this.#config.targetGroupId,text:publicText});if(receipt.ok&&receipt.verified)await this.#onShare(publicText).catch(()=>{});visit.share={phase:receipt.ok?'delivered':'uncertain',replyId:receipt.messageId||null,delivered:receipt.ok===true,verified:receipt.verified===true};}catch(e){visit.share={phase:'uncertain',reason:codes(e)};}await this.#save();
   }
   visit.phase='complete';state.phase='ready';await this.#save();return {status:'complete',bvid:visit.bvid,comment:visit.comment,share:visit.share};
  }catch(e){
   if(signal?.aborted){state.phase='deferred-for-mentions';state.lastError=null;if(visit){visit.phase='deferred';if(visit.comment.phase==='not-requested'&&visit.share.phase==='not-requested'){state.seen=state.seen.filter(id=>id!==visit.bvid);state.nextRunAt=this.#now()+300000;}}await this.#save();return {status:state.phase};}
   state.lastError=codes(e);state.phase=/LOGIN|VERIFICATION|RESTRICTION|BACKOFF/.test(state.lastError)?'authorization-or-backoff':'failed';if(visit){visit.phase='failed';visit.error=state.lastError;}await this.#save();return {status:state.phase,error:state.lastError};}
  finally{try{await this.#media.cleanup?.(workspace);}catch{state.lastError||='VIDEO_CACHE_CLEANUP_FAILED';}this.#busy=false;await this.#save();}
 }
}
