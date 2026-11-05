import {normalizeBrowseLoad,personaGroupLoad} from './persona-load.mjs';
// A shared read-only slot; foreground work retains the worker pool's priority.
export function createBackgroundScheduler({workers,groupId,jobs,scopes=null,idleMs=1800000,loadPolicy=null,now=Date.now,intervalMs=30000}){
 if(!Number.isSafeInteger(idleMs)||idleMs<60000)throw Error('INVALID_READING_IDLE_WINDOW');
 const policy=normalizeBrowseLoad(loadPolicy);
 let cursor=0,groupCursor=0,closed=false,active=null;
 const controller=new AbortController(),names=Object.keys(jobs),startedAt=now();
 const groupScopes=()=>scopes?[...scopes.values()].filter(s=>s.config.scopeType!=='private'):[];
 const personaFor=name=>jobs[name]?.diagnostics?.learning?.persona||jobs[name]?.diagnostics?.model?.persona||(name.startsWith('hui')?'hui':'axu');
 const load=persona=>personaGroupLoad(groupScopes(),persona,policy);
 function eligible(scope,persona='axu'){
  const d=scope.transport.diagnostics||{},last=scope.bot.diagnostics.lastSelfMentionAt??startedAt,checked=Date.parse(d.checkedAt);
  const healthy=!scope.bot.diagnostics.storageFaulted&&d.online===true&&d.memberOfGroup===true&&Number.isFinite(checked)&&now()-checked>=0&&now()-checked<=90000;
  return healthy&&(policy?!load(persona).highFrequency:now()-last>=idleMs);
 }
 function run(name,{manual=false,scope=null}={}){
  const job=jobs[name];if(closed||!job||(!manual&&!job.due))return null;
  const persona=personaFor(name),idleReading=!manual&&!!scopes;
  if(idleReading&&(!scope||!eligible(scope,persona)))return null;
  const target=idleReading?scope.config.groupId:groupId,cycle=new AbortController();
  const task=workers.runBackground(target,async({signal})=>{
   signal=AbortSignal.any([signal,controller.signal,cycle.signal]);
   if(idleReading){const health=await scope.transport.check();if(!health.online||!health.memberOfGroup||!eligible(scope,persona))return {status:'not-idle-or-offline'};}
   signal.throwIfAborted();
   return job.run({signal,manual,readOnly:idleReading,onlineCheck:idleReading?()=>scope.transport.check():undefined});
  },{readOnly:idleReading,independentOptional:!!policy});
  if(task){cursor=(names.indexOf(name)+1)%names.length;const current={scope:idleReading?scope:null,persona,cycle};active=current;void task.finally(()=>{if(active===current)active=null;}).catch(()=>{});}
  return task;
 }
 function tick(){
  if(closed)return;
  if(active?.scope&&!eligible(active.scope,active.persona))active.cycle.abort();
  const groups=groupScopes();
  for(let i=0;i<names.length;i++){
   const name=names[(cursor+i)%names.length];if(!jobs[name]?.due)continue;
   let scope=null;
   if(scopes){for(let j=0;j<groups.length;j++){const index=(groupCursor+j)%groups.length;if(eligible(groups[index],personaFor(name))){scope=groups[index];groupCursor=(index+1)%groups.length;break;}}if(!scope)continue;}
   const task=run(name,{scope});if(task){void task.catch(()=>{});break;}
  }
 }
 const timer=setInterval(tick,intervalMs);timer.unref();const initial=setTimeout(tick,5000);initial.unref();
 return {run,tick,get diagnostics(){return {enabled:!!scopes,idleMs,trigger:policy?'persona-majority':'idle-window',loadPolicy:policy?{...policy,personas:{axu:load('axu'),hui:load('hui')}}:null,readOnlyAutomatic:!!scopes,jobs:Object.fromEntries(Object.entries(jobs).map(([name,job])=>[name,job?.diagnostics||null])),groups:groupScopes().map(s=>({groupId:s.config.groupId,lastSelfMentionAt:s.bot.diagnostics.lastSelfMentionAt,mentionRates:s.bot.diagnostics.mentionRates||null,eligible:eligible(s),eligiblePersonas:{axu:eligible(s,'axu'),hui:eligible(s,'hui')}}))};},close(){closed=true;clearInterval(timer);clearTimeout(initial);controller.abort();}};
}
