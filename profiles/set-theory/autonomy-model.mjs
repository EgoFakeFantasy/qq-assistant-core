import {createLiveModel} from './live-model.mjs';
import {createAntigravityClient} from './antigravity-cli.mjs';
import {GEMINI_ROUTE,geminiInstructions} from './provider-policy.mjs';
import {MODEL,EFFORT} from './teaching-bot.mjs';
export function createAutonomyModel(runtime,{responseSchema,baseInstructions,runTurn,client}={}){
 const hui=runtime.learningPersona==='hui';
 if(!hui)return createLiveModel({...runtime,responseSchema,baseInstructions,...(runTurn?{runTurn}:{})});
 if(!runtime.antigravity&&!client)throw Error('HUI_AUTONOMY_NOT_CONFIGURED');
 const secondary=client||createAntigravityClient({...runtime.antigravity,responseSchema,prepareImages:runtime.prepareImages});
 return {get diagnostics(){return {...secondary.diagnostics,model:'gemini-3.8-flash-high',reasoningEffort:EFFORT};},async generate(request,options){
  const quota=await secondary.readQuota();if(!Number.isFinite(quota.flash)||quota.flash<=0)throw Error('SECONDARY_QUOTA_UNAVAILABLE');
  return secondary.generate({...request,model:'gemini-3.8-flash-high',reasoningEffort:EFFORT,billingRoute:GEMINI_ROUTE,developerInstructions:baseInstructions+'\n'+geminiInstructions('回')+'\n'+request.developerInstructions},options);
 }};
}
