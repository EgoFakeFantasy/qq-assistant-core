import test from 'node:test';import assert from 'node:assert/strict';
import {recoverLogin} from '../../deployment/qq-login-recovery.mjs';
const botId='2888888888',passwordMd5='a'.repeat(32),offline={isLogin:false,loginPhase:'waiting_qrcode'},online={isLogin:true,coreReady:true,loginPhase:'ready'};
const base={botId,passwordMd5,sleep:async()=>{}};
test('ready login verifies the actual account and clears previous challenge without submitting a password',async()=>{
 const calls=[];const r=await recoverLogin({...base,state:{challenge:'captcha'},api:async p=>{calls.push(p);return p.endsWith('GetQQLoginInfo')?{uin:botId}:online;}});
 assert.equal(r.phase,'ready');assert.equal(r.challenge,null);assert.equal(calls.some(p=>p.includes('Password')),false);
});
test('a phone scan for a different account does not count as recovered',async()=>{
 let writes=0;const r=await recoverLogin({...base,api:async p=>p.endsWith('GetQQLoginInfo')?{uin:'2999999999'}:p.endsWith('CheckLoginStatus')?online:(writes++,{})});
 assert.equal(r.challenge,'account-mismatch');assert.equal(writes,0);
});
test('quick login uses only the configured account and avoids password fallback on success',async()=>{
 let ok=false;const calls=[];const r=await recoverLogin({...base,api:async(p,b)=>{calls.push(p);if(p.endsWith('CheckLoginStatus'))return ok?online:offline;if(p.endsWith('GetQQLoginInfo'))return{uin:botId};if(p.endsWith('GetQuickLoginListNew'))return[{uin:botId,isQuickLogin:true}];if(p.endsWith('SetQuickLogin')){assert.equal(b.uin,botId);ok=true;return null;}throw Error('UNEXPECTED_PASSWORD');}});
 assert.equal(r.lastMethod,'quick-login');assert.equal(calls.some(p=>p.includes('Password')),false);
});
test('CAPTCHA pauses automatic recovery and does not persist challenge URLs or password material',async()=>{
 let submissions=0;const saved=[];const api=async p=>p.endsWith('CheckLoginStatus')?offline:p.includes('List')?[]:(submissions++,{needCaptcha:true,proofWaterUrl:'private-url'});
 const r=await recoverLogin({...base,api,save:async s=>saved.push(s)});await recoverLogin({...base,api,state:r});
 assert.equal(submissions,1);assert.equal(r.challenge,'captcha');assert.equal(JSON.stringify(saved).includes(passwordMd5),false);assert.equal(JSON.stringify(saved).includes('private-url'),false);
});
test('failed password login backs off and initialization never triggers another login',async()=>{
 let writes=0;const api=async p=>p.endsWith('CheckLoginStatus')?offline:p.includes('List')?[]:(writes++,{result:false});
 const r=await recoverLogin({...base,api,now:()=>1000});assert.equal(r.nextAttemptAt,121000);
 await recoverLogin({...base,api,state:r,now:()=>1001});assert.equal(writes,1);
 const waiting=await recoverLogin({...base,api:async()=>({loginPhase:'initializing',isLogin:false})});assert.equal(waiting.phase,'waiting-login-service');
});
