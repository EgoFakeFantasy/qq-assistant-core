export const BOT_ACCOUNT='2000000002';
export const REQUIRED_GROUPS=['1000000001','1000000002','1000000003','1000000004'];

export async function verifyQqSession({oneBotBase,oneBotToken,fetchFn=fetch,botId=BOT_ACCOUNT,groupIds=REQUIRED_GROUPS}) {
 const result={oneBotReachable:false,qqOnline:false,accountMatches:false,memberOfGroup:false,allGroupsVerified:false,groups:groupIds.map(groupId=>({groupId,online:false,memberOfGroup:false}))};
 const post=async action=>{
  const r=await fetchFn(new URL(action,oneBotBase.endsWith('/')?oneBotBase:oneBotBase+'/'),{method:'POST',redirect:'error',headers:{authorization:'Bearer '+oneBotToken,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(4000)});
  if(!r.ok)throw Error('ONEBOT_UNAVAILABLE');
  const body=await r.json();if(body.status!=='ok')throw Error('ONEBOT_OPERATION_FAILED');return body.data;
 };
 const checks=await Promise.allSettled([post('get_login_info'),post('get_status')]);
 const login=checks[0].status==='fulfilled'?checks[0].value:null;
 const status=checks[1].status==='fulfilled'?checks[1].value:null;
 result.oneBotReachable=checks.some(x=>x.status==='fulfilled');
 result.accountMatches=String(login?.user_id)===botId;
 result.qqOnline=result.accountMatches&&status?.online===true;
 result.accountMismatch=Boolean(login?.user_id)&&!result.accountMatches;
 if(!result.qqOnline)return result;
 let groups;try{groups=await post('get_group_list');}catch{return result;}
 if(!Array.isArray(groups))return result;
 const joined=new Set(groups.map(g=>String(g.group_id)));
 result.groups=groupIds.map(groupId=>({groupId,online:true,memberOfGroup:joined.has(groupId)}));
 result.memberOfGroup=joined.has(groupIds[0]);
 result.allGroupsVerified=result.groups.every(g=>g.memberOfGroup);
 return result;
}
