import {mkdir,readdir,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {TeachingBot} from './teaching-bot.mjs';
import {LongTermMemory} from './long-term-memory.mjs';
import {LocalDurableState} from './local-durable-state.mjs';
import {PERSONA_VERSION} from './persona.mjs';
export function normalizePrivateMessages(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['enabled','maxConversations'].includes(k))||value.enabled!==undefined&&typeof value.enabled!=='boolean')throw Error('INVALID_PRIVATE_MESSAGES');
 const max=value.maxConversations??64;if(!Number.isInteger(max)||max<1||max>128)throw Error('INVALID_PRIVATE_MESSAGES');
 return {enabled:value.enabled===true,maxConversations:max};
}
export async function createPrivateScopes({config,runtimeRoot,authorize,createAdapters,authorizationKind='onebot-friend',onScope=()=>{}}){
 const settings=normalizePrivateMessages(config.privateMessages),scopes=new Map();
 if(!settings.enabled)return {diagnostics:{enabled:false,conversations:0},async ingest(){return {status:'ignored'};}};
 if(typeof authorize!=='function'||typeof createAdapters!=='function')throw Error('PRIVATE_ADAPTERS_REQUIRED');
 const root=resolve(runtimeRoot,'private-conversations');await mkdir(root,{recursive:true,mode:0o700});
 if(resolve(await realpath(root))!==root)throw Error('LINKED_PRIVATE_ROOT');
 const saved=(await readdir(root)).filter(s=>/^\d{4,20}$/.test(s));
 if(saved.length>settings.maxConversations)throw Error('PRIVATE_CONVERSATION_LIMIT');
 const known=new Set(saved),opening=new Map();let refreshing=null,cursor=0;
 function openPeer(userId){
  if(scopes.has(userId))return Promise.resolve(scopes.get(userId));
  if(opening.has(userId))return opening.get(userId);
  const pending=initializePeer(userId).finally(()=>opening.delete(userId));opening.set(userId,pending);return pending;
 }
 async function initializePeer(userId){
  const directory=join(root,userId);await mkdir(directory,{recursive:true,mode:0o700});
  known.add(userId);
  if((await lstat(directory)).isSymbolicLink()||resolve(await realpath(directory))!==directory)throw Error('LINKED_PRIVATE_PEER');
  const scopeId='private:'+userId;
  // Typed namespace prevents collisions with groups, even if QQ IDs are equal.
  const scopedConfig={...config,scopeType:'private',userId,groupId:scopeId,replyPolicy:'adaptive',perGroupConcurrency:1,secondaryPersona:{...config.secondaryPersona,enabled:false,canary:null,activationMode:'mentioned-name'},autonomousPublicSearch:false,autonomousGroupTextbookImport:false};
  const adapters=await createAdapters({userId,runtimeRoot:directory,config:scopedConfig});
  if(!adapters?.knowledge||adapters.resources||adapters.groupLibrary)throw Error('PRIVATE_GROUP_RESOURCES_DENIED');
  const memory=await LongTermMemory.open(join(directory,'long-term-memory'),{groupId:scopeId,botId:config.botId,personaVersion:PERSONA_VERSION});
  const bot=await TeachingBot.open({...adapters,config:scopedConfig,memory,runtimeRoot:join(directory,'turns'),store:new LocalDurableState(join(directory,'state'),{groupId:scopeId,botId:config.botId})});
  const scope={...adapters,config:scopedConfig,bot};scopes.set(userId,scope);known.add(userId);onScope(scope);return scope;
 }
 async function refresh(){
  if(refreshing)return refreshing;
  refreshing=(async()=>{const pending=[...known].filter(id=>!scopes.has(id));if(!pending.length)return;const batch=Array.from({length:Math.min(4,pending.length)},(_,i)=>pending[(cursor+i)%pending.length]);cursor+=batch.length;
   for(const userId of batch){let approved=false;try{approved=await authorize(userId);}catch{continue;}if(approved)await openPeer(userId);}
  })().finally(()=>refreshing=null);return refreshing;
 }
 await refresh();
 return {refresh,get diagnostics(){return {enabled:true,conversations:scopes.size,waitingForFriendVerification:known.size-scopes.size,storedConversations:known.size,maxConversations:settings.maxConversations,friendOnly:authorizationKind==='onebot-friend',authorizationKind,groupResourcesEnabled:false};},async ingest(payload){
  const userId=String(payload?.user_id||'');
  if(payload?.post_type!=='message'||payload.message_type!=='private'||payload.sub_type!=='friend'||payload.group_id!=null&&String(payload.group_id)!=='0'||String(payload.self_id)!==config.botId||!/^\d{4,20}$/.test(userId)||userId===config.botId||payload.message_id==null||String(payload.message_id).length>128||payload.sender?.is_robot===true)return {status:'ignored'};
  if(!await authorize(userId))return {status:'ignored'};
  if(!known.has(userId)&&known.size>=settings.maxConversations)return {status:'private_capacity'};
  const scope=scopes.get(userId)||await openPeer(userId);
  return scope.bot.ingest(payload);
 }};
}
