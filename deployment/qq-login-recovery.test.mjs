import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverLogin,makeWebuiApi,recoveryLabel,serializeRecoveryOutput} from './qq-login-recovery.mjs';
const secret='a'.repeat(32), start=1800000000000;
const offline={isLogin:false,loginPhase:'waiting_qrcode'};
const ready={isLogin:true,coreReady:true,loginPhase:'ready'};
const actualReady={qqOnline:true,accountMatches:true,allGroupsVerified:true};
test('machine output survives hidden PowerShell code pages without losing Chinese status text',()=>{
 const value={phase:'platform-security-check',status:'腾讯安全检查待续 (・ω・)'};
 const wire=serializeRecoveryOutput(value);assert.ok(/^[\x00-\x7f]*$/.test(wire));assert.deepEqual(JSON.parse(wire),value);
});
function fixture({clock=start,result=null,quick=[],initialStatus=offline,initialOnline=false}={}) {
 let online=initialOnline,now=clock;
 const calls=[],saved=[];
 const options={passwordMd5:secret,now:()=>now,sleep:async()=>{},save:async state=>saved.push(structuredClone(state)),verifyOnline:async()=>online?actualReady:null,
  api:async(path,body)=>{calls.push({path,body});if(path.endsWith('CheckLoginStatus'))return online?ready:initialStatus;if(path.endsWith('GetQuickLoginListNew'))return quick;
   if(path.endsWith('SetQuickLogin')){online=true;return null;}
   if(path.endsWith('PasswordLogin')){if(result===null)online=true;return result;}
   throw Error('unexpected endpoint');}};
 return {options,calls,saved,setTime:n=>{now=n;},setOnline:n=>{online=n;},writes:()=>calls.filter(x=>/\/(?:PasswordLogin|SetQuickLogin)$/.test(x.path))};
}

