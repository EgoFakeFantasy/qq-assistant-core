import {forSecondaryPersonaInstructions} from './persona.mjs';
import {normalizeSecondary,secondaryForRequest,requestsGemini,requestsNamedSecondary,chooseGeminiModel,isCodexQuotaError,geminiInstructions,GEMINI_ROUTE} from './provider-policy.mjs';
export function createPersonaRouter({primary,secondary,settings,readPrimaryQuota,readSecondaryQuota,now=Date.now}){
 const config=normalizeSecondary(settings);let exhaustedUntil=0,lastQuotaFailure=-Infinity,epoch='quota-error';
 const stats={primaryCalls:0,secondaryCalls:0,quotaSwitches:0,explicitCalls:0,lastProvider:null,lastSecondaryModel:null};
 return {kind:'live',get diagnostics(){return {...primary.diagnostics,secondaryPersona:{...config,...stats}};},
 async handleQuotaFailure(error){if(!config.enabled||config.activationMode==='mentioned-name'||!isCodexQuotaError(error))return false;lastQuotaFailure=now();exhaustedUntil=now()+300000;epoch='error:'+Math.floor(now()/300000);stats.quotaSwitches++;return true;},
 async generate(request,options={}){
  const selected=secondaryForRequest(config,request,now());
  const namedOnly=config.activationMode==='mentioned-name';
  const explicit=namedOnly?requestsNamedSecondary(request.question,config,{hasSelfAt:request.hasSelfAt}):request.requestedPersona==='gemini'||requestsGemini(request.question,config,{hasSelfAt:request.hasSelfAt});
  if(!selected.enabled){if(explicit)throw Error('SECONDARY_NOT_ENABLED');return primary.generate(request,options);}
  if(namedOnly&&!explicit){stats.primaryCalls++;stats.lastProvider='codex';return primary.generate(request,options);}
  let quota={state:'unknown'};if(!namedOnly)try{quota=await readPrimaryQuota();}catch{}
  if(quota.state==='available'&&now()-lastQuotaFailure>=60000)exhaustedUntil=0;
  stats.primaryQuota={state:quota.state,remaining:quota.remaining??null};
  const exhausted=!namedOnly&&(quota.state==='exhausted'||now()<exhaustedUntil);
  if(!explicit&&!exhausted){stats.primaryCalls++;stats.lastProvider='codex';return primary.generate(request,options);}
  if(!secondary)throw Error('SECONDARY_NOT_READY');
  const secondaryQuota=await readSecondaryQuota();stats.secondaryQuota=secondaryQuota;
  const model=chooseGeminiModel(secondaryQuota,config),client=secondary,provider='antigravity',billingRoute=GEMINI_ROUTE;
  stats.secondaryCalls++;if(explicit)stats.explicitCalls++;stats.lastProvider=provider;stats.lastSecondaryModel=model;
  const result=await client.generate({...request,model,reasoningEffort:'high',billingRoute,developerInstructions:forSecondaryPersonaInstructions(request.developerInstructions)+geminiInstructions(config.name)},options);
  return {...result,provider,personaId:'gemini',model,reasoningEffort:'high',billingRoute,routeReason:exhausted?'codex-exhausted':'explicit-request',quotaEpoch:quota.epoch||epoch};
 }};
}
