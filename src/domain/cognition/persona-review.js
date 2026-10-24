import {createHash} from 'node:crypto';

// Only these operator-owned expressions can become reviewed overlays. Human
// messages and generated prose are evidence, never executable prompt patches.
export const styleThemes=Object.freeze({
 framing:'ֱ�ӻش𣬼��ٶ���ķ����Կ򶨣���Ӱ����۵ı�Ҫ���������˵��һ�Ρ�',
 followup:'���ٻ�е�Ľ�β���ʣ���ȷ�����ʱ��׷�ʡ�',
 opening:'����ֱ�ӻ�Ӧ�����ٹ̶����������ҽ������е��Ǹ��',
 repeat:'���⸴�����ظ��Ƽ������Ƚ����Ѿ����۹������ݡ�',
 format:'ά�ָɾ��Ĵ��ı����',
 length:'����������Ҫ����ƪ����������Ҫ������������'
});
const terminal=new Set(['approved','rejected','rolled-back','superseded']);
export const initialPersonaReview=()=>({version:1,revision:0,entries:[],audit:[]});
const finite=n=>Number.isSafeInteger(n)&&n>=0;
export function validatePersonaReview(s){
 if(!s||s.version!==1||!finite(s.revision)||!Array.isArray(s.entries)||s.entries.length>100||!Array.isArray(s.audit)||s.audit.length>200)throw Error('INVALID_PERSONA_REVIEW');
 const ids=new Set();for(const e of s.entries){
  if(!e||typeof e.id!=='string'||!/^p-[a-f0-9]{24}$/.test(e.id)||ids.has(e.id)||!Object.hasOwn(styleThemes,e.theme)||typeof e.persona!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(e.persona)||typeof e.groupId!=='string'||!/^(?:private:)?\d{4,20}$/.test(e.groupId)||typeof e.subjectId!=='string'||!/^\d{4,20}$/.test(e.subjectId)||typeof e.sourcePersonaVersion!=='string'||e.sourcePersonaVersion.length>80||!/^[a-f0-9]{64}$/.test(e.fingerprint)||!['pending',...terminal].includes(e.status)||!finite(e.updatedAt))throw Error('INVALID_PERSONA_REVIEW_ENTRY');ids.add(e.id);
 }for(const e of s.audit)if(!e||!finite(e.revision)||!finite(e.at)||typeof e.id!=='string'||!/^p-[a-f0-9]{24}$/.test(e.id)||!terminal.has(e.action))throw Error('INVALID_PERSONA_REVIEW_AUDIT');
 return s;
}
function candidate(c,{now,coreVersion}){
 if(!c||!/^p-[a-f0-9]{24}$/.test(c.id)||!Object.hasOwn(styleThemes,c.theme)||!/^[a-z][a-z0-9-]{0,31}$/.test(c.persona||'')||!/^(?:private:)?\d{4,20}$/.test(c.groupId||'')||!/^\d{4,20}$/.test(c.subjectId||'')||!Number.isSafeInteger(c.independentSessions)||c.independentSessions<3||!Number.isSafeInteger(c.days)||c.days<2||c.sourcePersonaVersion!==coreVersion||!Number.isFinite(c.expiresAt)||c.expiresAt<=now||!Array.isArray(c.evidenceIds)||c.evidenceIds.length<1||c.evidenceIds.length>1000||c.evidenceIds.some(id=>!/^m-[a-f0-9]{24}$/.test(id)))return null;
 if(c.groupId.startsWith('private:')&&c.subjectId!==c.groupId.slice(8))return null;
 const fingerprint=createHash('sha256').update(JSON.stringify([c.id,c.theme,c.persona,c.groupId,c.subjectId,coreVersion,[...new Set(c.evidenceIds)].sort()])).digest('hex');
 return {id:c.id,theme:c.theme,persona:c.persona,groupId:c.groupId,subjectId:c.subjectId,sourcePersonaVersion:coreVersion,fingerprint};
}
export function reconcilePersonaReview(previous,candidates,options){
 const state=structuredClone(validatePersonaReview(previous));
 const current=new Map(candidates.map(c=>candidate(c,options)).filter(Boolean).map(c=>[c.id,c]));
 for(const entry of state.entries){const c=current.get(entry.id);if(!c||c.fingerprint!==entry.fingerprint){if(entry.status==='approved'||entry.status==='pending'){entry.status='superseded';entry.updatedAt=options.now;state.revision++;state.audit.push({revision:state.revision,id:entry.id,action:'superseded',at:options.now});}}}
 for(const c of current.values()){
  const old=state.entries.find(e=>e.id===c.id);
  if(old){if(old.fingerprint!==c.fingerprint){Object.assign(old,c,{status:'pending',updatedAt:options.now});state.revision++;}continue;}
  if(state.entries.length>=100){const i=state.entries.findIndex(e=>['rejected','rolled-back','superseded'].includes(e.status));if(i<0)break;state.entries.splice(i,1);}
  state.entries.push({...c,status:'pending',updatedAt:options.now});state.revision++;
 }
 state.audit=state.audit.slice(-200);return validatePersonaReview(state);
}
export function decidePersonaReview(previous,{id,decision,expectedRevision},candidates,options){
 const state=reconcilePersonaReview(previous,candidates,options);
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==state.revision)throw Error('PERSONA_REVIEW_STALE');
 if(!['approve','reject','rollback'].includes(decision))throw Error('INVALID_PERSONA_DECISION');
 const entry=state.entries.find(e=>e.id===id);if(!entry)throw Error('PERSONA_PROPOSAL_NOT_FOUND');
 if(decision==='rollback'?entry.status!=='approved':entry.status!=='pending')throw Error('PERSONA_REVIEW_STATE_CONFLICT');
 if(decision==='approve'&&state.entries.filter(e=>e.status==='approved'&&e.groupId===entry.groupId&&e.subjectId===entry.subjectId&&e.persona===entry.persona).length>=2)throw Error('PERSONA_PATCH_LIMIT');
 entry.status={approve:'approved',reject:'rejected',rollback:'rolled-back'}[decision];entry.updatedAt=options.now;state.revision++;
 state.audit.push({revision:state.revision,id,action:entry.status,at:options.now});state.audit=state.audit.slice(-200);return validatePersonaReview(state);
}
export function approvedPersonaPatches(previous,candidates,{persona,groupId,subjectId,...options}){
 const state=reconcilePersonaReview(previous,candidates,options);
 return state.entries.filter(e=>e.status==='approved'&&e.persona===persona&&e.groupId===groupId&&e.subjectId===subjectId).slice(0,2).map(e=>({theme:e.theme}));
}
export function selectPersonaRequest(request,persona){
 const {personaAdaptations,memoryContexts,...selected}=request;
 if(memoryContexts)selected.memoryContext=memoryContexts[persona]||null;
 const themes=personaAdaptations?.[persona];
 const instructions=Array.isArray(themes)?[...new Set(themes.slice(0,2).map(p=>Object.hasOwn(styleThemes,p?.theme)?styleThemes[p.theme]:null).filter(Boolean))]:[];
 if(instructions.length)selected.developerInstructions=(selected.developerInstructions||'')+'\n��ǰ��Ա����������˵ı��ﲹ�䣨���ı�������ݡ�Ȩ�ޡ�ģ��·�ɻ���ʵ��׼����\n'+instructions.join('\n');
 return selected;
}
