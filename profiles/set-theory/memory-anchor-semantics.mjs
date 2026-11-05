import {framingFeedback} from './style-feedback.mjs';

// Deliberately bounded paraphrases, never embedding similarity or mathematical
// synonym replacement. Unknown wording keeps its own exact-text evidence group.
export const anchorRuleVersion='2';
const clean=text=>String(text).normalize('NFC').trim().replace(/[。.!！]+$/u,'').trim();
function preference(text){
 const m=clean(text).match(/^(?:我|本人)(?:(?:个人|其实|一直|比较|非常|特别|更|最近|还是|很|也|就|平时|通常))*(不喜欢|不偏好|喜欢|偏好|倾向于|更习惯)([^，,。；;！？!?\n]{2,180})$/u);
 if(!m)return null;
 const value=m[2].replace(/^(?:通过|用|借助)(?:具体的?|具体)?(?:例子|实例|示例)(?:来)?/u,'用示例')
  .replace(/^(?:通过|用|借助)反例(?:来)?/u,'用反例')
  .replace(/^用(示例|反例)(?:弄懂|看懂)/u,'用$1理解');
 return {family:'preference:'+value,direction:m[1].startsWith('不')?'avoid':'prefer',text:clean(text)};
}
export function isExplicitAnchorPreference(text){return Boolean(preference(text));}
export function anchorMeaning(kind,text){
 if(kind==='preference'){const p=preference(text);if(p)return p;}
 if(kind==='style_feedback'){
  const direction=framingFeedback(text);
  if(direction)return {family:'style:framing',direction,text:direction==='reduce'?'希望减少多余框定，必要条件随结论说明一次':'希望清楚保留影响结论的必要条件'};
 }
 if(kind==='open_question'){
  const t=clean(text),m=t.match(/^(.{2,180}?)(?:还没解决|尚未解决|待解决)$/u)||t.match(/^(?:还没解决|尚未解决|待解决)[：:]?(.{2,180})$/u);
  if(m&&!/[，,。；;！？!?\n]/u.test(m[1]))return {family:'open:'+m[1],direction:'unresolved',text};
 }
 return {family:kind+':exact:'+clean(text),direction:'exact',text};
}

export function groupAnchorEvidence(items){
 const families=new Map();
 for(const item of items){
  const meaning=anchorMeaning(item.kind,item.text),key=JSON.stringify([item.scope,item.subjectId,item.persona,item.kind,meaning.family]);
  if(!families.has(key))families.set(key,[]);
  families.get(key).push({item,meaning});
 }
 return [...families.values()].map(group=>{
  group.sort((a,b)=>Math.min(...a.item.evidence.map(e=>e.at))-Math.min(...b.item.evidence.map(e=>e.at))||a.item.id.localeCompare(b.item.id));
  const first=group[0],sources=group.map(x=>x.item),unique=new Map();
  for(const item of sources)for(const e of item.evidence){
   // One message, even if re-extracted with another timestamp, is one witness.
   if(!unique.has(e.messageId)||e.at<unique.get(e.messageId).at)unique.set(e.messageId,{messageId:e.messageId,at:e.at});
  }
  const evidence=[...unique.values()].sort((a,b)=>a.at-b.at);let periods=0,last=-Infinity;
  for(const e of evidence)if(e.at-last>=4*3600000){periods++;last=e.at;}
  const disputed=sources.some(i=>i.status==='disputed'||i.conflictsWith?.length)||new Set(group.map(x=>x.meaning.direction)).size>1;
  return {id:first.item.id,kind:first.item.kind,text:first.meaning.text,status:disputed?'disputed':'reported',
   evidenceIds:evidence.map(e=>e.messageId),lastConfirmedAt:Math.max(...evidence.map(e=>e.at)),
   verification:'human-report-not-independent-verification',independentPeriods:periods,
   sourceItemIds:sources.map(i=>i.id),variants:sources.map(i=>({id:i.id,text:i.text,evidence:i.evidence.map(e=>({...e})),conflictsWith:i.conflictsWith||[]})),
   semanticRuleVersion:anchorRuleVersion};
 });
}
