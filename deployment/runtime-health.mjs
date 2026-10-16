import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const at=process.argv.indexOf('--config');
const configPath=at<0?fileURLToPath(new URL('../private/live-config.json',import.meta.url)):resolve(process.argv[at+1]);
const c=JSON.parse(await readFile(configPath,'utf8'));
const p=JSON.parse(await readFile(c.profilePath,'utf8'));
const state={hubReachable:false,oneBotReachable:false,webuiReachable:false,qqOnline:false,allGroupsVerified:false,hubScopesReady:false,requiresPhoneLogin:null,busy:false,groups:[]};
const json=async(url,options={})=>{const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error('SERVICE_UNAVAILABLE');return r.json();};
await Promise.all([
 (async()=>{try{const h=await json('http://127.0.0.1:'+c.hubPort+'/api/maintenance',{headers:{authorization:'Bearer '+c.hubToken}});state.hubReachable=h.profile==='set-theory';state.busy=h.active>0||h.queued>0||h.workers?.activeBackground>0;state.hubScopesReady=p.allowedGroupIds.every(id=>h.groups?.some(g=>g.groupId===id&&g.transport?.online&&g.transport?.memberOfGroup));}catch{}})(),
 (async()=>{try{const call=action=>json(c.oneBotBase.replace(/\/$/,'')+'/'+action,{method:'POST',headers:{authorization:'Bearer '+c.oneBotToken,'content-type':'application/json'},body:'{}'});const [a,b,g]=await Promise.all(['get_login_info','get_status','get_group_list'].map(call));state.oneBotReachable=[a,b,g].every(x=>x.status==='ok');state.qqOnline=state.oneBotReachable&&String(a.data?.user_id)===p.botId&&b.data?.online===true;state.groups=p.allowedGroupIds.map(groupId=>({groupId,online:state.qqOnline,memberOfGroup:state.qqOnline&&g.data.some(x=>String(x.group_id)===groupId)}));state.allGroupsVerified=state.groups.every(x=>x.memberOfGroup);}catch{}})(),
 (async()=>{try{const base='http://127.0.0.1:6099/api';const a=await json(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({hash:createHash('sha256').update(c.webuiToken+'.napcat').digest('hex')})});const credential=a.data?.Credential||a.data?.credential;if(!credential)return;const s=await json(base+'/QQLogin/CheckLoginStatus',{method:'POST',headers:{authorization:'Bearer '+credential,'content-type':'application/json'},body:'{}'});state.webuiReachable=s.code===0;state.loginPhase=s.data?.loginPhase;state.requiresPhoneLogin=!s.data?.isLogin;}catch{}})()
]);
console.log(JSON.stringify(state));
