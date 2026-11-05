import {setTimeout as delay} from 'node:timers/promises';

function temporary429(error){
 const text=String(error?.message||'');
 return /(?:\b429\b|too many requests|rate_limit_error)/i.test(text)&&!/(?:quota|billing|credits|usage limit|insufficient_quota)/i.test(text);
}
function retryDelay(error){
 const hint=Number(error?.retryAfterMs??(error?.retryAfterSeconds==null?NaN:error.retryAfterSeconds*1000));
 if(Number.isFinite(hint)&&hint>60000)return null;
 return Math.max(50000+Math.floor(Math.random()*4000),Number.isFinite(hint)&&hint>0?hint:0);
}
export function createBudgetedModelCaller({model,maxCalls,options={},wait=(ms,signal)=>delay(ms,undefined,{signal}),onRetry=()=>{}}){
 let attempts=0,retried=false,quotaSwitched=false;
 return {get remainingCalls(){return maxCalls-attempts;},async call(request){
  while(true){
   if(options.signal?.aborted)throw options.signal.reason||new Error('MODEL_REQUEST_ABORTED');
   if(attempts>=maxCalls)throw new Error('MODEL_QUESTION_BUDGET');
   if(attempts&&options.onAdditionalModelCall)await options.onAdditionalModelCall();
   const next={...request,knowledgeProtocol:{...request.knowledgeProtocol,remainingRounds:maxCalls-attempts-1}};
   attempts++;
   try{return await model.generate(next,options);}catch(error){
    if(!quotaSwitched&&attempts<maxCalls&&!options.signal?.aborted&&await model.handleQuotaFailure?.(error)){quotaSwitched=true;continue;}
    const ms=retryDelay(error);
    if(retried||attempts>=maxCalls||options.signal?.aborted||!temporary429(error)||ms===null)throw error;
    retried=true;onRetry();await wait(ms,options.signal);
   }
  }
 }};
}
