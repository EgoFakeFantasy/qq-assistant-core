export const MENTION_WINDOW_MS=60000;
const personas=['axu','hui'];
export function validatePersonaMentions(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!personas.includes(k))||personas.some(p=>!Array.isArray(value[p])||value[p].length>600||value[p].some(t=>!Number.isFinite(t)||t<0)))throw Error('INVALID_PERSONA_MENTIONS');
 return value;
}
export function recentPersonaMentions(value={axu:[],hui:[]},now=Date.now()){
 validatePersonaMentions(value);return Object.fromEntries(personas.map(p=>[p,value[p].filter(at=>at>now-MENTION_WINDOW_MS&&at<=now)]));
}
export function recordPersonaMention(value,{persona,at,now}){
 const next=recentPersonaMentions(value,now);
 if(personas.includes(persona)&&Number.isFinite(at)&&at>now-MENTION_WINDOW_MS&&at<=now+5000)next[persona]=[...next[persona],Math.min(at,now)].slice(-600);
 return next;
}
export function personaMentionRates(value,now){const r=recentPersonaMentions(value,now);return {windowMs:MENTION_WINDOW_MS,axu:r.axu.length,hui:r.hui.length};}
export function normalizeBrowseLoad(value){
 if(value===undefined||value===null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['mode','highMentionsPerMinute'].includes(k))||value.mode!=='persona-majority'||!Number.isInteger(value.highMentionsPerMinute)||value.highMentionsPerMinute<5||value.highMentionsPerMinute>10)throw Error('INVALID_BROWSE_LOAD_POLICY');
 return {mode:value.mode,windowMs:MENTION_WINDOW_MS,highMentionsPerMinute:value.highMentionsPerMinute};
}
export function personaGroupLoad(scopes,persona,policy){
 const groups=scopes.filter(s=>s.config.scopeType!=='private'),majorityRequired=Math.floor(groups.length/2)+1;
 const counts=groups.map(s=>({groupId:s.config.groupId,count:s.bot.diagnostics.mentionRates?.[persona]||0}));
 const highGroups=counts.filter(g=>g.count>=policy.highMentionsPerMinute).length;
 return {persona,groups:counts,highGroups,totalGroups:groups.length,majorityRequired,highFrequency:groups.length>0&&highGroups>=majorityRequired};
}
