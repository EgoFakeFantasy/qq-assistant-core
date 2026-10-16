import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformAccounts} from './platform-accounts.mjs';
import {createAccountPanel} from './account-panel.mjs';
const uid='4000000004';
function setup(responses){const saved=new Map(),calls=[];let time=5000;const vault={get:async n=>saved.get(n)||null,set:async(n,v)=>saved.set(n,v)};
const api=createPlatformAccounts({vault,expectedUid:uid,enableZhihu:true,now:()=>time,fetchFn:async(u,o)=>{calls.push({u:String(u),o});const value=responses.shift();if(value instanceof Response)return value;return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});}});
return{api,saved,calls,advance:()=>{time+=3000;}};}
test('missing authorization refuses network and no write methods exposed',async()=>{const s=setup([]);await assert.rejects(s.api.searchBilibili('集合论'),/LOGIN_REQUIRED/);await assert.rejects(s.api.searchZhihu('集合论'),/AUTHORIZATION_REQUIRED/);assert.equal(s.calls.length,0);assert.equal(s.api.sendMessage,undefined);});
test('QR login checks account, stores session via vault, polling throttles',async()=>{
 const h=new Headers({'content-type':'application/json'});h.append('set-cookie','SESSDATA=fixture-session; HttpOnly');h.append('set-cookie','DedeUserID='+uid+'; Path=/');
 const s=setup([{code:0,data:{url:'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=fixture',qrcode_key:'fixture'}},new Response(JSON.stringify({code:0,data:{code:0}}),{headers:h})]);
 await s.api.startBilibili();assert.equal((await s.api.pollBilibili()).phase,'connected');assert.equal(s.saved.get('bilibili').uid,uid);assert.match(s.saved.get('bilibili').cookies,/fixture-session/);
});
test('QR code for another account never persists credentials',async()=>{
 const h=new Headers();h.append('set-cookie','SESSDATA=fixture; Path=/');h.append('set-cookie','DedeUserID=12345; Path=/');
 const s=setup([{code:0,data:{url:'https://passport.bilibili.com/scan',qrcode_key:'fixture'}},new Response(JSON.stringify({code:0,data:{code:0}}),{headers:h})]);
 await s.api.startBilibili();await assert.rejects(s.api.pollBilibili(),/WRONG_BILIBILI_ACCOUNT/);assert.equal(s.saved.size,0);
});
test('untrusted QR origin refused and remote errors redacted',async()=>{const s=setup([{code:0,data:{url:'https://evil.test/',qrcode_key:'fixture'}}]);await assert.rejects(s.api.startBilibili(),/UNTRUSTED/);const a=setup([new Response('private provider detail',{status:403})]);a.saved.set('bilibili',{uid,cookies:'fixture'});await assert.rejects(a.api.searchBilibili('集合论'),/^Error: PLATFORM_LOGIN_OR_RATE_LIMIT$/);});
test('Zhihu secret passed only in auth header to official origin',async()=>{const s=setup([{data:[{title:'测试',url:'https://www.zhihu.com/question/1',excerpt:'公开片段'}]}]);await s.api.setZhihu('fixture-secret-0123456789');const r=await s.api.searchZhihu('集合论');assert.equal(r.sources.length,1);assert.equal(s.calls[0].o.headers.authorization,'Bearer fixture-secret-0123456789');assert.ok(!s.calls[0].u.includes('fixture-secret'));assert.equal((await s.api.status()).zhihu.configured,true);assert.ok(!JSON.stringify(await s.api.status()).includes('fixture-secret'));});
test('account panel requires local token, does not expose secrets or allow cross-origin writes',async()=>{
 const a=createAccountPanel({accounts:{status:async()=>({readOnly:true})},token:'x'.repeat(64),toQR:async()=>'',port:3798});await a.listen();
 try{assert.equal((await fetch('http://127.0.0.1:3798/api/status')).status,403);assert.equal((await fetch('http://127.0.0.1:3798/api/status',{headers:{authorization:'Bearer '+'x'.repeat(64)}})).status,200);assert.equal((await fetch('http://127.0.0.1:3798/api/status',{headers:{authorization:'Bearer '+'x'.repeat(64),origin:'https://evil.test'}})).status,403);const html=await(await fetch('http://127.0.0.1:3798/')).text();assert.ok(!html.includes('x'.repeat(64)));}finally{await a.close();}
});


test('production default disables Zhihu without fetching or saving credentials',async()=>{
 let fetched=0,saved=0;const api=createPlatformAccounts({vault:{get:async()=>null,set:async()=>{saved++;}},fetchFn:async()=>{fetched++;throw Error('UNEXPECTED_NETWORK');}});
 await assert.rejects(api.setZhihu('fixture-secret-0123456789'),/ZHIHU_DISABLED/);
 await assert.rejects(api.searchZhihu('集合论'),/ZHIHU_DISABLED/);
 assert.equal((await api.status()).zhihu.enabled,false);assert.equal(fetched,0);assert.equal(saved,0);
});
