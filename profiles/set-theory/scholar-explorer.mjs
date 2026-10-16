import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {openAutonomyStore,autonomyDay,autonomyCode} from './autonomy-store.mjs';
import {validateScholarEvidence} from './scholar-reader.mjs';
import {scholarlyKey,scholarFingerprint} from './scholar-sources.mjs';
import {publicQuery} from './public-fetch.mjs';
import {formatQQReply} from './response-format.mjs';
const keywords=a=>(a||[]).slice(0,3).flatMap(q=>{try{return [publicQuery(q).slice(0,80)];}catch{return [];}});
const valid=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
export class ScholarExplorer{
 #store;#state;#sources;#reader;#curator;#transport;#config;#now;#onShare;#busy=false;
 constructor(options){this.#store=options.store;this.#state=options.store.state;this.#sources=options.sources;this.#reader=options.reader;this.#curator=options.curator;this.#transport=options.transport;this.#config=options.config;this.#now=options.now;this.#onShare=options.onShare;}
 static async open({root,sources,reader,curator,transport,config,now=Date.now,onShare=async()=>{}}){
  config={maxPapersPerCycle:2,maxCycleMs:1200000,minShareIntervalMs:3600000,interests:['set theory','mathematical logic','combinatorics'],...config};
  if(!/^\d{4,20}$/.test(config.targetGroupId||'')||!valid(config.intervalMs,1800000,7*86400000)||!valid(config.maxPapersPerCycle,1,5)||!valid(config.maxSharesPerDay,0,6)||!valid(config.maxCycleMs,60000,3600000))throw Error('INVALID_SCHOLAR_CONFIG');
  const store=await openAutonomyStore(root,{stateFile:'scholar-state.json',statusFile:'scholar-status.json',initial:()=>({version:1,targetGroupId:config.targetGroupId,nextRunAt:0,cursor:0,interests:keywords(config.interests),seen:[],visits:[],shares:{},day:'',shareCount:0,lastShareAt:0,phase:'ready',lastError:null,sources:[]})});
  const s=store.state;if(s.version!==1||s.targetGroupId!==config.targetGroupId||!Array.isArray(s.seen)||!Array.isArray(s.visits)||s.seen.length>2000||s.visits.length>100||!s.shares||Object.keys(s.shares).length>5000)throw Error('INVALID_SCHOLAR_STATE');
  for(const r of Object.values(s.shares))if(r.phase==='sending')r.phase='uncertain_after_restart';
  for(const v of s.visits)if(v.share?.phase==='sending')v.share.phase='uncertain_after_restart';
  if(['discovering','reading','reviewing','sharing'].includes(s.phase)){s.phase='interrupted';s.nextRunAt=now()+300000;}
  const e=new ScholarExplorer({store,sources,reader,curator,transport,config,now,onShare});await e.#save();return e;
 }
 get diagnostics(){const s=this.#state,c=this.#config;return {enabled:c.enabled,busy:this.#busy,targetGroupId:c.targetGroupId,phase:s.phase,nextRunAt:s.nextRunAt,intervalMs:c.intervalMs,maxPapersPerCycle:c.maxPapersPerCycle,maxSharesPerDay:c.maxSharesPerDay,interests:s.interests,budget:{day:s.day,shares:s.shareCount},sources:s.sources,lastError:s.lastError,model:this.#curator.diagnostics,recent:s.visits.slice(-6)};}
 get due(){return this.#config.enabled&&!this.#busy&&this.#now()>=this.#state.nextRunAt;}
 #save(){return this.#store.save(this.diagnostics);}
 async run({manual=false,signal}={}){
  if(this.#busy||!this.#config.enabled||(!manual&&!this.due))return {status:'not-due'};
  const parentSignal=signal;signal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(this.#config.maxCycleMs)]);
  this.#busy=true;const s=this.#state,c=this.#config,at=this.#now();s.nextRunAt=at+c.intervalMs;s.phase='discovering';s.lastError=null;let visit,completed=0;
  try{
   await this.#save();const health=await this.#transport.check();if(!health.online||!health.memberOfGroup)throw Error('TARGET_QQ_GROUP_OFFLINE');
   const found=await this.#sources.discover({categories:c.categories,journals:c.journals,cursor:s.cursor,query:s.cursor%2?s.interests[s.cursor%Math.max(1,s.interests.length)]||'':'',lookbackDays:c.lookbackDays||90},{signal});
   s.cursor++;s.sources=found.sources;await this.#save();
   const remaining=found.candidates.filter(p=>!s.seen.includes(scholarlyKey(p))&&!s.seen.includes('title:'+scholarFingerprint(p)));
   if(!remaining.length){s.phase='no-candidate';await this.#save();return {status:s.phase};}
   for(let i=0;i<c.maxPapersPerCycle&&remaining.length&&this.#now()-at<c.maxCycleMs;i++){
    signal?.throwIfAborted();const workspace=await mkdtemp(join(this.#store.root,'paper-'));
    const plan=await this.#curator.choose({candidates:remaining,interests:s.interests,recent:s.visits.slice(-4).map(v=>({title:v.title,summary:v.summary})),workspace},{signal});
    if(plan.id===null){if(keywords(plan.nextQueries).length)s.interests=keywords(plan.nextQueries);if(!completed)s.phase='no-interest';break;}
    const index=remaining.findIndex(p=>p.id===plan.id);if(index<0)throw Error('CURATOR_UNKNOWN_PAPER');
    const paper=remaining.splice(index,1)[0],key=scholarlyKey(paper),fingerprint='title:'+scholarFingerprint(paper);
    visit={id:paper.id,key,fingerprint,title:paper.title,url:paper.url,source:paper.source,publicationKind:paper.publicationKind,published:paper.published,at:new Date(this.#now()).toISOString(),phase:'reading',share:{phase:'not-requested'}};
    s.visits.push(visit);s.visits=s.visits.slice(-100);s.phase='reading';await this.#save();
    const evidence=await this.#reader.read(paper,workspace,{signal});visit.scope=evidence.scope;visit.blocksRead=evidence.blocks.map(b=>({id:b.id,characters:b.text.length}));visit.truncated=evidence.truncated;visit.preprintUrl=evidence.preprintUrl;visit.phase='reviewing';s.phase='reviewing';await this.#save();
    const r=await this.#curator.review(evidence,{signal});
    if(typeof r.summary!=='string'||!Number.isFinite(r.interestScore)||r.interestScore<0||r.interestScore>1)throw Error('SCHOLAR_REVIEW_INVALID');
    validateScholarEvidence(r,evidence);visit.summary=r.summary.slice(0,1800);visit.interestScore=r.interestScore;visit.evidence=r.evidence;
    if(keywords(r.nextQueries).length)s.interests=keywords(r.nextQueries);
    s.seen.push(key,fingerprint);s.seen=s.seen.slice(-2000);
    // Same title in a preprint and journal release is one recommendation.
    for(let n=remaining.length-1;n>=0;n--)if('title:'+scholarFingerprint(remaining[n])===fingerprint||scholarlyKey(remaining[n])===key)remaining.splice(n,1);
    const day=autonomyDay(this.#now());if(s.day!==day){s.day=day;s.shareCount=0;}
    if(r.share&&r.interestScore>=0.65&&s.shareCount<c.maxSharesPerDay&&!s.shares[key]&&!s.shares[fingerprint]&&Object.keys(s.shares).length<4998&&this.#now()-s.lastShareAt>=c.minShareIntervalMs){
     const body=formatQQReply(String(r.shareText||'').trim());if(!body||body.length>700||/https?:\/\/|@/.test(body))throw Error('SCHOLAR_SHARE_INVALID');
     signal?.throwIfAborted();const online=await this.#transport.check();if(!online.online||!online.memberOfGroup)throw Error('TARGET_QQ_GROUP_OFFLINE');
     const label=paper.publicationKind==='preprint'?'arXiv 预印本':paper.source;
     const scope=evidence.scope==='abstract'?' · 摘要阅读':'';
     const publicText=body+'\n\n'+paper.title+'\n'+label+(paper.published?' · '+paper.published.slice(0,10):'')+scope+'\n'+paper.url;
     visit.share={phase:'sending'};s.shares[key]=s.shares[fingerprint]=visit.share;s.shareCount++;s.lastShareAt=this.#now();s.phase='sharing';await this.#save();
     try{const receipt=await this.#transport.sendProactive({groupId:c.targetGroupId,text:publicText});visit.share={phase:receipt.ok?'delivered':'uncertain',replyId:receipt.messageId||null,delivered:receipt.ok===true,verified:receipt.verified===true};if(receipt.ok&&receipt.verified)await this.#onShare(publicText).catch(()=>{});}
     catch(e){visit.share={phase:'uncertain',reason:autonomyCode(e)};}
     s.shares[key]=s.shares[fingerprint]=visit.share;await this.#save();
    }
    visit.phase='complete';completed++;s.phase='ready';await this.#save();
   }
   return {status:completed?'complete':s.phase,completed,share:visit?.share};
  }catch(e){
   if(signal?.aborted){s.phase=parentSignal?.aborted?'deferred-for-mentions':'cycle-budget-ended';s.lastError=null;s.nextRunAt=Math.max(s.nextRunAt,this.#now()+300000);if(visit)visit.phase='deferred';}
   else{s.lastError=autonomyCode(e);s.phase='failed';if(visit)visit.phase='failed';}
   await this.#save();return {status:s.phase,error:s.lastError};
  }finally{this.#busy=false;await this.#save();}
 }
}
