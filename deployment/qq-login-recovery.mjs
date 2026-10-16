import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export async function recoverLogin({api,botId,passwordMd5,state={},save=async()=>{},now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(!/^\d{4,20}$/.test(botId||''))throw Error('BOT_ID_REQUIRED');
 const update=async fields=>{state={...state,...fields,checkedAt:new Date(now()).toISOString()};await save(state);return state;};
 const ready=async status=>{if(!status.isLogin||!(status.coreReady||status.loginPhase==='ready'))return false;const info=await api('/QQLogin/GetQQLoginInfo');if(String(info.uin||info.user_id)!==botId)throw Error('WRONG_LOGGED_IN_ACCOUNT');return true;};
 let status=await api('/QQLogin/CheckLoginStatus');
 try{if(await ready(status))return update({phase:'ready',challenge:null,consecutiveFailures:0,nextAttemptAt:0});}
 catch(e){if(e.message==='WRONG_LOGGED_IN_ACCOUNT')return update({phase:'human-verification-required',challenge:'account-mismatch'});return update({phase:'waiting-login-service'});}
 if(['qrcode_scanned','initializing','reconnecting'].includes(status.loginPhase))return update({phase:'waiting-login-service'});
 if(state.challenge)return update({phase:'human-verification-required'});
 if(state.nextAttemptAt>now())return update({phase:'retry-backoff'});
 if((state.consecutiveFailures||0)>=5)return update({phase:'manual-review-required'});
 if(!/^[a-f0-9]{32}$/.test(passwordMd5||''))throw Error('INVALID_PROTECTED_CREDENTIAL');
 const fail=async phase=>{const n=(state.consecutiveFailures||0)+1;return update({phase,consecutiveFailures:n,nextAttemptAt:now()+Math.min(3600000,120000*2**(n-1)),lastAttemptAt:new Date(now()).toISOString()});};
 const waitReady=async()=>{for(let n=0;n<4;n++){await sleep(1500);if(await ready(await api('/QQLogin/CheckLoginStatus')))return true;}return false;};
 let quick=[];try{quick=await api('/QQLogin/GetQuickLoginListNew');}catch{}
 if(Array.isArray(quick)&&quick.some(x=>String(x.uin)===botId&&x.isQuickLogin!==false)){
  try{await api('/QQLogin/SetQuickLogin',{uin:botId});if(await waitReady())return update({phase:'ready',challenge:null,lastMethod:'quick-login',consecutiveFailures:0,nextAttemptAt:0});}catch{}
 }
 await update({phase:'password-login-in-progress',lastAttemptAt:new Date(now()).toISOString(),nextAttemptAt:now()+600000});
 let result;try{result=await api('/QQLogin/PasswordLogin',{uin:botId,passwordMd5});}catch{return fail('password-login-unavailable');}
 if(result?.needCaptcha||result?.needNewDevice)return update({phase:'human-verification-required',challenge:result.needCaptcha?'captcha':'device-verification',lastMethod:'password',nextAttemptAt:0});
 if(result?.result===false)return fail('password-login-rejected');
 try{if(await waitReady())return update({phase:'ready',challenge:null,lastMethod:'password',consecutiveFailures:0,nextAttemptAt:0});}catch{}
 return fail('password-login-not-ready');
}

export function makeWebuiApi({base='http://127.0.0.1:6099/api',credential,fetchFn=fetch}){
 if(base!=='http://127.0.0.1:6099/api')throw Error('FIXED_LOOPBACK_WEBUI_REQUIRED');
 return async(path,body={})=>{if(!/^\/QQLogin\/[A-Za-z]+$/.test(path))throw Error('LOGIN_PATH_REQUIRED');const r=await fetchFn(base+path,{method:'POST',headers:{authorization:'Bearer '+credential,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(path.includes('Password')?25000:6000)});const x=await r.json();if(!r.ok||x.code!==0)throw Error('WEBUI_OPERATION_FAILED');return x.data;};
}
async function cli(){
 const root=fileURLToPath(new URL('../',import.meta.url)),at=process.argv.indexOf('--config');
 const c=JSON.parse(await readFile(at<0?join(root,'private/live-config.json'):resolve(process.argv[at+1]),'utf8'));
 const p=JSON.parse(await readFile(c.profilePath,'utf8'));
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>100)throw Error('INVALID_CREDENTIAL_INPUT');}
 const passwordMd5=input.trim();input='';
 const base='http://127.0.0.1:6099/api';const a=await(await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({hash:createHash('sha256').update(c.webuiToken+'.napcat').digest('hex')}),redirect:'error',signal:AbortSignal.timeout(6000)})).json();
 const credential=a.data?.Credential||a.data?.credential;if(!credential)throw Error('WEBUI_AUTH_FAILED');
 const dir=join(c.runtimeRoot,'..','supervision'),path=join(dir,'login-recovery.json');await mkdir(dir,{recursive:true});
 let state={};try{state=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const save=async value=>{const pending=path+'.pending';await writeFile(pending,JSON.stringify(value,null,2),{mode:0o600});await rename(pending,path);};
 const r=await recoverLogin({api:makeWebuiApi({credential}),botId:p.botId,passwordMd5,state,save});
 console.log(JSON.stringify({phase:r.phase,challenge:r.challenge||null,method:r.lastMethod||null,consecutiveFailures:r.consecutiveFailures||0}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))cli().catch(()=>{console.log(JSON.stringify({phase:'recovery-error',code:'LOGIN_RECOVERY_FAILED'}));process.exitCode=1;});
