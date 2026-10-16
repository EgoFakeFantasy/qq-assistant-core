import {readFile,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
// WebUI tokens are local management secrets, not Tencent human challenges.
export async function authenticateWebui({runtime,root,fetchFn=fetch,readConfig=readFile,stat=lstat}){
 const base='http://127.0.0.1:6099/api';
 async function attempt(token){
  if(typeof token!=='string'||!token||token.length>4096)return null;
  const r=await fetchFn(base+'/auth/login',{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({hash:createHash('sha256').update(token+'.napcat').digest('hex')}),signal:AbortSignal.timeout(6000)});
  if(r.status===401||r.status===403)return null;if(!r.ok)throw Error('WEBUI_UNAVAILABLE');const a=await r.json();
  return a.code===0?(a.data?.Credential||a.data?.credential||null):null;
 }
 const saved=await attempt(runtime.webuiToken);if(saved)return {base,credential:saved,tokenSource:'saved-config'};
 const path=runtime.napcatWebuiConfigPath||join(runtime.napcatEntryPath?dirname(runtime.napcatEntryPath):join(root,'napcat-node'),'napcat','config','webui.json');
 let token;try{const s=await stat(path);if(!s.isFile()||s.isSymbolicLink()||s.size>65536)throw Error('UNSAFE_WEBUI_CONFIG');token=JSON.parse(await readConfig(path,'utf8')).token;}catch{throw Error('WEBUI_TOKEN_UNAVAILABLE');}
 if(token===runtime.webuiToken)throw Error('WEBUI_AUTH_FAILED');const fresh=await attempt(token);if(!fresh)throw Error('WEBUI_AUTH_FAILED');
 return {base,credential:fresh,tokenSource:'napcat-config'};
}
