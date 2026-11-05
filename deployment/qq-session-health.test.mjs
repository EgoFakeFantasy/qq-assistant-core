import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyQqSession,REQUIRED_GROUPS} from './qq-session-health.mjs';
function fixture({online=true,account='2000000002',groups=REQUIRED_GROUPS,statusUnavailable=false,groupUnavailable=false}={}) {
 return {oneBotBase:'http://127.0.0.1:3000/',oneBotToken:'fixture',fetchFn:async(url)=>{
  const action=new URL(url).pathname.slice(1);
  if(action==='get_status'&&statusUnavailable)throw Error('offline');
  if(action==='get_group_list'&&groupUnavailable)throw Error('not ready');
  const data=action==='get_status'?{online}:action==='get_login_info'?{user_id:account}:groups.map(group_id=>({group_id}));
  return new Response(JSON.stringify({status:'ok',data}));
 }};
}
test('identity alone does not prove an online QQ session',async()=>{
 const r=await verifyQqSession(fixture({online:false}));assert.equal(r.oneBotReachable,true);assert.equal(r.accountMatches,true);assert.equal(r.qqOnline,false);assert.equal(r.allGroupsVerified,false);
});
test('a different logged-in account is never accepted as the bot',async()=>{
 const r=await verifyQqSession(fixture({account:'111111'}));assert.equal(r.accountMismatch,true);assert.equal(r.qqOnline,false);
});
test('all four original groups must be freshly verified',async()=>{
 const r=await verifyQqSession(fixture());assert.equal(r.qqOnline,true);assert.equal(r.allGroupsVerified,true);assert.equal(r.groups.length,4);
});
test('a missing protected group blocks complete restoration without changing membership',async()=>{
 const r=await verifyQqSession(fixture({groups:REQUIRED_GROUPS.slice(0,3)}));assert.equal(r.qqOnline,true);assert.equal(r.allGroupsVerified,false);assert.equal(r.groups[3].memberOfGroup,false);
});
test('missing online status or unavailable group list cannot produce a false ready result',async()=>{
 const missingStatus=await verifyQqSession(fixture({statusUnavailable:true}));assert.equal(missingStatus.qqOnline,false);
 const missingGroups=await verifyQqSession(fixture({groupUnavailable:true}));assert.equal(missingGroups.qqOnline,true);assert.equal(missingGroups.allGroupsVerified,false);
});
