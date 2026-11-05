import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {extractStartupWebuiTokens,findStartupWebuiTokens,authenticateWebui} from './napcat-webui-auth.mjs';
const line=token=>`10-17 14:40:34 [\x1b[32minfo\x1b[39m] [NapCat] [WebUi] WebUi Token: ${token}`;
const fileStat={isFile:()=>true,isSymbolicLink:()=>false,size:100};
const missing=async()=>{throw Error('missing');};
const body=data=>new Response(JSON.stringify(data));
test('extract only anchored startup records, strip ANSI, prefer latest and deduplicate',()=>{
 const text=[line('token-one'), 'message user: [WebUi] WebUi Token: untrusted-token',line('token-two'),line('token-two'),'WebUi Token: not-a-startup-record'].join('\n');
 assert.deepEqual(extractStartupWebuiTokens(text),['token-two','token-one']);
});
test('startup discovery is limited to latest owned stdout logs and ignores symlinks/unrelated logs',async()=>{
 const names=['qq-20261017-033958-314.stdout.log','qq-20261016-012345-001.stdout.log','qq-20261015-012345-001.stdout.log','hub-20261017-033958-314.stdout.log','qq-20261017-033958-314.stderr.log'];
 const reads=[];
 const tokens=await findStartupWebuiTokens({root:'C:/fixture',list:async()=>names.map(name=>({name,isFile:()=>true})),stat:async path=>String(path).endsWith('supervision')?{isDirectory:()=>true,isSymbolicLink:()=>false}:{...fileStat,mtimeMs:String(path).includes('20261017')?3:String(path).includes('20261016')?2:1},readLog:async path=>{reads.push(String(path));return line(String(path).includes('20261017')?'latest-token':'older-token');}});
 assert.deepEqual(tokens,['latest-token','older-token']);assert.equal(reads.length,2);assert.ok(reads.every(x=>!x.includes('hub-')&&!x.includes('stderr')));
 const rejected=await findStartupWebuiTokens({root:'C:/fixture',stat:async()=>({isDirectory:()=>true,isSymbolicLink:()=>true}),list:async()=>{throw Error('must not list a symlink');}});assert.deepEqual(rejected,[]);
});
test('a startup-log token authenticates automatically and credentials are not logged',async()=>{
 let calls=0;
 const auth=await authenticateWebui({runtime:{webuiToken:'stale-saved'},root:'C:/fixture',discoverTokens:async()=>['live-token'],stat:missing,fetchFn:async(url,options)=>{
  calls++;assert.equal(url,'http://127.0.0.1:6099/api/auth/login');assert.equal(JSON.parse(options.body).hash,createHash('sha256').update('live-token.napcat').digest('hex'));
  return body({code:0,data:{Credential:'fixture-session'}});
 }});assert.equal(calls,1);assert.equal(auth.tokenSource,'startup-log');assert.equal(auth.credential,'fixture-session');assert.equal('token' in auth,false);
});
test('an outdated log cannot exclude the current NapCat configuration token',async()=>{
 let calls=0;
 const auth=await authenticateWebui({runtime:{webuiToken:'old-saved'},root:'C:/fixture',discoverTokens:async()=>['old-log-a','old-log-b','old-log-c'],stat:async()=>fileStat,readConfig:async()=>JSON.stringify({token:'current-config'}),fetchFn:async()=>{
  calls++;return calls===1?new Response('{}',{status:401}):body({code:0,data:{Credential:'config-session'}});
 }});assert.equal(calls,2);assert.equal(auth.tokenSource,'napcat-config');
});
test('saved configuration remains a fallback when logs and live config are unavailable',async()=>{
 const auth=await authenticateWebui({runtime:{webuiToken:'saved-token'},root:'C:/fixture',discoverTokens:async()=>[],stat:missing,fetchFn:async()=>body({code:0,data:{credential:'session'}})});
 assert.equal(auth.tokenSource,'saved-config');
});
test('auth throttling stops immediately without token guessing loops',async()=>{
 let calls=0;
 await assert.rejects(authenticateWebui({runtime:{webuiToken:'saved-token'},root:'C:/fixture',discoverTokens:async()=>['log-token'],stat:missing,fetchFn:async()=>{calls++;return new Response('{}',{status:429});}}),/^Error: WEBUI_AUTH_BACKOFF$/);
 assert.equal(calls,1);
});
test('no available management token reports a precise local error rather than a Tencent challenge',async()=>{
 await assert.rejects(authenticateWebui({runtime:{},root:'C:/fixture',discoverTokens:async()=>[],stat:missing}),/^Error: WEBUI_TOKEN_UNAVAILABLE$/);
});
