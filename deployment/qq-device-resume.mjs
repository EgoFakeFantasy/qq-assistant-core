import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile,readdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import QRCode from 'qrcode';
import {authenticateWebui} from './napcat-webui-auth.mjs';
import {makeWebuiApi} from './qq-login-recovery.mjs';
import {verifyQqSession} from './qq-session-health.mjs';

export function currentDeviceUrl(value) {
 const u=new URL(value);
 if(u.origin!=='https://accounts.qq.com'||u.pathname!=='/safe/verify'||!u.searchParams.get('sig')||!u.searchParams.get('uin-token'))throw Error('UNEXPECTED_DEVICE_VERIFICATION');
 return u.href;
}

export async function createDeviceResume({jumpUrl,expiresAt,api,verifyOnline,onPhase=async()=>{},now=Date.now,botId='2000000002'}) {
 if(!/^\d{4,20}$/.test(botId))throw Error('INVALID_BOT_ID');
 currentDeviceUrl(jumpUrl);
 if(!Number.isFinite(expiresAt)||expiresAt<=now()||expiresAt-now()>600000)throw Error('DEVICE_VERIFICATION_NOT_CURRENT');
 const qr=await api('/QQLogin/GetNewDeviceQRCode',{uin:botId,jumpUrl});
 if(qr?.ActionStatus==='FAIL'||!qr?.str_url||!qr.bytes_token)throw Error('DEVICE_QR_UNAVAILABLE');
 const qrUrl=new URL(qr.str_url);
 if(qrUrl.protocol!=='https:'||!qrUrl.hostname.endsWith('.qq.com'))throw Error('UNEXPECTED_DEVICE_QR');
 const png=await QRCode.toBuffer(qr.str_url,{width:320,margin:3});
 let phase='waiting',inFlight=false,origin;
 const path='/device/'+randomBytes(32).toString('hex');
 const messages={waiting:'请用当前配置的手机 QQ 账号 扫码确认这台设备。',scanned:'已扫描，请在手机 QQ 确认。',submitting:'设备已确认，正在用已保存的密码续接登录。',ready:'OneBot 已核验：配置账号在线，全部配置群正常。',pending:'设备确认已提交，OneBot 尚未核验上线。',failed:'设备续接未完成；未重复提交。',expired:'本次设备确认已到期。'};
 const server=createServer((req,res)=>{
  const send=(code,body,type)=>{res.writeHead(code,{'content-type':type,'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'"});res.end(body);};
  if(req.headers.host!==new URL(origin).host)return send(403,'Forbidden','text/plain');
  if(req.method!=='GET')return send(405,'Method not allowed','text/plain');
  if(req.url===path+'/qr'&&now()<expiresAt&&['waiting','scanned'].includes(phase))return send(200,png,'image/png');
  if(req.url!==path)return send(404,'Not found','text/plain');
  const show=now()<expiresAt&&['waiting','scanned'].includes(phase);
  return send(200,'<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="5"><title>QQ 当前设备确认</title><style>body{font:18px system-ui;margin:30px;max-width:650px}img{display:block;width:320px;height:320px}</style><h1>QQ · 当前设备确认</h1><p>'+messages[phase]+'</p>'+(show?'<img alt="当前设备确认二维码" src="'+path+'/qr">':'')+'<p>这是已通过图形验证码后的设备确认，不会重新发起密码登录。</p>','text/html; charset=utf-8');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 await onPhase('waiting');
 const poll=setInterval(async()=>{
  if(inFlight||!['waiting','scanned'].includes(phase)||now()>=expiresAt)return;
  inFlight=true;
  try {
   const result=await api('/QQLogin/PollNewDeviceQR',{uin:botId,bytesToken:qr.bytes_token});
   if(result?.uint32_guarantee_status===3&&phase!=='scanned'){phase='scanned';await onPhase(phase);}
   if(result?.uint32_guarantee_status===1){
    if(typeof result.str_nt_succ_token!=='string'||!result.str_nt_succ_token)throw Error('DEVICE_SUCCESS_TOKEN_MISSING');
    phase='submitting';await onPhase(phase);
    await api('/QQLogin/NewDeviceLogin',{uin:botId,newDevicePullQrCodeSig:result.str_nt_succ_token});
    phase='pending';
    for(let n=0;n<6;n++){const s=await verifyOnline();if(s.qqOnline&&s.accountMatches&&s.allGroupsVerified){phase='ready';break;}await new Promise(r=>setTimeout(r,1500));}
    await onPhase(phase);
   }
  } catch {phase='failed';await onPhase(phase);}finally{inFlight=false;}
 },2500);
 const deadline=setTimeout(()=>{clearInterval(poll);if(['waiting','scanned'].includes(phase)){phase='expired';void onPhase(phase);}server.close();server.closeIdleConnections();},expiresAt-now());
 return {url:origin+path,get phase(){return phase},close:()=>new Promise(r=>{clearInterval(poll);clearTimeout(deadline);server.close(r);server.closeIdleConnections();})};
}

async function cli(){
 const root=fileURLToPath(new URL('../',import.meta.url)),folder=join(root,'private/supervision');
 const config=JSON.parse(await readFile(join(root,'private/live-config.json'),'utf8'));
 const profile=JSON.parse(await readFile(config.profilePath,'utf8')),botId=profile.botId;
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>100)throw Error('INVALID_PROTECTED_CREDENTIAL');}
 let passwordMd5=input.trim();input='';if(!/^[a-f0-9]{32}$/.test(passwordMd5))throw Error('INVALID_PROTECTED_CREDENTIAL');
 let jumpUrl,observed;
 const logs=(await readdir(folder)).filter(n=>/^qq-\d{8}-\d{6}-\d{3}\.stdout\.log$/.test(n)).sort().reverse().slice(0,2);
 for(const name of logs){for(const line of (await readFile(join(folder,name),'utf8')).replace(/\x1b\[[0-9;]*m/g,'').split(/\r?\n/).reverse()){
  const m=line.match(/^(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}).*验证码登录后需要新设备验证, jumpUrl:\s+(https:\/\/\S+)/);
  if(!m)continue;observed=new Date(new Date().getFullYear(),+m[1]-1,+m[2],+m[3],+m[4],+m[5]).getTime();
  if(Date.now()-observed<0||Date.now()-observed>=600000)throw Error('CURRENT_DEVICE_VERIFICATION_EXPIRED');jumpUrl=currentDeviceUrl(m[6]);break;
 }if(jumpUrl)break;}
 if(!jumpUrl)throw Error('CURRENT_DEVICE_VERIFICATION_NOT_FOUND');
 const authenticate=()=>authenticateWebui({runtime:config,root});const auth=await authenticate();
 const webui=makeWebuiApi({...auth,refreshAuthentication:authenticate});
 const api=async(path,body)=>{try{return await webui(path,path==='/QQLogin/NewDeviceLogin'?{...body,passwordMd5}:body);}finally{if(path==='/QQLogin/NewDeviceLogin')passwordMd5=null;}};
 const bridge=await createDeviceResume({botId,jumpUrl,expiresAt:observed+600000,api,verifyOnline:()=>verifyQqSession({...config,botId,groupIds:profile.allowedGroupIds}),onPhase:async phase=>{
  const at=new Date().toISOString();
  await writeFile(join(folder,'login-ui-observation.json'),JSON.stringify({observedAt:at,active:['waiting','scanned','submitting'].includes(phase),kind:'device-verification',reason:'current-device-confirmation-'+phase}),{mode:0o600});
  const file=join(folder,'login-recovery.json');let state={};try{state=JSON.parse(await readFile(file,'utf8'));}catch{}
  Object.assign(state,{checkedAt:at,phase:phase==='ready'?'ready':'device-confirmation-pending',challenge:phase==='ready'?null:'device-verification',challengeObservedAt:new Date(observed).toISOString(),challengeExpiresAt:observed+600000,nextAttemptAt:observed+600000,verificationUiActive:['waiting','scanned','submitting'].includes(phase),operatorAction:phase==='ready'?null:'complete-current-device-confirmation',qqOnline:phase==='ready',allGroupsVerified:phase==='ready'});
  await writeFile(file+'.pending',JSON.stringify(state,null,2),{mode:0o600});await rename(file+'.pending',file);
 }});
 await writeFile(join(folder,'device-resume-connection.json'),JSON.stringify({url:bridge.url,expiresAt:observed+600000}),{mode:0o600});
 console.log(JSON.stringify({deviceConfirmationReady:true,newPasswordAttempt:false,expiresAt:new Date(observed+600000).toISOString()}));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])cli().catch(()=>{console.log(JSON.stringify({deviceConfirmationReady:false,code:'CURRENT_DEVICE_RESUME_UNAVAILABLE'}));process.exitCode=1;});
