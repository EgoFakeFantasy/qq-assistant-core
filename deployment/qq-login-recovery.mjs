import {authenticateWebui} from './napcat-webui-auth.mjs';
import {verifyQqSession} from './qq-session-health.mjs';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const BOT='2000000002';
const WINDOW=3600000, CHALLENGE_TTL=600000, MAX_ATTEMPTS=5;
const timestamp=value=>typeof value==='number'?value:(Date.parse(value)||0);
// The hidden Windows PowerShell host can use a different code page from Node.
// Keep the machine channel ASCII; JSON consumers still receive the full labels.
export const serializeRecoveryOutput=value=>JSON.stringify(value).replace(/[^\x00-\x7f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));

export function recoveryLabel(phase) {
 return ({ready:'QQ已上线', 'waiting-login-service':'等待QQ登录服务', 'retry-backoff':'自动恢复退避中',
  'recovery-cooldown':'自动恢复冷却中','platform-security-check':'腾讯安全检查待续',
  'device-confirmation-pending':'等待当前设备确认','phone-confirmation-pending':'腾讯明确要求手机QQ扫码确认','password-login-in-progress':'正在使用保存密码登录',
  'quick-login-in-progress':'正在恢复已保存会话','onebot-verification-pending':'等待消息接口就绪',
  'group-verification-pending':'核对群成员关系','account-mismatch':'当前账号与机器人账号不符',
  'password-login-rejected':'密码登录请求未获接受','password-login-unavailable':'密码登录接口暂不可用',
  'password-login-not-ready':'登录请求后尚未上线'})[phase]||'自动恢复状态待检查';
}

