import {mkdir, readFile, writeFile, rename, lstat, realpath} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';

// Numeric values are INTERNAL compatibility aliases, never QQ numbers. AppID and
// conversation namespace form the identity key. No old member-memory auto-binding.
export async function openOfficialState(path, appId, {now=Date.now}={}) {
  path=resolve(path); const folder=dirname(path);
  await mkdir(folder,{recursive:true,mode:0o700});
  if(resolve(await realpath(folder))!==folder)throw Error('OFFICIAL_STATE_LINK');
  let state={version:1,appId,next:800000000000000,identities:[],tickets:[],writes:[]};
  try {
    const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink()||st.size>32*1024*1024)throw Error('OFFICIAL_STATE_INVALID');
    state=JSON.parse(await readFile(path,'utf8'));
  } catch(e) {if(e.code!=='ENOENT')throw e;}
  if(state.version!==1||state.appId!==appId||!Number.isSafeInteger(state.next)||state.next<800000000000000||state.next>=900000000000000||
     !Array.isArray(state.identities)||!Array.isArray(state.tickets)||!Array.isArray(state.writes)||state.identities.length>100000||state.tickets.length>10000||state.writes.length>20000)throw Error('OFFICIAL_STATE_INVALID');
  const identities=new Map(state.identities), tickets=new Map(state.tickets), writes=new Set(state.writes);
  const aliases=new Set();for(const [key,id] of identities){if(typeof key!=='string'||typeof id!=='string'||!/^8\d{14}$/.test(id)||aliases.has(id)||Number(id)>=state.next)throw Error('OFFICIAL_STATE_INVALID');aliases.add(id);}
  let tail=Promise.resolve(),faulted=false;
  function mutate(fn){const task=tail.then(async()=>{if(faulted)throw Error('OFFICIAL_STATE_FAULTED');const value=fn();
    try{state.identities=[...identities];state.tickets=[...tickets];state.writes=[...writes];await writeFile(path+'.tmp',JSON.stringify(state),{mode:0o600});await rename(path+'.tmp',path);}catch(e){faulted=true;throw e;}return value;});tail=task.catch(()=>{});return task;}
  function id(key){if(identities.has(key))return identities.get(key);if(identities.size>=100000||state.next>=900000000000000)throw Error('OFFICIAL_IDENTITY_LIMIT');const v=String(state.next++);identities.set(key,v);return v;}
  return {
    async alias(key){return mutate(()=>id(key));},
    lookup(key){return identities.get(key)||null;},
    ticket(id){const t=tickets.get(id);return t?structuredClone(t):null;},
    async remember(key,ticket){return mutate(()=>{const messageId=id('message:'+key);if(!tickets.has(messageId))tickets.set(messageId,{...ticket,used:0});
      for(const [k,t] of tickets)if(now()-t.receivedAt>86400000)tickets.delete(k);
      while(tickets.size>10000)tickets.delete(tickets.keys().next().value);return messageId;});},
    async reserve(messageId,count,writeKey){return mutate(()=>{const t=tickets.get(messageId);
      if(!t||now()>t.expiresAt)throw Error('OFFICIAL_REPLY_EXPIRED');
      if(writes.has(writeKey))throw Error('OFFICIAL_WRITE_ALREADY_ATTEMPTED');
      if(t.used+count>t.limit)throw Error('OFFICIAL_REPLY_LIMIT');
      if(writes.size>=20000)throw Error('OFFICIAL_WRITE_LEDGER_LIMIT');
      t.used+=count;writes.add(writeKey);return structuredClone(t);});},
    get diagnostics(){return {identityNamespace:'qq-official:'+appId,internalAliasesAreQqNumbers:false,identities:identities.size,tickets:tickets.size,storageFaulted:faulted};}
  };
}
