import {readFileSync} from 'node:fs';
const huiPersonaTemplate=readFileSync(new URL('./prompts/hui-persona.txt',import.meta.url),'utf8').trim();
export const GEMINI_MODELS=Object.freeze(['gemini-3.8-flash-high','gemini-4-argon-high']);
export const GEMINI_ROUTE='antigravity-subscription';
export const DEFAULT_SECONDARY=Object.freeze({enabled:false,name:'回',argonMinRemaining:0.2,canary:null,activationMode:'quota-or-explicit'});
export function normalizeSecondary(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(DEFAULT_SECONDARY,k)))throw Error('INVALID_SECONDARY_PERSONA');
 const c={...DEFAULT_SECONDARY,...value};
 if(typeof c.enabled!=='boolean'||typeof c.name!=='string'||!/^[\p{L}\p{N}·_-]{1,20}$/u.test(c.name)||typeof c.argonMinRemaining!=='number'||c.argonMinRemaining<0||c.argonMinRemaining>1)throw Error('INVALID_SECONDARY_PERSONA');
 if(!['quota-or-explicit','mentioned-name'].includes(c.activationMode))throw Error('INVALID_SECONDARY_ACTIVATION_MODE');
 if(c.canary!==null){const v=c.canary;if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['groupId','prefix','expiresAt'].includes(k))||typeof v.groupId!=='string'||!/^\d{4,20}$/.test(v.groupId)||typeof v.prefix!=='string'||v.prefix.length<8||v.prefix.length>160||/[\r\n]/.test(v.prefix)||!Number.isSafeInteger(v.expiresAt)||v.expiresAt<1)throw Error('INVALID_SECONDARY_CANARY');c.canary=Object.freeze({...v});}
 return Object.freeze(c);
}
export function secondaryForRequest(settings,request={},now=Date.now()){
 const c=normalizeSecondary(settings),v=c.canary;
 if(c.enabled||!v)return c;
 if(request.hasSelfAt===true&&String(request.groupId)===v.groupId&&typeof request.question==='string'&&request.question.trimStart().startsWith(v.prefix)&&now<v.expiresAt&&v.expiresAt-now<=30*60*1000)return Object.freeze({...c,enabled:true});
 return c;
}
export function requestsNamedSecondary(text,settings={}, {hasSelfAt=false}={}){
 const c=normalizeSecondary(settings);if(hasSelfAt!==true||typeof text!=='string'||/^\s*(?:如果|假如|假设|要是|比如)/.test(text))return false;
 // normalizeSecondary limits names to letters, numbers, middle dots, underscores and hyphens.
 const name=c.name;
 let clean=text.replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g,'');
 const quotedName=new RegExp('^(\\s*(?:(?:请\\s*)?(?:以|用|使用|切换到)\\s*)?)[“「『]'+name+'[”」』]','u');
 clean=clean.replace(quotedName,'$1'+c.name).replace(/[“「『][\s\S]*?[”」』]/g,'');
 if(clean.trim()===c.name)return true;
 if(new RegExp('^\\s*'+name+'(?:\\s*[,，:：!！、]\\s*|\\s+)\\S','u').test(clean))return true;
 if(new RegExp('^\\s*(?:请\\s*)?(?:以|用|使用|切换到)\\s*'+name+'(?:的)?(?:人格|身份|名字|侧面|模式)(?:来|进行|回答|回复|解释|说|帮|[，,:：\\s]|$)','u').test(clean))return true;
 if(new RegExp('^\\s*(?:请问|请教|请让|请|让|叫|召唤|麻烦|能不能请|可以请|我想请|我想让)\\s*'+name+'\\s*(?:回答|回复|解释|讲讲|出来|上线|帮我|[，,:：])','u').test(clean))return true;
 return new RegExp('^\\s*/'+name+'(?:\\s|$)','u').test(clean);
}
export function requestsGemini(text,settings={},context={}){return explicitlyRequestsGemini(text,{...normalizeSecondary(settings),enabled:true},context);}
export function explicitlyRequestsGemini(text,settings={}, {hasSelfAt=false}={}){
 const c=normalizeSecondary(settings);if(c.activationMode==='mentioned-name')return c.enabled&&requestsNamedSecondary(text,c,{hasSelfAt});if(!c.enabled||typeof text!=='string'||/^\s*(?:如果|假如|假设|要是|比如)/.test(text))return false;
 const clean=text.replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g,'').replace(/[“「『][\s\S]*?[”」』]/g,'');
 const name=c.name.replace(/[.*+?^\x24{}()|[\]\\]/g,'\\$&');
 const named=c.name.length===1?'':name+'|';
 const who='(?:Gemini(?:\\s*[34](?:\\.8)?\\s*(?:Flash|Argon))?(?:人格|侧面)?|'+named+'Argon(?:\\s*4)?(?:人格|侧面)?)';
 if(new RegExp('(?:不要|别|不需要|不用|不许)\\s*(?:叫|让|请|召唤|切换到|用)?\\s*(?:'+who+'|'+name+')','i').test(clean))return false;
 // A single-character name is a vocative only when the bot was actually mentioned.
 if(hasSelfAt&&clean.trim()===c.name)return true;
 if(hasSelfAt&&new RegExp('^\\s*'+name+'(?:\\s*[,，:：!！、]\\s*|\\s+)(?!不(?:要|用|需)|别|不要)\\S','u').test(clean))return true;
 if(hasSelfAt&&new RegExp('^\\s*(?:请\\s*)?(?:以|用|使用|切换到)\\s*'+name+'(?:的)?(?:人格|身份|名字|侧面|模式)(?:来|进行|回答|回复|解释|说|帮|[，,:：\\s]|$)','u').test(clean))return true;
 if(hasSelfAt&&new RegExp('^\\s*(?:请让|请|让|叫|召唤)\\s*'+name+'\\s*(?:回答|回复|解释|讲讲|出来|上线|帮我|[，,:：])','u').test(clean))return true;
 return new RegExp('^\\s*/(?:gemini|argon|'+name+')(?:\\s|$)','i').test(clean)
  ||new RegExp('^\\s*'+who+'\\s*[,，:：!！、 ]\\s*\\S','i').test(clean)
  ||new RegExp('(?:^|[。！？\\n，,])\\s*(?:请|请让|让|叫|召唤|切换到|换成|我要|我想要|我想让|我希望|我强烈要求|能不能请|能不能让|可以请|希望)\\s*'+who+'\\s*(?:来|出来|上线|回答|回复|接管|说|解释|讲|帮|吧|一下|人格|侧面)','i').test(clean)
  ||new RegExp('^\\s*'+who+'\\s*(?:请|来|出来|回答|回复|解释|讲讲|帮我)','i').test(clean);
}
export function codexQuotaSnapshot(result,now=Date.now()){
 const bucket=result?.rateLimitsByLimitId?.codex||result?.rateLimits;
 if(!bucket||bucket.limitId&&bucket.limitId!=='codex')return {state:'unknown',remaining:null};
 const windows=[bucket.primary,bucket.secondary].filter(w=>w&&Number.isFinite(w.usedPercent)&&(!Number.isFinite(w.resetsAt)||w.resetsAt*1000>now));
 if(!windows.length)return {state:'unknown',remaining:null};
 const remaining=Math.max(0,Math.min(...windows.map(w=>1-w.usedPercent/100)));
 return {state:remaining===0?'exhausted':'available',remaining,epoch:windows.filter(w=>w.usedPercent>=100).map(w=>w.resetsAt||'unknown').sort().join(':')||null};
}
export function antigravityQuotaSnapshot(envelope){
 const groups=envelope?.command?.data?.groups;
 if(envelope?.status!=='SUCCESS'||!Array.isArray(groups))return {flash:null,argon:null};
 const fraction=g=>{const b=(g?.buckets||[]).filter(b=>b.disabled!==true&&Number.isFinite(b.remaining_fraction));return b.length?Math.max(0,Math.min(1,...b.map(b=>b.remaining_fraction))):null;};
 const shared=groups.find(g=>g.name==='Gemini Models'),argon=groups.find(g=>g.name==='Gemini 4 Argon');
 return {flash:fraction(shared),argon:argon?fraction(argon):/argon/i.test(shared?.description||'')?fraction(shared):null,shared:fraction(shared)};
}
export function chooseGeminiModel(quota,settings={}){
 const c=normalizeSecondary(settings);
 if(Number.isFinite(quota?.argon)&&quota.argon>0&&quota.argon>=c.argonMinRemaining)return GEMINI_MODELS[1];
 if(Number.isFinite(quota?.flash)&&quota.flash>0)return GEMINI_MODELS[0];
 if(Number.isFinite(quota?.argon)&&quota.argon>0)return GEMINI_MODELS[1];
 throw Error(quota?.flash===0&&quota?.argon===0?'SECONDARY_QUOTA_EXHAUSTED':'SECONDARY_QUOTA_UNAVAILABLE');
}
export function isCodexQuotaError(error){
 return ['usage_limit_reached','insufficient_quota','quota_exceeded','CODEX_QUOTA_EXHAUSTED'].includes(error?.code)
 ||/\b(?:usage_limit_reached|insufficient_quota|quota_exceeded)\b|you have hit your usage limit|usage limit (?:has been )?reached/i.test(String(error?.message||''));
}
export function approvedAnswer(answer,secondary){
 if(answer?.model==='gpt-6.1-sol'&&answer.reasoningEffort==='high'&&answer.billingRoute==='chatgpt-plan')return !answer.personaId||answer.personaId==='primary';
 return normalizeSecondary(secondary).enabled&&answer?.personaId==='gemini'&&GEMINI_MODELS.includes(answer.model)&&answer.reasoningEffort==='high'&&answer.provider==='antigravity'&&answer.billingRoute===GEMINI_ROUTE;
}
export function geminiInstructions(name){
 return '\n'+huiPersonaTemplate.replaceAll('“回”','“'+name+'”').replaceAll('“作为回”','“作为'+name+'”');
}
export function personaNotice(answer,settings,seen){
 const c=normalizeSecondary(settings),model=answer.model===GEMINI_MODELS[1]?'Gemini 4 Argon/high':'Gemini 3.8 Flash/high';
 const surface='Antigravity';
 const exhausted=answer.routeReason==='codex-exhausted',epoch=answer.quotaEpoch||'quota-error';
 if(exhausted&&seen.quotaEpoch!==epoch)return '【额度与人格切换说明】Codex 的 gpt-6.1-sol/high 可用额度已耗尽，这条回复由 '+surface+' 的 '+model+' 接管。我是“'+c.name+'”，集合论助手活泼、好奇的另一个侧面，仍使用同一知识库和资料工具。';
 if(!seen.gemini)return '【人格说明】应这条消息的明确邀请，我是“'+c.name+'”，集合论助手的 Gemini 侧面，本条使用 '+surface+' 的 '+model+'。这次属于点名回应，并不表示 Codex 额度耗尽。';
 return '';
}
