import {selectPersonaRequest} from '../../src/domain/cognition/persona-review.js';
import {forSecondaryPersonaInstructions} from './persona.mjs';
import {normalizeSecondary,secondaryForRequest,requestsGemini,requestsNamedSecondary,humanitiesTopicForRequest,chooseGeminiModel,isCodexQuotaError,geminiInstructions,GEMINI_ROUTE,GEMINI_WEB_ROUTE} from './provider-policy.mjs';
export function createPersonaRouter({primary,secondary,settings,readPrimaryQuota,readSecondaryQuota,webSecondary=null,now=Date.now}){
 const config=normalizeSecondary(settings);let exhaustedUntil=0,lastQuotaFailure=-Infinity,epoch='quota-error';
 const stats={primaryCalls:0,secondaryCalls:0,quotaSwitches:0,explicitCalls:0,topicCalls:0,lastHumanitiesTopic:null,lastProvider:null,lastSecondaryModel:null};
 return {kind:'live',get diagnostics(){return {...primary.diagnostics,secondaryPersona:{...config,...stats}};},
 async handleQuotaFailure(error){if(!config.enabled||config.activationMode==='mentioned-name'||!isCodexQuotaError(error))return false;lastQuotaFailure=now();exhaustedUntil=now()+300000;epoch='error:'+Math.floor(now()/300000);stats.quotaSwitches++;return true;},
 async generate(request,options={}){
  const selected=secondaryForRequest(config,request,now());
  const namedOnly=config.activationMode==='mentioned-name';
  const explicit=namedOnly?requestsNamedSecondary(request.question,config,{hasSelfAt:request.hasSelfAt}):request.requestedPersona==='gemini'||requestsGemini(request.question,config,{hasSelfAt:request.hasSelfAt});
  if(!selected.enabled){if(explicit)throw Error('SECONDARY_NOT_ENABLED');return primary.generate(selectPersonaRequest(request,'axu'),options);}
  const humanitiesTopic=humanitiesTopicForRequest(selected,request);
  if(namedOnly&&!explicit&&!humanitiesTopic){stats.primaryCalls++;stats.lastProvider='codex';return primary.generate(selectPersonaRequest(request,'axu'),options);}
  let quota={state:'unknown'};if(!namedOnly)try{quota=await readPrimaryQuota();}catch{}
  if(quota.state==='available'&&now()-lastQuotaFailure>=60000)exhaustedUntil=0;
  stats.primaryQuota={state:quota.state,remaining:quota.remaining??null};
  const exhausted=!namedOnly&&(quota.state==='exhausted'||now()<exhaustedUntil);
  if(!explicit&&!exhausted&&!humanitiesTopic){stats.primaryCalls++;stats.lastProvider='codex';return primary.generate(selectPersonaRequest(request,'axu'),options);}
  const webReady=webSecondary?await webSecondary.available():false;
  let client=webSecondary,provider='gemini-web',billingRoute=GEMINI_WEB_ROUTE,model='gemini-4-argon-high';
  if(!webReady){
   if(!secondary)throw Error('SECONDARY_NOT_READY');
   const secondaryQuota=await readSecondaryQuota();stats.secondaryQuota=secondaryQuota;model=chooseGeminiModel(secondaryQuota,config);
   client=secondary;provider='antigravity';billingRoute=GEMINI_ROUTE;
  }
  stats.secondaryCalls++;if(explicit)stats.explicitCalls++;else if(humanitiesTopic&&!exhausted)stats.topicCalls++;stats.lastHumanitiesTopic=humanitiesTopic;stats.lastProvider=provider;stats.lastSecondaryModel=model;
  request=selectPersonaRequest(request,'hui');
  const result=await client.generate({...request,model,reasoningEffort:'high',billingRoute,developerInstructions:forSecondaryPersonaInstructions(request.developerInstructions)+geminiInstructions(config.name)},options);
  return {...result,provider,personaId:'gemini',model,reasoningEffort:'high',billingRoute,routeReason:exhausted?'codex-exhausted':explicit?'explicit-request':'humanities-topic',...(humanitiesTopic?{humanitiesTopic}:{}),quotaEpoch:quota.epoch||epoch};
 }};
}