test('actual OneBot account and all groups already online clear old pauses without password',async()=>{
 const f=fixture({initialOnline:true});const r=await recoverLogin({...f.options,state:{challenge:'captcha',phase:'human-verification-required'}});
 assert.equal(r.phase,'ready');assert.equal(r.challenge,null);assert.equal(f.writes().length,0);
});
test('WebUI success alone never claims ready',async()=>{
 const f=fixture({initialStatus:ready});const r=await recoverLogin(f.options);assert.equal(r.phase,'onebot-verification-pending');assert.equal(f.writes().length,0);
});
test('quick login is preferred only for the expected eligible account',async()=>{
 const f=fixture({quick:[{uin:'2000000002',isQuickLogin:true}]});const r=await recoverLogin(f.options);
 assert.equal(r.phase,'ready');assert.equal(r.lastMethod,'quick-login');assert.deepEqual(f.writes().map(x=>x.path),['/QQLogin/SetQuickLogin']);
});
test('another saved account cannot replace the bot and protected password is not persisted',async()=>{
 const f=fixture({quick:[{uin:'11111',isQuickLogin:true}]});const r=await recoverLogin(f.options);
 assert.equal(r.lastMethod,'password');assert.equal(f.writes()[0].body.uin,'2000000002');assert.equal(f.writes()[0].body.passwordMd5,secret);
 assert.equal(JSON.stringify(f.saved).includes(secret),false);
});
test('captcha and device responses get specific bounded states without storing challenge secrets',async()=>{
 for(const device of [false,true]) {
  const f=fixture({result:{[device?'needNewDevice':'needCaptcha']:true,proofWaterUrl:'private-link',newDevicePullQrCodeSig:'private-sig'}});
  const r=await recoverLogin(f.options);
  assert.equal(r.phase,device?'device-confirmation-pending':'platform-security-check');assert.equal(r.challengeExpiresAt,start+600000);
  assert.equal(r.operatorAction,device?'complete-current-device-confirmation':null);
  assert.equal(JSON.stringify(f.saved).includes('private-'),false);
  assert.ok(!recoveryLabel(r.phase).includes('人工'));
 }
});
test('a legacy challenge expires based on its occurrence, not repeatedly refreshed checkedAt',async()=>{
 const f=fixture();const r=await recoverLogin({...f.options,state:{phase:'human-verification-required',challenge:'captcha',lastAttemptAt:new Date(start-1800000).toISOString(),checkedAt:new Date(start).toISOString()}});
 assert.equal(r.phase,'ready');assert.equal(f.writes().length,1);assert.ok(r.staleChallengeClearedAt);
});
test('an undated historical challenge does not create an indefinite pause',async()=>{
 const f=fixture();const r=await recoverLogin({...f.options,state:{challenge:'captcha'}});assert.equal(r.phase,'ready');assert.equal(f.writes().length,1);
});
test('a fresh server challenge waits without creating another login',async()=>{
 const f=fixture();const r=await recoverLogin({...f.options,state:{schemaVersion:2,challenge:'captcha',challengeObservedAt:new Date(start-30000).toISOString()}});
 assert.equal(r.phase,'platform-security-check');assert.equal(f.writes().length,0);assert.equal(r.challengeExpiresAt,start+570000);
});
test('fresh active UI observation protects a verification even with force and an old stored challenge',async()=>{
 const f=fixture();const r=await recoverLogin({...f.options,force:true,state:{challenge:'captcha',lastAttemptAt:new Date(start-3600000).toISOString()},observeVerification:async()=>({active:true,kind:'captcha',observedAt:new Date(start).toISOString()})});
 assert.equal(r.phase,'platform-security-check');assert.equal(f.writes().length,0);
});
test('ended UI verification clears stale marker while preserving actual retry backoff',async()=>{
 const f=fixture();const r=await recoverLogin({...f.options,state:{challenge:'captcha',verificationUiActive:false,lastInteractiveResult:'verification-returned-without-login',lastInteractiveAttemptAt:new Date(start-1000).toISOString(),nextAttemptAt:start+50000}});
 assert.equal(r.phase,'retry-backoff');assert.equal(r.challenge,null);assert.equal(f.writes().length,0);
});
test('force cannot bypass backoff or five attempts in the rolling hour',async()=>{
 for(const state of [{nextAttemptAt:start+10000},{schemaVersion:2,attemptHistory:[start-5000,start-4000,start-3000,start-2000,start-1000]}]) {
  const f=fixture();const r=await recoverLogin({...f.options,state,force:true});assert.equal(f.writes().length,0);assert.ok(['retry-backoff','recovery-cooldown'].includes(r.phase));
 }
});
test('rolling rate cap automatically becomes eligible after old attempts leave the window',async()=>{
 const f=fixture();let r=await recoverLogin({...f.options,state:{schemaVersion:2,attemptHistory:[start-5000,start-4000,start-3000,start-2000,start-1000]}});
 assert.equal(r.phase,'recovery-cooldown');f.setTime(start+3600001);r=await recoverLogin({...f.options,state:r});assert.equal(r.phase,'ready');assert.equal(f.writes().length,1);
});
test('five legacy failures cool down once rather than permanently requiring review',async()=>{
 const f=fixture();let r=await recoverLogin({...f.options,state:{consecutiveFailures:5}});assert.equal(r.phase,'recovery-cooldown');
 f.setTime(start+3600001);r=await recoverLogin({...f.options,state:r});assert.equal(r.phase,'ready');
});
test('migration preserves the known recent attempt even when it first returns during backoff',async()=>{
 const f=fixture();let r=await recoverLogin({...f.options,state:{lastAttemptAt:new Date(start-1000).toISOString(),nextAttemptAt:start+60000}});
 assert.deepEqual(r.attemptHistory,[start-1000]);f.setTime(start+60001);r=await recoverLogin({...f.options,state:r});assert.equal(r.phase,'ready');assert.equal(r.attemptHistory.length,2);
});
test('an old failure counter with a known expired time cannot create a new permanent pause',async()=>{
 const f=fixture();const r=await recoverLogin({...f.options,state:{consecutiveFailures:5,lastAttemptAt:new Date(start-7200000).toISOString()}});assert.equal(r.phase,'ready');assert.equal(f.writes().length,1);
});
test('password rejection uses persistent exponential backoff',async()=>{
 const f=fixture({result:{result:false}});let r=await recoverLogin(f.options);assert.equal(r.nextAttemptAt,start+120000);
 f.setTime(start+1000);r=await recoverLogin({...f.options,state:r});assert.equal(r.phase,'retry-backoff');assert.equal(f.writes().length,1);
 f.setTime(start+120001);r=await recoverLogin({...f.options,state:r});assert.equal(r.nextAttemptAt,start+360001);assert.equal(f.writes().length,2);
});
test('initializing, reconnecting and scanned QR never restart an in-progress login',async()=>{
 for(const loginPhase of ['initializing','reconnecting','qrcode_scanned']) {
  const f=fixture({initialStatus:{isLogin:false,loginPhase}});const r=await recoverLogin(f.options);assert.equal(r.phase,'waiting-login-service');assert.equal(f.writes().length,0);
 }
});
test('an existing wrong account stops before password or quick-login operations',async()=>{
 const f=fixture();const r=await recoverLogin({...f.options,verifyOnline:async()=>({accountMismatch:true})});assert.equal(r.phase,'account-mismatch');assert.equal(f.writes().length,0);
});
test('panel credentials refresh once after definite auth rejection and retry only that request',async()=>{
 const credentials=[];let renew=0;
 const api=makeWebuiApi({base:'http://127.0.0.1:6099/api',credential:'old',refreshAuthentication:async()=>{renew++;return {credential:'new'};},fetchFn:async(_url,options)=>{credentials.push(options.headers.authorization);return credentials.length===1?new Response(JSON.stringify({code:-1,message:'Unauthorized'})):new Response(JSON.stringify({code:0,data:{isLogin:false}}));}});
 assert.deepEqual(await api('/QQLogin/CheckLoginStatus'),{isLogin:false});assert.equal(renew,1);assert.deepEqual(credentials,['Bearer old','Bearer new']);
});
test('auth rejection never loops, and non-auth operation failure is never replayed',async()=>{
 for(const auth of [false,true]) {
  let calls=0,renews=0;
  const api=makeWebuiApi({base:'http://127.0.0.1:6099/api',credential:'secret-fixture',refreshAuthentication:async()=>{renews++;return{credential:'new'};},fetchFn:async()=>{calls++;return new Response(JSON.stringify({code:-1,message:auth?'Unauthorized':'private server payload'}),{status:auth?401:200});}});
  await assert.rejects(api('/QQLogin/PasswordLogin',{passwordMd5:secret}),/^Error: WEBUI_OPERATION_FAILED$/);assert.equal(calls,auth?2:1);assert.equal(renews,auth?1:0);
 }
});
