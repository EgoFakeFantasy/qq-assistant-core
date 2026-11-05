import {QQBot} from '@tencent-connect/qqbot-nodejs';
import {join,resolve} from 'node:path';
import {createOfficialChannel,validateOfficialSettings} from '../../src/channels/qq/official-channel.js';

export async function openOfficialRuntime(runtime,config,{env=process.env,SDK=QQBot}={}){
  if(runtime.transport!=='qq-official')throw Error('OFFICIAL_TRANSPORT_NOT_SELECTED');
  const settings=validateOfficialSettings(runtime.qqOfficial,config);
  // The separate root prevents new OpenIDs from inheriting old QQ-member data.
  if(!runtime.legacyRuntimeRoot||resolve(runtime.runtimeRoot)===resolve(runtime.legacyRuntimeRoot)||runtime.hubPort===runtime.legacyHubPort)throw Error('OFFICIAL_ISOLATED_RUNTIME_REQUIRED');
  const secret=env.QQBOT_APP_SECRET;
  if(typeof secret!=='string'||secret.length<8||secret.length>4096)throw Error('QQBOT_APP_SECRET_REQUIRED');
  const sdk=new SDK({appId:settings.appId,appSecret:secret,baseUrl:'https://api.bot.qq.com',transport:'websocket',intents:1<<25,reconnect:{maxAttempts:10},markdownSupport:false});
  // No SDK raw/body logger: events may contain credentials or private content.
  return createOfficialChannel({settings,config,statePath:join(runtime.runtimeRoot,'official-channel','state.json'),sdk});
}

export function createOfficialHubIngress({address,token,fetchFn=fetch}){
  const url=new URL(address);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.search||url.hash||url.username||url.password||typeof token!=='string'||token.length<24)throw Error('OFFICIAL_LOOPBACK_HUB_REQUIRED');
  return async payload=>{
    const r=await fetchFn(new URL('/api/onebot/event',url),{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
    if(r.status!==202)throw Error('OFFICIAL_HUB_INGRESS_FAILED');return r.json();
  };
}

export async function probeOfficialConnection(channel,settings,{timeoutMs=15000}={}){
  channel.bindIngress(async()=>({status:'probe-no-model-no-reply'}));
  const controller=new AbortController();let failed=false;
  const run=channel.start(controller.signal).catch(()=>{failed=true;});
  const deadline=Date.now()+timeoutMs;
  try{
    while(!channel.diagnostics.online&&!failed&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
    if(!channel.diagnostics.online)return {online:false,allGroupsVerified:false,code:'OFFICIAL_CONNECTION_NOT_READY'};
    const groups=await Promise.all(settings.groups.map(async g=>{try{return {groupId:g.groupId,...await channel.transport({groupId:g.groupId}).check()};}catch{return {groupId:g.groupId,online:true,memberOfGroup:false};}}));
    return {online:true,allGroupsVerified:groups.every(g=>g.memberOfGroup===true),groups};
  }finally{controller.abort();await channel.close();await run;}
}
