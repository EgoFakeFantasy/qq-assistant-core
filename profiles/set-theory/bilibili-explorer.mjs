import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {publicQuery} from './public-fetch.mjs';
import {formatQQReply} from './response-format.mjs';
import {openAutonomyStore,autonomyDay,autonomyCode,platformBlocked} from './autonomy-store.mjs';
const broadInterests=['集合论','动画','游戏','音乐','生活日常'];
function queries(values){return [...new Set((values||[]).slice(0,4).flatMap(q=>{try{return [publicQuery(q).slice(0,80)];}catch{return [];}}))];}
const interests=(config,learned=[])=>[...new Set([...(config.interestScope==='broad'?broadInterests:[]),...queries(learned)])].slice(0,10);
const bounded=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;

export class BilibiliExplorer{
 #store;#state;#site;#media;#curator;#transport;#config;#now;#busy=false;#onShare;
 constructor({store,site,media,curator,transport,config,now,onShare}){this.#store=store;this.#state=store.state;this.#site=site;this.#media=media;this.#curator=curator;this.#transport=transport;this.#config=config;this.#now=now;this.#onShare=onShare;}
 static async open({root,site,media,curator,transport,config,now=Date.now,onShare=async()=>{}}){
  config={maxVideosPerCycle:1,maxCycleMs:1500000,maxLikesPerDay:12,minShareIntervalMs:1800000,...config};
  if(!/^\d{4,20}$/.test(config.targetGroupId||'')||!bounded(config.intervalMs,300000,86400000)||!bounded(config.maxSharesPerDay,0,12)||!bounded(config.maxCommentsPerDay,0,12)||!bounded(config.maxLikesPerDay,0,50)||!bounded(config.maxVideosPerCycle,1,6)||!bounded(config.maxCycleMs,60000,3600000))throw Error('UNAPPROVED_BROWSE_CONFIG');
  const store=await openAutonomyStore(root,{stateFile:'browse-state.json',statusFile:'browse-status.json',initial:()=>({version:1,targetGroupId:config.targetGroupId,nextRunAt:0,interests:['集合论','数理逻辑','数学直觉'],seen:[],visits:[],actions:{},day:'',comments:0,shares:0,likes:0,phase:'ready',lastError:null,browseMode:'feed',lastShareAt:0})});
  const s=store.state;if(s.targetGroupId!==config.targetGroupId)throw Error('UNAPPROVED_BROWSE_CONFIG');
  if(s.version!==1||!Array.isArray(s.visits)||!Array.isArray(s.seen)||s.visits.length>100||s.seen.length>1000)throw Error('INVALID_BROWSE_STATE');
  s.actionPauses??={};
  s.actions??={};if(typeof s.actions!=='object'||Array.isArray(s.actions)||Object.keys(s.actions).length>5000)throw Error('INVALID_BROWSE_STATE');
  // Migrate old receipts before trimming visit history.
  const completedVideos=new Set(s.visits.filter(v=>v.phase==='complete').map(v=>v.bvid));
  for(const v of s.visits){
   v.like??={phase:'not-requested'};
   if(!completedVideos.has(v.bvid)&&v.phase==='failed'&&!v.frameCount&&['like','comment','share'].every(k=>!v[k]||v[k].phase==='not-requested'))s.seen=s.seen.filter(id=>id!==v.bvid);
   for(const kind of ['like','comment','share']){
    if(v[kind]?.phase==='sending')v[kind].phase='uncertain_after_restart';
    if(v[kind]?.phase!=='not-requested'&&v[kind]?.phase)s.actions[v.bvid]??={};
    if(v[kind]?.phase!=='not-requested'&&v[kind]?.phase)s.actions[v.bvid][kind]=v[kind];
   }
  }
  for(const a of Object.values(s.actions))for(const k of ['like','comment','share'])if(a[k]?.phase==='sending')a[k].phase='uncertain_after_restart';
  const day=autonomyDay(now());
  if(!s.day){s.day=day;s.comments=s.commentDay===day?s.comments||0:0;s.shares=s.shareDay===day?s.shares||0:0;s.likes=0;}
  if(['discovering','watching','reviewing','posting','sharing','liking'].includes(s.phase)){s.phase='interrupted';s.nextRunAt=now()+config.intervalMs;}
  if(config.interestScope==='broad')s.interests=interests(config,s.interests);
  const e=new BilibiliExplorer({store,site,media,curator,transport,config,now,onShare});await e.#save();return e;
 }
 get diagnostics(){const s=this.#state,c=this.#config;return {enabled:c.enabled,busy:this.#busy,targetGroupId:c.targetGroupId,phase:s.phase,nextRunAt:s.nextRunAt,lastError:s.lastError,interests:s.interests,browseMode:s.browseMode||'search',intervalMs:c.intervalMs,maxVideosPerCycle:c.maxVideosPerCycle,maxSharesPerDay:c.maxSharesPerDay,maxCommentsPerDay:c.maxCommentsPerDay,maxLikesPerDay:c.maxLikesPerDay,likesEnabled:c.likesEnabled===true,commentsEnabled:c.commentsEnabled===true,actionPauses:s.actionPauses,budget:{day:s.day,likes:s.likes,comments:s.comments,shares:s.shares},interestScope:c.interestScope||'mathematics',model:this.#curator.diagnostics,recent:s.visits.slice(-6).map(v=>({...v}))};}
 get due(){return this.#config.enabled&&!this.#busy&&this.#now()>=this.#state.nextRunAt;}
 #save(){return this.#store.save(this.diagnostics);}
 #newDay(){const s=this.#state,d=autonomyDay(this.#now());if(s.day!==d){s.day=d;s.comments=0;s.shares=0;s.likes=0;}}
 async #record(v,kind,receipt){v[kind]=receipt;this.#state.actions[v.bvid]??={};this.#state.actions[v.bvid][kind]=receipt;await this.#save();}
 #mayWrite(v,kind){return !this.#state.actions[v.bvid]?.[kind]&&(this.#state.actions[v.bvid]||Object.keys(this.#state.actions).length<5000);}
 async #discover(signal,step){
  const s=this.#state,topic=s.interests[(s.visits.length+step)%Math.max(1,s.interests.length)]||'集合论',mode=s.browseMode||'search';
  let candidates=[];
  try{if(mode==='feed')candidates=await this.#site.feed({signal});else if(mode==='related'&&s.visits.length)candidates=await this.#site.related(s.visits.at(-1).bvid,{signal});}catch(e){if(platformBlocked(autonomyCode(e)))throw e;}
  // Search also provides a fresh route when a personal feed repeats old items.
  if(mode==='search'||!candidates.some(v=>!s.seen.includes(v.bvid)))candidates.push(...await this.#site.discover(topic,{signal,page:1+Math.floor(s.visits.length/10)%5,order:s.visits.length%3===1?'pubdate':'totalrank'}));
  return [...new Map(candidates.filter(v=>v.duration>=10&&v.duration<=1800&&!s.seen.includes(v.bvid)).map(v=>[v.bvid,v])).values()].slice(0,16);
 }
 async #reconcile(signal){
  for(const v of this.#state.visits.slice(-8)){
   try{
    if(v.comment?.phase==='submitted'&&v.comment.rpid){const r=await this.#site.verifyComment(v.comment,{signal});if(r.verified)await this.#record(v,'comment',{...v.comment,phase:'verified',verified:true});}
    if(['submitted','uncertain','uncertain_after_restart'].includes(v.like?.phase)&&this.#site.likeStatus){const r=await this.#site.likeStatus(v.bvid,{signal});if(r.liked&&r.verified)await this.#record(v,'like',{...v.like,...r,phase:'verified'});}
   }catch(e){if(platformBlocked(autonomyCode(e)))throw e;}
  }
 }
 async #actionFailure(v,kind,error){
  const reason=autonomyCode(error),apiCode=Number.isFinite(error.apiCode)?error.apiCode:null;
  if(apiCode===-403)this.#state.actionPauses[kind]={reason:'BILIBILI_ACTION_DENIED',apiCode,at:new Date(this.#now()).toISOString()};
  await this.#record(v,kind,{phase:apiCode===null?'uncertain':'rejected',reason,...(apiCode===null?{}:{apiCode})});if(platformBlocked(reason))throw error;
 }
 async #actions(v,evidence,review,signal){
  const s=this.#state,c=this.#config;this.#newDay();
  if(c.likesEnabled&&!s.actionPauses.like&&review.like===true&&s.likes<c.maxLikesPerDay&&this.#mayWrite(v,'like')){
   signal?.throwIfAborted();s.phase='liking';s.likes++;await this.#record(v,'like',{phase:'sending'});
   try{const r=await this.#site.like(evidence.video,{signal});await this.#record(v,'like',{...r,phase:r.verified&&r.liked?'verified':'submitted'});}catch(e){await this.#actionFailure(v,'like',e);}
  }
  if(c.commentsEnabled&&!s.actionPauses.comment&&review.commentWorthwhile&&review.interestScore>=0.65&&s.comments<c.maxCommentsPerDay&&review.evidenceTimes.length&&this.#mayWrite(v,'comment')){
   const text=String(review.comment||'').trim();
   if(text.length>=6&&text.length<=320&&!/[\r\n]|https?:\/\/|@|看完全部|完整看完/.test(text)){
    signal?.throwIfAborted();s.phase='posting';s.comments++;await this.#record(v,'comment',{phase:'sending'});
    try{const r=await this.#site.comment(evidence.video,text,{signal});await this.#record(v,'comment',{...r,phase:'submitted'});try{const check=await this.#site.verifyComment(r,{signal});await this.#record(v,'comment',{...v.comment,phase:check.verified?'verified':'submitted',verified:check.verified===true});}catch(e){v.comment.readbackReason=autonomyCode(e);await this.#save();}}
    catch(e){await this.#actionFailure(v,'comment',e);}
   }
  }
  if(review.share&&review.interestScore>=0.65&&s.shares<c.maxSharesPerDay&&review.evidenceTimes.length&&this.#now()-(s.lastShareAt||0)>=c.minShareIntervalMs&&this.#mayWrite(v,'share')){
   const text=formatQQReply(String(review.shareText||'').slice(0,1000));if(!text||text.length>700)throw Error('CURATOR_SHARE_INVALID');
   signal?.throwIfAborted();const health=await this.#transport.check();if(!health.online||!health.memberOfGroup)throw Error('TARGET_QQ_GROUP_OFFLINE');
   s.phase='sharing';s.shares++;s.lastShareAt=this.#now();await this.#record(v,'share',{phase:'sending'});
   try{const publicText=text+'\n\n'+evidence.video.title+'\n'+evidence.video.url;const r=await this.#transport.sendProactive({groupId:c.targetGroupId,text:publicText});await this.#record(v,'share',{phase:r.ok?'delivered':'uncertain',replyId:r.messageId||null,delivered:r.ok===true,verified:r.verified===true});if(r.ok&&r.verified)await this.#onShare(publicText).catch(()=>{});}
   catch(e){await this.#record(v,'share',{phase:'uncertain',reason:autonomyCode(e)});}
  }
 }
 async run({signal,manual=false}={}){
  if(this.#busy||!this.#config.enabled||(!manual&&!this.due))return {status:'not-due'};
  const parentSignal=signal;signal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(this.#config.maxCycleMs)]);
  this.#busy=true;const s=this.#state,at=this.#now();s.nextRunAt=at+this.#config.intervalMs;s.phase='discovering';s.lastError=null;let visit,workspace,completed=0;
  try{
   await this.#save();const health=await this.#transport.check();if(!health.online||!health.memberOfGroup)throw Error('TARGET_QQ_GROUP_OFFLINE');
   const identity=await this.#site.check({signal});if(!identity.connected||!identity.uidMatched)throw Error('BILIBILI_LOGIN_REQUIRED');
   if(identity.authRevision){if(s.authRevision&&s.authRevision!==identity.authRevision)s.actionPauses={};s.authRevision=identity.authRevision;}
   await this.#reconcile(signal);
   for(let step=0;step<this.#config.maxVideosPerCycle&&this.#now()-at<this.#config.maxCycleMs;step++){
    signal?.throwIfAborted();s.phase='discovering';await this.#save();
    const choices=await this.#discover(signal,step);if(!choices.length){if(!completed)s.phase='no-candidate';break;}
    workspace=await mkdtemp(join(this.#store.root,'visit-'));
    const plan=await this.#curator.choose({candidates:choices,interests:s.interests,recent:s.visits.slice(-4).map(v=>({title:v.title,summary:v.summary})),workspace},{signal});
    if(plan.bvid===null){s.interests=queries(plan.nextQueries).length?interests(this.#config,plan.nextQueries):s.interests;s.browseMode='search';if(!completed)s.phase='no-interest';break;}
    const selected=choices.find(v=>v.bvid===plan.bvid);if(!selected)throw Error('CURATOR_UNKNOWN_VIDEO');
    visit={bvid:selected.bvid,title:selected.title,url:selected.url,at:new Date(this.#now()).toISOString(),phase:'watching',like:{phase:'not-requested'},comment:{phase:'not-requested'},share:{phase:'not-requested'}};
    s.visits.push(visit);s.visits=s.visits.slice(-100);s.phase='watching';await this.#save();
    const evidence=await this.#media.prepare(selected.bvid,workspace,{signal});
    try{evidence.publicComments=await this.#site.comments?.(selected.bvid,{signal})||[];}catch(e){if(platformBlocked(autonomyCode(e)))throw e;evidence.publicComments=[];}
    Object.assign(visit,{transcriptKind:evidence.transcriptKind,frameCount:evidence.frames.length,scope:evidence.scope,transcriptEnd:evidence.transcriptEnd,duration:evidence.video.duration,phase:'reviewing'});s.phase='reviewing';await this.#save();
    const r=await this.#curator.review(evidence,{signal});
    if(typeof r.summary!=='string'||!Number.isFinite(r.interestScore)||r.interestScore<0||r.interestScore>1||!Array.isArray(r.evidenceTimes)||r.evidenceTimes.some(t=>!Number.isFinite(t)||t<0||t>evidence.video.duration))throw Error('CURATOR_REVIEW_INVALID');
    Object.assign(visit,{summary:r.summary.slice(0,1500),visualFramesSupplied:r.visualFramesSupplied||null,interestScore:r.interestScore,evidenceTimes:r.evidenceTimes});
    if(queries(r.nextQueries).length)s.interests=interests(this.#config,r.nextQueries);
    if(['feed','related','search'].includes(r.browseMode))s.browseMode=r.browseMode;
    s.seen.push(selected.bvid);s.seen=s.seen.slice(-1000);
    await this.#actions(visit,evidence,r,signal);visit.phase='complete';completed++;s.phase='ready';await this.#save();
    await this.#media.cleanup?.(workspace);workspace=null;if(r.continueBrowsing===false)break;
   }
   return {status:completed?'complete':s.phase,completed,bvid:visit?.bvid,like:visit?.like,comment:visit?.comment,share:visit?.share};
  }catch(e){
   if(signal?.aborted){s.phase=parentSignal?.aborted?'deferred-for-mentions':'cycle-budget-ended';s.lastError=null;s.nextRunAt=Math.max(s.nextRunAt,this.#now()+300000);if(visit){visit.phase='deferred';if(['like','comment','share'].every(k=>visit[k].phase==='not-requested'))s.seen=s.seen.filter(id=>id!==visit.bvid);}await this.#save();return {status:s.phase};}
   s.lastError=autonomyCode(e);s.phase=platformBlocked(s.lastError)?'authorization-or-backoff':'failed';if(platformBlocked(s.lastError))s.nextRunAt=Math.max(s.nextRunAt,this.#now()+1800000);
   if(visit){visit.phase='failed';visit.error=s.lastError;}await this.#save();return {status:s.phase,error:s.lastError};
  }finally{try{await this.#media.cleanup?.(workspace);}catch{s.lastError||='VIDEO_CACHE_CLEANUP_FAILED';}this.#busy=false;await this.#save();}
 }
}
