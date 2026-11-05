import {runInNewContext} from 'node:vm';
import {request as httpRequest} from 'node:http';
import test from 'node:test';import assert from 'node:assert/strict';import {createCaptchaResume,captchaParameters} from './qq-captcha-resume.mjs';
const proof='https://ti.qq.com/safe/tools/captcha/sms-verify-login?aid=2081081773&sid=fixture&uin=2000000002';
test('current challenge validates Tencent origin and bot account',()=>{assert.equal(captchaParameters(proof).sid,'fixture');assert.throws(()=>captchaParameters(proof.replace('ti.qq.com','evil.test')));assert.throws(()=>captchaParameters(proof.replace('2000000002','12345678')));});
test('resume only submits valid current captcha once, never exposes credentials',async()=>{let calls=0;const server=await createCaptchaResume({proofWaterUrl:proof,expiresAt:Date.now()+60000,submit:async v=>{calls++;assert.deepEqual(v,{ticket:'valid-test-ticket',randstr:'fixture-rand',sid:'fixture'});return {accepted:true,online:true};}});try{const page=await(await fetch(server.url)).text();assert(!page.includes('passwordMd5'));assert(page.includes('TencentCaptcha'));assert(page.includes('https://captcha.gtimg.com/TCaptcha.js'));assert(page.includes('type:"full"'));assert(!page.includes('type:"popup"'));const options={method:'POST',headers:{origin:server.origin,'content-type':'application/json'},body:JSON.stringify({ret:0,ticket:'valid-test-ticket',randstr:'fixture-rand'})};assert.equal((await(await fetch(server.url+'/submit',options)).json()).online,true);assert.equal((await fetch(server.url+'/submit',options)).status,409);assert.equal(calls,1);}finally{await server.close();}});
test('foreign origin, forged host, missing nonce and fake SDK success do not submit',async()=>{let calls=0;const server=await createCaptchaResume({proofWaterUrl:proof,expiresAt:Date.now()+60000,submit:async()=>{calls++;return {};}});try{assert.equal((await fetch(server.origin+'/resume/wrong')).status,404);assert.equal(await new Promise((resolve,reject)=>{const req=httpRequest(server.url,{headers:{host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();}),403);const headers={origin:'https://evil.test','content-type':'application/json'};assert.equal((await fetch(server.url+'/submit',{method:'POST',headers,body:'{}'})).status,403);headers.origin=server.origin;for(const value of [{ret:0,errorCode:1001,ticket:'valid',randstr:'r'},{ret:0,ticket:'terror_1001_x',randstr:'r'},{ret:2,ticket:'valid',randstr:'r'}])assert.equal((await fetch(server.url+'/submit',{method:'POST',headers,body:JSON.stringify(value)})).status,400);assert.equal(calls,0);}finally{await server.close();}});
test('expired current verification is not replayed',async()=>{let now=Date.now(),calls=0;const server=await createCaptchaResume({proofWaterUrl:proof,expiresAt:now+60000,now:()=>now,submit:async()=>{calls++;return {};}});try{now+=60001;assert.equal((await fetch(server.url)).status,410);assert.equal(calls,0);}finally{await server.close();}});
test('uncertain submission fails closed and cannot be automatically retried',async()=>{let calls=0;const server=await createCaptchaResume({proofWaterUrl:proof,expiresAt:Date.now()+60000,submit:async()=>{calls++;throw Error('fixture');}});try{const options={method:'POST',headers:{origin:server.origin,'content-type':'application/json'},body:JSON.stringify({ret:0,ticket:'valid',randstr:'r'})};assert.equal((await fetch(server.url+'/submit',options)).status,502);assert.equal((await fetch(server.url+'/submit',options)).status,409);assert.equal(calls,1);}finally{await server.close();}});


test('page blocks a captcha result that arrives after its login request expired',async()=>{
 const expiresAt=Date.now()+60000;let clock=expiresAt-50000,sdkCalls=0,posts=0,callback,tick;
 const server=await createCaptchaResume({proofWaterUrl:proof,expiresAt,submit:async()=>{throw Error('must not submit');}});
 try{
  const html=await(await fetch(server.url)).text(),source=html.match(/<script>([\s\S]*)<\/script>/)[1];
  const elements={status:{textContent:''},start:{disabled:false},deadline:{textContent:''}};
  runInNewContext(source,{document:{getElementById:id=>elements[id]},Date:{now:()=>clock},setInterval:fn=>{tick=fn;},TencentCaptcha:function(_aid,cb){sdkCalls++;callback=cb;this.show=()=>{};},fetch:async()=>{posts++;throw Error('expired callback must not post');}});
  elements.start.onclick();assert.equal(sdkCalls,1);
  clock=expiresAt+1;await callback({ret:0,ticket:'fixture-ticket',randstr:'fixture'});tick();
  assert.equal(posts,0);assert.match(elements.status.textContent,/已过期/);assert.equal(elements.start.disabled,true);
  elements.start.onclick();assert.equal(sdkCalls,1);
 }finally{await server.close();}
});

test('page reports server expiry distinctly from a rejected login',async()=>{
 const expiresAt=Date.now()+60000;let callback,posts=0;
 const server=await createCaptchaResume({proofWaterUrl:proof,expiresAt,submit:async()=>({})});
 try{
  const html=await(await fetch(server.url)).text(),source=html.match(/<script>([\s\S]*)<\/script>/)[1];
  const elements={status:{textContent:''},start:{disabled:false},deadline:{textContent:''}};
  runInNewContext(source,{document:{getElementById:id=>elements[id]},Date:{now:()=>expiresAt-1000},setInterval:()=>{},TencentCaptcha:function(_aid,cb){callback=cb;this.show=()=>{};},location:{pathname:'/resume/fixture'},fetch:async()=>{posts++;return{json:async()=>({error:'CHALLENGE_EXPIRED'})};}});
  elements.start.onclick();await callback({ret:0,ticket:'fixture-ticket',randstr:'fixture'});
  assert.equal(posts,1);assert.match(elements.status.textContent,/已过期/);assert.doesNotMatch(elements.status.textContent,/未获接受/);
 }finally{await server.close();}
});

test('challenge account binding accepts a configured non-example account and rejects a mismatch',()=>{const u='https://ti.qq.com/safe/tools/captcha/sms-verify-login?sid=fixture&uin=2888888888';assert.equal(captchaParameters(u,'2888888888').uin,'2888888888');assert.throws(()=>captchaParameters(u,'2999999999'),/ACCOUNT/);});
