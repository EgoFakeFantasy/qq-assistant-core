import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateOfficialSettings} from '../src/channels/qq/official-channel.js';

export async function officialReadiness(path,{env=process.env}={}){
  const runtime=JSON.parse(await readFile(resolve(path),'utf8'));
  const config=JSON.parse(await readFile(resolve(runtime.profilePath),'utf8'));
  const missing=[];
  if(runtime.transport!=='qq-official')missing.push('official-transport');
  try{validateOfficialSettings(runtime.qqOfficial,config);}catch{missing.push('AppID-and-four-group-OpenID-bindings');}
  if(typeof env.QQBOT_APP_SECRET!=='string'||env.QQBOT_APP_SECRET.length<8)missing.push('QQBOT_APP_SECRET-environment');
  if(!runtime.legacyRuntimeRoot||resolve(runtime.runtimeRoot)===resolve(runtime.legacyRuntimeRoot)||runtime.hubPort===runtime.legacyHubPort)missing.push('isolated-runtime-and-port');
  return {readyToConnect:missing.length===0,liveConnected:false,liveDeliveryAccepted:false,missing,
    mainModelPreserved:config.model==='gpt-6.1-sol'&&config.reasoningEffort==='high',noModelCallCap:config.dailyModelCalls===null,
    huiEnabled:config.secondaryPersona?.enabled===true,huiMentionedName:config.secondaryPersona?.activationMode==='mentioned-name',
    humanitiesRouting:config.secondaryPersona?.routeHumanities===true,canaryDisabled:config.secondaryPersona?.canary===null,
    protectedGroupMentionsOnly:config.additionalGroups?.find(g=>g.groupId==='1000000004')?.replyPolicy==='mentions-only',
    profilePathPresent:typeof runtime.profilePath==='string',privateMemberMemoryAutoMerged:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await officialReadiness(process.argv[2]);console.log(JSON.stringify(result));if(!result.readyToConnect)process.exitCode=2;}
  catch{console.error(JSON.stringify({readyToConnect:false,code:'OFFICIAL_CONFIG_UNREADABLE'}));process.exitCode=1;}
}
