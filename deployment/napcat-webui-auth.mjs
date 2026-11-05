import {readFile,lstat,readdir,open} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';

// Management tokens are local WebUI credentials, never Tencent challenges.
export function extractStartupWebuiTokens(text) {
 const tokens=[];
 const clean=String(text).replace(/\x1b\[[0-9;]*m/g,'');
 for(const line of clean.split(/\r?\n/)) {
  const match=line.match(/^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+\[(?:info|warn)\]\s+\[NapCat\]\s+\[WebUi\]\s+WebUi Token:\s*(\S{8,4096})\s*$/i);
  if(match)tokens.push(match[1]);
 }
 return [...new Set(tokens.reverse())];
}

async function readStartupLog(path,size) {
 const file=await open(path,'r');
 try {
  const head=Buffer.alloc(Math.min(size,131072));
  const tail=Buffer.alloc(Math.min(Math.max(0,size-head.length),524288));
  await file.read(head,0,head.length,0);
  if(tail.length)await file.read(tail,0,tail.length,size-tail.length);
  return head.toString('utf8')+'\n'+tail.toString('utf8');
 }finally{await file.close();}
}

export async function findStartupWebuiTokens({root,list=readdir,stat=lstat,readLog=readStartupLog}) {
 const folder=join(root,'private','supervision');
 let entries;
 try{const dir=await stat(folder);if(!dir.isDirectory()||dir.isSymbolicLink())return [];entries=await list(folder,{withFileTypes:true});}catch{return [];}
 const candidates=[];
 for(const entry of entries) {
  if(!entry.isFile()||!/^qq-\d{8}-\d{6}-\d{3}\.stdout\.log$/.test(entry.name))continue;
  const path=join(folder,basename(entry.name));
  try{const s=await stat(path);if(s.isFile()&&!s.isSymbolicLink()&&s.size>0)candidates.push({path,size:s.size,time:s.mtimeMs});}catch{}
 }
 candidates.sort((a,b)=>b.time-a.time);
 const found=[];
 for(const candidate of candidates.slice(0,2)) {
  try{found.push(...extractStartupWebuiTokens(await readLog(candidate.path,candidate.size)));}catch{}
 }
 return [...new Set(found)].slice(0,3);
}

export async function authenticateWebui({runtime,root,fetchFn=fetch,readConfig=readFile,stat=lstat,discoverTokens=findStartupWebuiTokens}){
 const base='http://127.0.0.1:6099/api';
 const candidates=[];
 const add=(token,tokenSource)=>{
  if(typeof token==='string'&&token.length>=1&&token.length<=4096&&!candidates.some(c=>c.token===token))candidates.push({token,tokenSource});
 };
 for(const token of (await discoverTokens({root}).catch(()=>[])).slice(0,1))add(token,'startup-log');
 const configPath=runtime.napcatWebuiConfigPath||join(runtime.napcatEntryPath?dirname(runtime.napcatEntryPath):join(root,'napcat-node'),'napcat','config','webui.json');
 try{const s=await stat(configPath);if(s.isFile()&&!s.isSymbolicLink()&&s.size<=65536)add(JSON.parse(await readConfig(configPath,'utf8')).token,'napcat-config');}catch{}
 add(runtime.webuiToken,'saved-config');
 if(!candidates.length)throw Error('WEBUI_TOKEN_UNAVAILABLE');
 for(const {token,tokenSource} of candidates.slice(0,3)) {
  let response;
  try{response=await fetchFn(base+'/auth/login',{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({hash:createHash('sha256').update(token+'.napcat').digest('hex')}),signal:AbortSignal.timeout(6000)});}catch{throw Error('WEBUI_UNAVAILABLE');}
  if(response.status===429)throw Error('WEBUI_AUTH_BACKOFF');
  if(response.status===401||response.status===403)continue;
  if(!response.ok)throw Error('WEBUI_UNAVAILABLE');
  let result;try{result=await response.json();}catch{throw Error('WEBUI_INVALID_RESPONSE');}
  const credential=result.code===0?(result.data?.Credential||result.data?.credential):null;
  if(credential)return {base,credential,tokenSource};
 }
 throw Error('WEBUI_AUTH_FAILED');
}