export async function recoverLogin({api,passwordMd5,botId=BOT,state={},save=async()=>{},verifyOnline=async()=>null,
 observeVerification=async()=>null,now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),force=false}) {
 if(!/^\d{4,20}$/.test(botId||''))throw Error('INVALID_BOT_ID');
 const legacy=state.schemaVersion!==2;
 const legacyAttempt=timestamp(state.lastInteractiveAttemptAt)||timestamp(state.lastAttemptAt);
 if(legacy&&!Array.isArray(state.attemptHistory)&&legacyAttempt>now()-WINDOW&&legacyAttempt<=now()+1000)state={...state,attemptHistory:[legacyAttempt]};
 const update=async fields=>{state={...state,...fields,schemaVersion:2,checkedAt:new Date(now()).toISOString()};await save(state);return state;};
 const clearChallenge={challenge:null,challengeObservedAt:null,challengeExpiresAt:null,verificationUiActive:false,operatorAction:null,phoneScanExplicitlyRequired:false,nativeLoginErrorCode:null};
 const verified=async()=>{try{return await verifyOnline();}catch{return null;}};
 const complete=async method=>{
  const actual=await verified();
  const phase=actual?.accountMismatch?'account-mismatch':actual?.qqOnline&&actual?.accountMatches&&actual?.allGroupsVerified?'ready':actual?.qqOnline?'group-verification-pending':'onebot-verification-pending';
  return update({...clearChallenge,phase,lastMethod:method||state.lastMethod,webuiSessionPresent:true,
   qqOnline:actual?.qqOnline===true,allGroupsVerified:actual?.allGroupsVerified===true,
   consecutiveFailures:phase==='ready'?0:(state.consecutiveFailures||0),nextAttemptAt:0});
 };
 const actual=await verified();
 if(actual?.accountMismatch)return update({phase:'account-mismatch',operatorAction:'check-current-account',qqOnline:false});
 if(actual?.qqOnline&&actual?.accountMatches&&actual?.allGroupsVerified)return update({...clearChallenge,phase:'ready',qqOnline:true,allGroupsVerified:true,consecutiveFailures:0,nextAttemptAt:0});
 const status=await api('/QQLogin/CheckLoginStatus');
 if(status.isLogin||status.loginPhase==='ready')return complete();
 if(['initializing','reconnecting','qrcode_scanned'].includes(status.loginPhase))return update({phase:'waiting-login-service',lastLoginPhase:status.loginPhase,operatorAction:status.loginPhase==='qrcode_scanned'?'confirm-current-phone-request':null});

 const challengeStart=timestamp(state.challengeObservedAt)||timestamp(state.lastInteractiveAttemptAt)||timestamp(state.lastAttemptAt);
 let observation;try{observation=await observeVerification();}catch{}
 const observedAt=timestamp(observation?.observedAt);
 const freshObservation=observedAt>0&&now()-observedAt>=-5000&&now()-observedAt<=120000&&(!challengeStart||observedAt>=challengeStart)&&(!state.challenge||!observation.kind||observation.kind===state.challenge);
 if(freshObservation&&observation.active===true) {
  const device=observation.kind==='device-verification',phone=observation.kind==='phone-login';
  return update({phase:phone?'phone-confirmation-pending':device?'device-confirmation-pending':'platform-security-check',verificationUiActive:true,
   verificationObservedAt:observation.observedAt,operatorAction:phone?'scan-current-qq-login-code':device?'complete-current-device-confirmation':null});
 }
 const ended=state.verificationUiActive===false&&state.lastInteractiveResult==='verification-returned-without-login';
 const challengeExpiry=timestamp(state.challengeExpiresAt)||(challengeStart?challengeStart+CHALLENGE_TTL:0);
 if(state.challenge&&challengeExpiry>now()&&!ended&&!(freshObservation&&observation.active===false)) {
  return update({phase:state.challenge==='phone-login'?'phone-confirmation-pending':state.challenge==='device-verification'?'device-confirmation-pending':'platform-security-check',
   challengeExpiresAt:challengeExpiry,operatorAction:state.challenge==='phone-login'?'scan-current-qq-login-code':state.challenge==='device-verification'?'complete-current-device-confirmation':null});
 }
 if(state.challenge)await update({...clearChallenge,verificationUiActive:false,staleChallengeClearedAt:new Date(now()).toISOString()});
 // force never overrides cooldown, active verification, or the rolling rate limit.
 if(timestamp(state.nextAttemptAt)>now())return update({phase:'retry-backoff',operatorAction:null});
 let history=Array.isArray(state.attemptHistory)?state.attemptHistory.filter(t=>typeof t==='number'&&t>now()-WINDOW&&t<=now()+1000):[];
 if(!history.length&&legacy&&challengeStart>now()-WINDOW)history=[challengeStart];
 if(history.length>=MAX_ATTEMPTS)return update({phase:'recovery-cooldown',attemptHistory:history,nextAttemptAt:Math.min(...history)+WINDOW,operatorAction:null});
 if(legacy&&(state.consecutiveFailures||0)>=5&&!history.length&&!challengeStart)return update({phase:'recovery-cooldown',nextAttemptAt:now()+WINDOW,operatorAction:null});
 if(!/^[a-f0-9]{32}$/.test(passwordMd5||''))throw Error('INVALID_PROTECTED_CREDENTIAL');
 const register=async(method,phase)=>{
  history=history.filter(t=>t>now()-WINDOW);
  if(history.length>=MAX_ATTEMPTS)return false;
  history.push(now());
  await update({...clearChallenge,phase,lastMethod:method,attemptHistory:history,lastAttemptAt:new Date(now()).toISOString(),
   nextAttemptAt:now()+CHALLENGE_TTL,lastInteractiveResult:null,lastInteractiveAttemptAt:null,verificationUiActive:null});
  return true;
 };
 const fail=async category=>{const failures=(state.consecutiveFailures||0)+1;return update({phase:category,consecutiveFailures:failures,nextAttemptAt:now()+Math.min(WINDOW,120000*2**Math.min(failures-1,5)),operatorAction:null});};
 const waitReady=async()=>{for(let n=0;n<4;n++){await sleep(1500);const s=await api('/QQLogin/CheckLoginStatus');if(s.isLogin||s.loginPhase==='ready')return true;if(['initializing','reconnecting','qrcode_scanned'].includes(s.loginPhase))return false;}return false;};
 let quick=[];try{quick=await api('/QQLogin/GetQuickLoginListNew');}catch{}
 if(Array.isArray(quick)&&quick.some(x=>String(x.uin)===botId&&x.isQuickLogin!==false)) {
  await register('quick-login','quick-login-in-progress');
  try{await api('/QQLogin/SetQuickLogin',{uin:botId});if(await waitReady())return complete('quick-login');}catch{}
  const current=await api('/QQLogin/CheckLoginStatus');
  if(['initializing','reconnecting','qrcode_scanned'].includes(current.loginPhase))return update({phase:'waiting-login-service',lastLoginPhase:current.loginPhase});
 }
 if(!await register('password','password-login-in-progress'))return update({phase:'recovery-cooldown',nextAttemptAt:Math.min(...history)+WINDOW});
 let result;try{result=await api('/QQLogin/PasswordLogin',{uin:botId,passwordMd5});}catch{return fail('password-login-unavailable');}
 if(result?.needCaptcha||result?.needNewDevice) {
  const device=result.needNewDevice===true;
  return update({phase:device?'device-confirmation-pending':'platform-security-check',challenge:device?'device-verification':'captcha',
   challengeObservedAt:new Date(now()).toISOString(),challengeExpiresAt:now()+CHALLENGE_TTL,nextAttemptAt:now()+CHALLENGE_TTL,
   operatorAction:device?'complete-current-device-confirmation':null,lastMethod:'password'});
 }
 if(result?.result===false)return fail('password-login-rejected');
 if(await waitReady())return complete('password');
 return fail('password-login-not-ready');
}

