import {mkdir,readFile,lstat,realpath,open,rename,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {syncDirectory} from '../../src/file-store.js';

// Private, bounded, crash-safe state. A pending external write is never replayed.
export async function openAutonomyStore(root,{stateFile,statusFile,initial,maxBytes=4*1024*1024}){
 root=resolve(root);await mkdir(root,{recursive:true});
 if(resolve(await realpath(root))!==root)throw Error('LINKED_BROWSE_ROOT');
 const file=join(root,stateFile),info=await lstat(file).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
 if(info&&(!info.isFile()||info.isSymbolicLink()||info.size>maxBytes))throw Error('UNSAFE_BROWSE_STATE');
 const state=info?JSON.parse(await readFile(file,'utf8')):initial();let tail=Promise.resolve();
 async function atomic(name,body){
  const target=join(root,name),before=await lstat(target).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
  if(before&&(!before.isFile()||before.isSymbolicLink()))throw Error('UNSAFE_BROWSE_STATE');
  const pending=target+'.'+randomUUID()+'.pending';let handle;
  try{handle=await open(pending,'wx',0o600);await handle.writeFile(body);await handle.sync();await handle.close();handle=null;await rename(pending,target);await syncDirectory(root);}
  finally{await handle?.close();await unlink(pending).catch(()=>{});}
 }
 return {root,state,save(status){
  const body=JSON.stringify(state),view=JSON.stringify(status);if(Buffer.byteLength(body)>maxBytes)throw Error('BROWSE_STATE_TOO_LARGE');
  const task=tail.then(async()=>{await atomic(stateFile,body);await atomic(statusFile,view);});tail=task.catch(()=>{});return task;
 }};
}
export const autonomyDay=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
export const autonomyCode=e=>/^[A-Z_0-9]+$/.test(e?.message||'')?e.message:'BROWSE_OPERATION_FAILED';
export const platformBlocked=code=>/LOGIN|VERIFICATION|RESTRICTION|BACKOFF|ACCOUNT/.test(code);
