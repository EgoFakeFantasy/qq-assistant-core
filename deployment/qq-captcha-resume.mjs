import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile,readdir,rename} from 'node:fs/promises';
import {createDeviceResume,currentDeviceUrl} from './qq-device-resume.mjs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {authenticateWebui} from './napcat-webui-auth.mjs';
import {makeWebuiApi} from './qq-login-recovery.mjs';
import {verifyQqSession} from './qq-session-health.mjs';
export function captchaParameters(url,botId='2000000002'){
 if(!/^\d{4,20}$/.test(botId))throw Error('INVALID_BOT_ID');
 const u=new URL(url);if(u.origin!=='https://ti.qq.com'||u.pathname!=='/safe/tools/captcha/sms-verify-login')throw Error('UNEXPECTED_TENCENT_ORIGIN');
 const params=Object.fromEntries(['aid','sid','uin','login_appid'].filter(k=>u.searchParams.has(k)).map(k=>[k,u.searchParams.get(k)]));
 if(!params.sid||params.uin&&params.uin!==botId)throw Error('UNEXPECTED_CHALLENGE_ACCOUNT');return params;
}
export function captchaDeviceHandoff(state,at) {
 if(!Number.isFinite(at))throw Error('INVALID_HANDOFF_TIME');
 return {...state,schemaVersion:2,phase:'device-confirmation-pending',challenge:'device-verification',challengeObservedAt:new Date(at).toISOString(),challengeExpiresAt:at+600000,nextAttemptAt:at+600000,verificationUiActive:true,operatorAction:'complete-current-device-confirmation',lastInteractiveResult:null,lastInteractiveAttemptAt:null,checkedAt:new Date(at).toISOString(),captchaVerifiedAt:new Date(at).toISOString(),qqOnline:false,allGroupsVerified:false};
}
export async function createCaptchaResume({proofWaterUrl,expiresAt,submit,now=Date.now,botId='2000000002'}){
 const params=captchaParameters(proofWaterUrl,botId);if(!Number.isFinite(expiresAt)||expiresAt<=now()||expiresAt-now()>600000)throw Error('CHALLENGE_NOT_CURRENT');
 const nonce=randomBytes(32).toString('hex'),path='/resume/'+nonce;let phase='ready',origin;
 const payload=JSON.stringify({...params,expiresAt}).replaceAll('<','\\u003c');
 const html='<!doctype html><meta charset="utf-8"><title>QQ 当前验证续接</title><style>body{font:18px system-ui;margin:36px}button{font:inherit;padding:10px}</style><h1>QQ · 当前验证续接</h1><p id="status">使用现有密码登录请求，不发起新的密码登录。</p><p id="deadline"></p><button id="start">打开当前验证</button><script src="https://captcha.gtimg.com/TCaptcha.js"></script><script>const p='+payload+';const out=document.getElementById("status"),start=document.getElementById("start"),deadline=document.getElementById("deadline");let submitted=false;const remaining=()=>Math.max(0,p.expiresAt-Date.now());const expired=()=>{out.textContent="本轮登录请求已过期，不能继续提交；请核验当前OneBot状态。";start.disabled=true;};const tick=()=>{const left=remaining();deadline.textContent=left>0?"本轮登录请求剩余 "+Math.ceil(left/1000)+" 秒":"本轮登录请求已到期";if(left===0&&!submitted)expired();};tick();setInterval(tick,1000);start.onclick=()=>{if(remaining()===0){expired();return;}new TencentCaptcha(p.aid||"2081081773",async r=>{if(remaining()===0){expired();return;}if(r.ret!==0||r.errorCode!=null&&r.errorCode!==0||!r.ticket||!r.randstr||/^(?:t|tr)error_/.test(r.ticket)){out.textContent="腾讯验证组件未完成（ret="+String(r.ret)+"，errorCode="+String(r.errorCode??null)+"），未提交登录票据。";return;}submitted=true;out.textContent="验证票据正在交回 NapCat…";let v={};try{const s=await fetch(location.pathname+"/submit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ret:r.ret,errorCode:r.errorCode,ticket:r.ticket,randstr:r.randstr})});v=await s.json();if(v.error==="CHALLENGE_EXPIRED"){expired();return;}out.textContent=v.online?"OneBot 已核验：账号正确，全部配置群正常。":v.needNewDevice?(v.deviceUnavailable?"腾讯要求设备确认，但本次设备二维码接口未返回可用令牌；未生成二维码。":"腾讯要求新设备确认，QQ尚未上线。"):v.accepted?"票据已交回 NapCat，正在等待 OneBot 上线。":"本次登录续接未获接受，QQ尚未上线。";}catch{out.textContent=remaining()===0?"本轮登录请求已过期，续接连接已结束；请核验当前OneBot状态。":"本次续接接口未完成，QQ尚未上线。";}if(v.deviceUrl){const a=document.createElement("a");a.href=v.deviceUrl;a.textContent="打开当前设备确认";out.appendChild(document.createElement("br"));out.appendChild(a);}}, {type:"full",showHeader:false,enableAged:true,login_appid:p.login_appid,uin:p.uin,sid:p.sid}).show();};</script>';
 const server=createServer(async(req,res)=>{
  const send=(status,data,type='application/json')=>{res.writeHead(status,{'content-type':type+'; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline' https://*.qq.com https://*.gtimg.com https://*.captcha.qcloud.com https://*.qcloudimg.com; style-src 'self' 'unsafe-inline'; frame-src https://*.qq.com https://*.gtimg.com https://*.captcha.qcloud.com https://*.qcloudimg.com; img-src 'self' data: https://*.qq.com https://*.gtimg.com https://*.captcha.qcloud.com https://*.qcloudimg.com; connect-src 'self' https://*.qq.com https://*.gtimg.com https://*.captcha.qcloud.com https://*.qcloudimg.com; frame-ancestors 'none'"});res.end(type==='application/json'?JSON.stringify(data):data);};
  if(req.headers.host!==new URL(origin).host)return send(403,{error:'HOST_REJECTED'});
  if(now()>=expiresAt)return send(410,{error:'CHALLENGE_EXPIRED'});
  if(req.method==='GET'&&req.url===path)return send(200,html,'text/html');
  if(req.method!=='POST'||req.url!==path+'/submit')return send(404,{error:'NOT_FOUND'});
  if(req.headers.origin!==origin||!String(req.headers['content-type']).startsWith('application/json'))return send(403,{error:'ORIGIN_REJECTED'});
  if(phase!=='ready')return send(409,{error:'ALREADY_SUBMITTED'});
  let body='';try{for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384)return send(413,{error:'TOO_LARGE'});}const v=JSON.parse(body);if(v.ret!==0||v.errorCode!=null&&v.errorCode!==0||typeof v.ticket!=='string'||!v.ticket||v.ticket.length>8192||/^(?:t|tr)error_/.test(v.ticket)||typeof v.randstr!=='string'||!v.randstr||v.randstr.length>1024)return send(400,{error:'INVALID_RESULT'});
   if(now()>=expiresAt)return send(410,{error:'CHALLENGE_EXPIRED'});if(phase!=='ready')return send(409,{error:'ALREADY_SUBMITTED'});phase='submitted';const result=await submit({ticket:v.ticket,randstr:v.randstr,sid:params.sid});phase='completed';return send(200,{accepted:result.accepted===true,online:result.online===true,needNewDevice:result.needNewDevice===true,deviceUnavailable:result.deviceUnavailable===true,...(result.deviceUrl?{deviceUrl:result.deviceUrl}:{})});
  }catch{phase=phase==='submitted'?'uncertain':phase;return send(502,{error:'RESUME_NOT_COMPLETED'});}
 });
 server.requestTimeout=20000;server.headersTimeout=15000;await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const timer=setTimeout(()=>server.close(),Math.min(600000,expiresAt-now()));timer.unref();return {url:origin+path,origin,get phase(){return phase},close:()=>new Promise(r=>{clearTimeout(timer);server.close(r);server.closeIdleConnections();})};
}
async function cli(){
 const root=fileURLToPath(new URL('../',import.meta.url)),config=JSON.parse(await readFile(join(root,'private/live-config.json'),'utf8')),state=JSON.parse(await readFile(join(root,'private/supervision/login-recovery.json'),'utf8'));
 const profile=JSON.parse(await readFile(config.profilePath,'utf8')),botId=profile.botId;
 const observed=Date.parse(state.challengeObservedAt),expiry=Number(state.challengeExpiresAt);if(state.challenge!=='captcha'||!observed||Date.now()-observed>600000||expiry<=Date.now())throw Error('NO_CURRENT_PASSWORD_CHALLENGE');if(expiry-Date.now()<180000)throw Error('CURRENT_CHALLENGE_TOO_CLOSE_TO_EXPIRY');
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>100)throw Error('INVALID_PROTECTED_CREDENTIAL');}let passwordMd5=input.trim();input='';if(!/^[a-f0-9]{32}$/.test(passwordMd5))throw Error('INVALID_PROTECTED_CREDENTIAL');
 const folder=join(root,'private/supervision'),files=(await readdir(folder,{withFileTypes:true})).filter(x=>x.isFile()&&/^qq-\d{8}-\d{6}-\d{3}\.stdout\.log$/.test(x.name)).map(x=>x.name).sort().reverse();let proofWaterUrl;
 for(const file of files.slice(0,2)){const text=(await readFile(join(folder,file),'utf8')).replace(/\x1b\[[0-9;]*m/g,'');for(const line of text.split(/\r?\n/).reverse()){const match=line.match(/^(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}).*proofWaterUrl:\s+(https:\/\/\S+)/);if(!match)continue;const t=new Date(new Date().getFullYear(),+match[1]-1,+match[2],+match[3],+match[4],+match[5]).getTime();if(Math.abs(t-observed)<10000){proofWaterUrl=match[6];break;}}if(proofWaterUrl)break;}
 if(!proofWaterUrl)throw Error('CURRENT_CHALLENGE_LINK_NOT_FOUND');const auth=()=>authenticateWebui({runtime:config,root}),a=await auth(),api=makeWebuiApi({...a,refreshAuthentication:auth});
 const bridge=await createCaptchaResume({botId,proofWaterUrl,expiresAt:expiry,submit:async value=>{
  const result=await api('/QQLogin/CaptchaLogin',{uin:botId,passwordMd5,...value});
  if(result?.needNewDevice){
   const deviceObserved=Date.now(),deviceExpiry=deviceObserved+600000;
   currentDeviceUrl(result.jumpUrl);
   const file=join(folder,'login-recovery.json');
   const saveDevice=async phase=>{
    let previous=JSON.parse(await readFile(file,'utf8'));
    if(phase==='waiting')previous=captchaDeviceHandoff(previous,deviceObserved);
    else Object.assign(previous,{checkedAt:new Date().toISOString(),verificationUiActive:['scanned','submitting'].includes(phase),phase:phase==='ready'?'ready':'device-confirmation-pending',operatorAction:phase==='ready'?null:'complete-current-device-confirmation',qqOnline:phase==='ready',allGroupsVerified:phase==='ready'});
    if(phase==='ready'){previous.challenge=null;previous.challengeObservedAt=null;previous.challengeExpiresAt=null;previous.nextAttemptAt=0;}
    await writeFile(file+'.pending',JSON.stringify(previous,null,2),{mode:0o600});await rename(file+'.pending',file);
    await writeFile(join(folder,'login-ui-observation.json'),JSON.stringify({observedAt:new Date().toISOString(),active:['waiting','scanned','submitting'].includes(phase),kind:'device-verification',reason:'current-captcha-device-handoff-'+phase}),{mode:0o600});
    if(['ready','pending','failed','expired'].includes(phase))passwordMd5=null;
   };
   await saveDevice('waiting');
   try{
    const device=await createDeviceResume({botId,jumpUrl:result.jumpUrl,expiresAt:deviceExpiry,api:async(path,body)=>{try{return await api(path,path==='/QQLogin/NewDeviceLogin'?{...body,passwordMd5}:body);}finally{if(path==='/QQLogin/NewDeviceLogin')passwordMd5=null;}},verifyOnline:()=>verifyQqSession({...config,botId,groupIds:profile.allowedGroupIds}),onPhase:saveDevice});
    await writeFile(join(folder,'device-resume-connection.json'),JSON.stringify({url:device.url,expiresAt:deviceExpiry}),{mode:0o600});
    return {accepted:true,needNewDevice:true,deviceUrl:device.url};
   }catch{passwordMd5=null;return {accepted:true,needNewDevice:true,deviceUnavailable:true};}
  }
  passwordMd5=null;
  let actual;for(let n=0;n<6;n++){actual=await verifyQqSession({...config,botId,groupIds:profile.allowedGroupIds});if(actual.qqOnline&&actual.accountMatches&&actual.allGroupsVerified)return {accepted:true,online:true};await new Promise(r=>setTimeout(r,1500));}return {accepted:true,online:false};
 }});
 await writeFile(join(folder,'captcha-resume-connection.json'),JSON.stringify({url:bridge.url,expiresAt:expiry}),{mode:0o600});console.log(JSON.stringify({resumePageReady:true,sameChallenge:true,newPasswordAttempt:false,expiresAt:new Date(expiry).toISOString()}));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])cli().catch(error=>{const code=['NO_CURRENT_PASSWORD_CHALLENGE','CURRENT_CHALLENGE_TOO_CLOSE_TO_EXPIRY'].includes(error.message)?error.message:'CURRENT_CAPTCHA_RESUME_UNAVAILABLE';console.log(JSON.stringify({resumePageReady:false,code}));process.exitCode=1;});