export function makeWebuiApi({fetchFn=fetch,base,credential,refreshAuthentication}) {
 let current=credential;
 return async(path,body={})=>{
  for(let attempt=0;attempt<2;attempt++) {
   const r=await fetchFn(base+path,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+current,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(path.includes('Password')?25000:5000)});
   let data;try{data=await r.json();}catch{throw Error('WEBUI_OPERATION_FAILED');}
   const authRejected=r.status===401||r.status===403||data.code===401||data.code===403||(data.code===-1&&[data.message,data.msg].some(x=>x==='Unauthorized'));
   if(authRejected&&attempt===0&&refreshAuthentication) {
    current=(await refreshAuthentication()).credential;continue;
   }
   if(!r.ok||data.code!==0)throw Error('WEBUI_OPERATION_FAILED');
   return data.data;
  }
  throw Error('WEBUI_OPERATION_FAILED');
 };
}

async function cli() {
 if(process.argv.includes('--force'))throw Error('RECOVERY_OVERRIDE_NOT_SUPPORTED');
 const root=fileURLToPath(new URL('../',import.meta.url));
 const at=process.argv.indexOf('--config');
 const config=JSON.parse(await readFile(at<0?join(root,'private/live-config.json'):process.argv[at+1],'utf8'));
 const profile=JSON.parse(await readFile(config.profilePath,'utf8'));
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>100)throw Error('INVALID_CREDENTIAL_INPUT');}
 const passwordMd5=input.trim();input='';
 const authentication=()=>authenticateWebui({runtime:config,root});
 const {base,credential,tokenSource}=await authentication();
 const path=join(root,'private/supervision/login-recovery.json');
 let state={};try{state=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const save=async s=>{await mkdir(join(root,'private/supervision'),{recursive:true});const tmp=path+'.pending';await writeFile(tmp,JSON.stringify(s,null,2),{mode:0o600});await rename(tmp,path);};
 const observeVerification=async()=>{try{return JSON.parse(await readFile(join(root,'private/supervision/login-ui-observation.json'),'utf8'));}catch{return null;}};
 const r=await recoverLogin({botId:profile.botId,api:makeWebuiApi({base,credential,refreshAuthentication:authentication}),passwordMd5,state,save,observeVerification,
  verifyOnline:()=>verifyQqSession({oneBotBase:config.oneBotBase,oneBotToken:config.oneBotToken,botId:profile.botId,groupIds:profile.allowedGroupIds})});
 console.log(serializeRecoveryOutput({phase:r.phase,status:recoveryLabel(r.phase),method:r.lastMethod||null,challenge:r.challenge||null,
  operatorAction:r.operatorAction||null,panelAuthenticated:true,panelTokenSource:tokenSource,consecutiveFailures:r.consecutiveFailures||0,
  nextAttemptAt:r.nextAttemptAt?new Date(r.nextAttemptAt).toISOString():null,passwordStoredEncrypted:true,schemaVersion:2}));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])cli().catch(error=>{
 const safe=new Set(['WEBUI_TOKEN_UNAVAILABLE','WEBUI_AUTH_FAILED','WEBUI_AUTH_BACKOFF','WEBUI_UNAVAILABLE','RECOVERY_OVERRIDE_NOT_SUPPORTED']);
 console.log(JSON.stringify({phase:'recovery-error',code:safe.has(error.message)?error.message:'LOGIN_RECOVERY_FAILED'}));process.exitCode=1;
});
