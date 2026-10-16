import test from 'node:test';
import assert from 'node:assert/strict';
import {authenticateWebui} from '../../deployment/napcat-webui-auth.mjs';
const good=()=>new Response(JSON.stringify({code:0,data:{Credential:'fixture-session'}}));
const bad=()=>new Response(JSON.stringify({code:-1}));
test('valid saved panel token needs no filesystem access or user input',async()=>{
 const result=await authenticateWebui({runtime:{webuiToken:'fixture-old'},root:'/fixture',fetchFn:async()=>good(),readConfig:async()=>{throw Error('unexpected read');}});
 assert.equal(result.credential,'fixture-session');assert.equal(result.tokenSource,'saved-config');
});
test('a rotated panel token is recovered locally without echoing or persisting it',async()=>{
 let n=0;const result=await authenticateWebui({runtime:{webuiToken:'fixture-old',napcatEntryPath:'/fixture/index.js'},root:'/fixture',stat:async()=>({isFile:()=>true,isSymbolicLink:()=>false,size:100}),readConfig:async()=>JSON.stringify({token:'fixture-new'}),fetchFn:async(url,opt)=>{assert.equal(url,'http://127.0.0.1:6099/api/auth/login');assert.equal(opt.redirect,'error');assert(!opt.body.includes('fixture-new'));return n++?good():bad();}});
 assert.equal(result.tokenSource,'napcat-config');assert(!JSON.stringify(result).includes('fixture-new'));assert.equal(n,2);
});
test('network faults do not trigger local token guessing or repeated auth attempts',async()=>{
 let reads=0;await assert.rejects(authenticateWebui({runtime:{webuiToken:'fixture-old'},root:'/fixture',fetchFn:async()=>{throw Error('network');},readConfig:async()=>{reads++;}}),/network/);assert.equal(reads,0);
});
test('symlinked or oversized token files are refused before reading',async()=>{
 for(const info of [{link:true,size:100},{link:false,size:70000}]){let read=false;await assert.rejects(authenticateWebui({runtime:{webuiToken:'fixture-old'},root:'/fixture',fetchFn:async()=>bad(),stat:async()=>({isFile:()=>true,isSymbolicLink:()=>info.link,size:info.size}),readConfig:async()=>{read=true;}}),/TOKEN_UNAVAILABLE/);assert.equal(read,false);}
});

test('an expired management session reported as HTTP 401 can refresh once',async()=>{
 let n=0;const result=await authenticateWebui({runtime:{webuiToken:'fixture-old'},root:'/fixture',stat:async()=>({isFile:()=>true,isSymbolicLink:()=>false,size:100}),readConfig:async()=>JSON.stringify({token:'fixture-new'}),fetchFn:async()=>n++?good():new Response('',{status:401})});assert.equal(result.tokenSource,'napcat-config');assert.equal(n,2);
});
