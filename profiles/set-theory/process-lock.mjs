import {open,readFile,unlink,lstat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

// Local PID locks, not distributed leases. A reused PID or EPERM is considered
// live conservatively. Never delete an invalid, linked, or replaced lock.
export async function acquireProcessLock(path,{probe=pid=>process.kill(pid,0),busyCode='PROCESS_ALREADY_RUNNING'}={}){
 const record=JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),owner:randomUUID()});
 async function snapshot(file){
  const stat=await lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2048)throw Error('INVALID_PROCESS_LOCK');
  const raw=await readFile(file,'utf8');let data;
  try{data=JSON.parse(raw);}catch{throw Error('INVALID_PROCESS_LOCK');}
  const pid=typeof data==='number'?data:data?.pid;
  if(!Number.isSafeInteger(pid)||pid<1)throw Error('INVALID_PROCESS_LOCK');
  return {raw,stat,pid};
 }
 async function removeDead(file){
  const old=await snapshot(file);let dead=false;
  try{probe(old.pid);}catch(e){if(e.code==='ESRCH')dead=true;else if(e.code!=='EPERM')throw e;}
  if(!dead)throw Error(busyCode);
  const current=await lstat(file);
  if(current.ino!==old.stat.ino||current.mtimeMs!==old.stat.mtimeMs||await readFile(file,'utf8')!==old.raw)throw Error(busyCode);
  await unlink(file);
 }
 async function create(file){
  const handle=await open(file,'wx',0o600);
  try{await handle.writeFile(record);await handle.sync();}finally{await handle.close();}
 }
 async function release(file){
  try{const stat=await lstat(file);if(stat.isFile()&&!stat.isSymbolicLink()&&await readFile(file,'utf8')===record)await unlink(file);}
  catch(e){if(e.code!=='ENOENT')throw e;}
 }
 for(let attempt=0;attempt<4;attempt++){
  try{
   await create(path);let released=false;
   return {async release(){if(!released){released=true;await release(path);}}};
  }catch(e){if(e.code!=='EEXIST')throw e;}
  // Serialise normal stale reclamations; recover this short-lived guard after
  // a crashed reclaimer as well. An active guard is never overridden.
  const guard=path+'.reclaim';let held=false;
  try{
   try{await create(guard);held=true;}catch(e){if(e.code!=='EEXIST')throw e;await removeDead(guard);continue;}
   await removeDead(path);
  }catch(e){if(e.code!=='ENOENT')throw e;}
  finally{if(held)await release(guard);}
 }
 throw Error(busyCode);
}
