import {createHash} from 'node:crypto';
import {createOneBotCaller} from './onebot-client.mjs';

export const LLBOT_ACCOUNT='2000000002';
export const LLBOT_GROUPS=['1000000001','1000000002','1000000003','1000000004'];

export function buildLLBotConfig({runtime,profile,defaults,webuiPort=3080,forwardEvents=false}){
  if(!/^\d{4,20}$/.test(profile.botId||'')||!Array.isArray(profile.allowedGroupIds)||!profile.allowedGroupIds.length||profile.allowedGroupIds.some(id=>!/^\d{4,20}$/.test(id))||!profile.allowedGroupIds.includes(profile.groupId))throw Error('LLBOT_ACCOUNT_OR_GROUPS');
  if(runtime.transport&&runtime.transport!=='onebot')throw Error('LLBOT_ONEBOT_SOURCE_REQUIRED');
  const base=new URL(runtime.oneBotBase);
  if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||base.pathname!=='/'||base.search||base.hash||base.username||base.password)throw Error('LLBOT_LOOPBACK_REQUIRED');
  if(typeof runtime.oneBotToken!=='string'||runtime.oneBotToken.length<24||typeof runtime.hubToken!=='string'||runtime.hubToken.length<24)throw Error('LLBOT_TOKEN_REQUIRED');
  if(!Number.isInteger(runtime.hubPort)||!Number.isInteger(webuiPort)||webuiPort<1024||webuiPort>65535||[Number(base.port||80),runtime.hubPort].includes(webuiPort))throw Error('LLBOT_PORT_CONFLICT');
  const protectedScope=profile.groupId==='1000000004'?profile:profile.additionalGroups?.find(g=>g.groupId==='1000000004');
  if(profile.allowedGroupIds.includes('1000000004')&&protectedScope?.replyPolicy!=='mentions-only')throw Error('LLBOT_PROTECTED_GROUP_POLICY');
  const config=structuredClone(defaults);
  config.webui={enable:true,host:'127.0.0.1',port:webuiPort};
  config.milky={...config.milky,enable:false};config.satori={...config.satori,enable:false};
  config.ob11={enable:true,connect:[
    {type:'http',enable:true,host:'127.0.0.1',port:Number(base.port||80),token:runtime.oneBotToken,messageFormat:'array',reportSelfMessage:false,reportOfflineMessage:false,debug:false},
    {type:'http-post',enable:forwardEvents,url:'http://127.0.0.1:'+runtime.hubPort+'/api/onebot/event',token:runtime.hubToken,enableHeart:false,messageFormat:'array',reportSelfMessage:false,reportOfflineMessage:false,debug:false}
  ]};
  config.log=false;config.logLevel='warn';config.autoDeleteFile=false;config.enableLocalFile2Url=false;
  config.msgCacheExpire=Math.max(3600,Math.ceil((profile.modelTimeoutMs||1500000)/1000)+600);
  return config;
}

export async function probeLLBot({runtime,profile,webuiToken,webuiPort=3080,fetchFn=fetch}){
  const account=profile?.botId||LLBOT_ACCOUNT,groupIds=profile?.allowedGroupIds||LLBOT_GROUPS;
  if(!/^\d{4,20}$/.test(account)||!Array.isArray(groupIds)||!groupIds.length||groupIds.some(id=>!/^\d{4,20}$/.test(id)))throw Error('LLBOT_ACCOUNT_OR_GROUPS');
  const state={bridge:'llbot',hubReachable:false,oneBotReachable:false,webuiReachable:false,panelAuthenticated:false,qqOnline:false,accountMatches:false,accountMismatch:false,memberOfGroup:false,allGroupsVerified:false,requiresPhoneLogin:null,busy:false,groups:groupIds.map(groupId=>({groupId,online:false,memberOfGroup:false}))};
  const call=createOneBotCaller({baseUrl:runtime.oneBotBase,token:runtime.oneBotToken,fetchFn});
  async function read(url,options={}){const r=await fetchFn(url,{...options,redirect:'error',signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('LLBOT_HTTP_UNAVAILABLE');return r.json();}
  await Promise.all([
    (async()=>{const r=await Promise.allSettled([call('get_status'),call('get_login_info')]);const status=r[0].status==='fulfilled'?r[0].value:null,login=r[1].status==='fulfilled'?r[1].value:null;
      state.oneBotReachable=r.some(x=>x.status==='fulfilled');state.accountMatches=String(login?.user_id)===account;state.accountMismatch=Boolean(login?.user_id)&&!state.accountMatches;state.qqOnline=status?.online===true&&state.accountMatches;
      if(!state.qqOnline)return;try{const groups=await call('get_group_list');if(!Array.isArray(groups))return;const ids=new Set(groups.map(g=>String(g.group_id)));state.groups=groupIds.map(groupId=>({groupId,online:true,memberOfGroup:ids.has(groupId)}));state.memberOfGroup=ids.has(groupIds[0]);state.allGroupsVerified=state.groups.every(g=>g.memberOfGroup);}catch{}
    })(),
    (async()=>{try{const m=await read('http://127.0.0.1:'+runtime.hubPort+'/api/maintenance',{headers:{authorization:'Bearer '+runtime.hubToken}});state.hubReachable=m.profile==='set-theory';state.busy=m.queued>0||m.active>0;}catch{}})(),
    (async()=>{try{const base='http://127.0.0.1:'+webuiPort;const r=await fetchFn(base,{redirect:'error',signal:AbortSignal.timeout(4000)});state.webuiReachable=r.ok;
      if(!webuiToken)return;const response=await read(base+'/api/login-info',{headers:{'X-Webui-Token':createHash('sha256').update(webuiToken.trim()).digest('hex')}});
      state.panelAuthenticated=response.success===true;state.panelSessionOnline=response.data?.online===true;state.loginMode=['pmhq','direct'].includes(response.data?.mode)?response.data.mode:null;
      // Panel readiness never substitutes for actual OneBot identity/membership.
    }catch{}})()
  ]);
  state.loginRecoveryAction=state.qqOnline&&state.allGroupsVerified?'verified-online':'llbot-current-login-inspection';
  return state;
}
