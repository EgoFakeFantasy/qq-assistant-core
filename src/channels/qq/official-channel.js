import {createHash} from 'node:crypto';
import {MediaFileType} from '@tencent-connect/qqbot-nodejs';
import {openOfficialState} from './official-state.js';
const openid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const number=v=>typeof v==='string'&&/^\d{4,20}$/.test(v);
const allowedMedia=url=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&/(^|\.)(qq\.com|qq\.com\.cn|qpic\.cn|gtimg\.cn)$/.test(u.hostname);}catch{return false;}};

export function validateOfficialSettings(value,config){
  if(!value||!/^\d{3,32}$/.test(value.appId||'')||!Array.isArray(value.groups)||value.groups.length<1||value.groups.length>16)throw Error('OFFICIAL_CONFIG_REQUIRED');
  const aliases=new Set(),ids=new Set();
  for(const g of value.groups){if(!g||!number(g.groupId)||!config.allowedGroupIds?.includes(g.groupId)||!openid(g.openid)||!openid(g.botMemberOpenid)||aliases.has(g.groupId)||ids.has(g.openid)||g.allowProactive!==undefined&&typeof g.allowProactive!=='boolean')throw Error('OFFICIAL_GROUP_BINDING_INVALID');aliases.add(g.groupId);ids.add(g.openid);}
  if(!aliases.has(config.groupId)||(config.additionalGroups||[]).some(g=>!aliases.has(g.groupId)))throw Error('OFFICIAL_GROUP_BINDING_MISSING');
  if(config.groupId==='1000000004'&&config.replyPolicy!=='mentions-only'||(config.additionalGroups||[]).some(g=>g.groupId==='1000000004'&&g.replyPolicy!=='mentions-only'))throw Error('OFFICIAL_PROTECTED_GROUP_POLICY');
  return structuredClone(value);
}

export async function createOfficialChannel({settings,config,statePath,sdk,now=Date.now}){
  settings=validateOfficialSettings(settings,config);
  if(sdk.appId!==settings.appId)throw Error('OFFICIAL_APP_ID_MISMATCH');
  const state=await openOfficialState(statePath,settings.appId,{now});
  const groups=new Map(settings.groups.map(g=>[g.groupId,{...g}]));
  const byOpenid=new Map([...groups.values()].map(g=>[g.openid,g]));
  const cache=new Map(),refs=new Map(),files=new Map(),peers=new Map();
  let online=false,sink=null,serial=Promise.resolve(),sendTail=Promise.resolve();
  const counters={received:0,rejected:0,sends:0,failedSends:0,ingressFailures:0,connectionError:null};
  sdk.on('ready',()=>{online=true;counters.connectionError=null;});
  sdk.on('resumed',()=>{online=true;counters.connectionError=null;});
  sdk.on('disconnected',()=>{online=false;});
  sdk.on('error',()=>{counters.connectionError='OFFICIAL_CONNECTION_ERROR';});
  function scopeKey(scope,target){return scope+':'+target;}
  async function normalize(msg){
    if(!online||!sink||!['group','c2c'].includes(msg?.kind)||!['GROUP_AT_MESSAGE_CREATE','GROUP_MESSAGE_CREATE','C2C_MESSAGE_CREATE'].includes(msg.rawEventType)||typeof msg.messageId!=='string'||!msg.messageId||msg.messageId.length>128)return null;
    const isGroup=msg.kind==='group',g=isGroup?byOpenid.get(msg.groupOpenid):null;
    if(isGroup&&!g||!isGroup&&!config.privateMessages?.enabled||msg.raw?.author?.bot===true||msg.senderIsBot===true)return null;
    const sender=msg.raw?.author?.[isGroup?'member_openid':'user_openid']||msg.senderId;
    if(!openid(sender)||isGroup&&sender===g.botMemberOpenid)return null;
    const target=isGroup?g.openid:sender,scope=isGroup?'group':'c2c',key=scopeKey(scope,target);
    if(!msg.replyTarget||msg.replyTarget.scope!==scope||msg.replyTarget.targetId!==target||msg.replyTarget.msgId!==msg.messageId)return null;
    const sentAt=Date.parse(msg.timestamp);if(!Number.isFinite(sentAt)||sentAt>now()+5000||now()-sentAt>(isGroup?300000:3600000))return null;
    const userId=await state.alias(key+':member:'+sender),groupId=isGroup?g.groupId:'private:'+userId;
    const text=typeof msg.content==='string'?msg.content:'';if(text.length>65536)return null;
    // Only the CURRENT event/text mention can address self. Quoted msg_elements,
    // sender names, old refs, and @all never grant reply/persona permission.
    const selfAt=isGroup&&(msg.rawEventType==='GROUP_AT_MESSAGE_CREATE'||[...text.matchAll(/<@!?([A-Za-z0-9_-]+)>/g)].some(m=>m[1]===g.botMemberOpenid));
    const ticket={scope,target,groupId,userId,serverId:msg.messageId,msgIdx:typeof msg.msgIdx==='string'?msg.msgIdx.slice(0,256):null,directMention:selfAt,receivedAt:now(),expiresAt:sentAt+(isGroup?300000:3600000),limit:isGroup?5:4};
    const id=await state.remember(key+':'+msg.messageId,ticket),message=[];
    let cursor=0;for(const match of text.matchAll(/<@!?([A-Za-z0-9_-]+)>/g)){message.push({type:'text',data:{text:text.slice(cursor,match.index)}});const name=match[1];
      if(name==='all')message.push({type:'at',data:{qq:'all'}});
      else message.push({type:'at',data:{qq:name===g?.botMemberOpenid?config.botId:await state.alias(key+':member:'+name)}});cursor=match.index+match[0].length;}
    message.push({type:'text',data:{text:text.slice(cursor)}});
    if(selfAt&&!message.some(s=>s.type==='at'&&s.data.qq===config.botId))message.unshift({type:'at',data:{qq:config.botId}});
    let quoted=msg.refMsgIdx&&refs.get(key+':'+msg.refMsgIdx);
    const embedded=Array.isArray(msg.msgElements)?msg.msgElements[0]:null;
    if(!quoted&&msg.refMsgIdx&&typeof embedded?.content==='string'&&embedded.content.length<=16000){
      quoted=await state.alias('quote:'+key+':'+String(msg.refMsgIdx).slice(0,256));
      const quotedAuthor=embedded.author?.member_openid||embedded.author?.user_openid;
      const senderId=isGroup&&quotedAuthor===g.botMemberOpenid?config.botId:await state.alias(key+':member:'+(openid(quotedAuthor)?quotedAuthor:'unknown-quote-author'));
      cache.set(quoted,{groupId,senderId,text:embedded.content,images:[],files:[]});refs.set(key+':'+msg.refMsgIdx,quoted);
    }
    if(quoted)message.unshift({type:'reply',data:{id:quoted}});
    const attachments=(msg.attachments||[]).filter(a=>allowedMedia(a.url)).slice(0,5),media={images:[],files:[]};
    for(let i=0;i<attachments.length;i++){const a=attachments[i];if(/^image\//.test(a.content_type)&&media.images.length<3){media.images.push({url:a.url,file:''});message.push({type:'image',data:{url:a.url,file:''}});}
      else if(a.content_type==='file'&&isGroup&&files.size<1000){const fileId=id+':'+i;const file={fileId,name:String(a.filename||'attachment').slice(0,240),size:Number(a.size)||0,folder:'received-attachments',url:a.url,groupId};files.set(fileId,file);media.files.push({fileId,name:file.name});message.push({type:'file',data:{file_id:fileId,name:file.name,size:file.size}});}}
    cache.set(id,{groupId,senderId:userId,text:text.replace(/<@!?[^>]+>/g,'').trim(),...media});
    if(msg.msgIdx)refs.set(key+':'+msg.msgIdx,id);
    while(cache.size>2000)cache.delete(cache.keys().next().value);while(refs.size>4000)refs.delete(refs.keys().next().value);
    if(!isGroup)peers.set(userId,{target,observedAt:now()});
    counters.received++;return {post_type:'message',message_type:isGroup?'group':'private',...(isGroup?{group_id:groupId}:{sub_type:'friend'}),self_id:config.botId,user_id:userId,message_id:id,time:sentAt/1000,sender:{user_id:userId,nickname:String(msg.senderName||'').slice(0,80),is_robot:false},message};
  }
  async function receive(msg){const p=await normalize(msg);if(!p){counters.rejected++;return {status:'ignored'};}return sink(p);}
  sdk.on('message',(_ctx,msg)=>{const task=serial.then(()=>receive(msg));serial=task.catch(()=>{counters.ingressFailures++;});return task;});
  const capabilities={text:true,images:true,receivedAttachments:true,quotedMessages:'received-cache-only',groupFileListing:'received-attachments-only',historicalFetch:false,forwardCards:false,serverReadback:false};
  function transport({groupId,userId,replyPolicy='adaptive',allowProactive=false}){
    if(groupId==='1000000004')replyPolicy='mentions-only';
    const isPrivate=Boolean(userId),g=groups.get(groupId);
    if(!isPrivate&&!g)throw Error('OFFICIAL_GROUP_NOT_BOUND');
    const expected=isPrivate?'private:'+userId:groupId;
    const diagnostics={provider:'qq-official',identityNamespace:'qq-official:'+settings.appId,logicalBotId:config.botId,legacyGroupAlias:!isPrivate?groupId:null,internalAliasesAreQqNumbers:false,capabilities,online:false,memberOfGroup:false,sends:0,failedSends:0,checkedAt:null,lastDeliveryMode:null};
    async function check(){diagnostics.checkedAt=new Date(now()).toISOString();diagnostics.online=online;
      if(isPrivate){const peer=peers.get(userId);return {online,accountMatches:online,friend:false,peerAuthorized:online&&Boolean(peer)&&now()-peer.observedAt<3600000,authorizationKind:'official-c2c-event'};}
      diagnostics.memberOfGroup=false;diagnostics.membershipEvidence='unverified';
      if(online)try{const b=await sdk.api.get('/v2/groups/'+encodeURIComponent(g.openid)+'/bot_state');
        if(b.member_openid!==g.botMemberOpenid)throw Error('OFFICIAL_BOT_MEMBER_MISMATCH');
        diagnostics.memberOfGroup=true;diagnostics.membershipEvidence='official-bot-state';diagnostics.receiveAll=b.recv_msg_setting==='all';diagnostics.proactiveAllowed=b.allow_proactive_msg===true;
      }catch(e){if(e.message==='OFFICIAL_BOT_MEMBER_MISMATCH')throw e;diagnostics.proactiveAllowed=false;diagnostics.receiveAll=null;diagnostics.membershipEvidence='bot-state-unavailable';}
      return {online,accountMatches:online,memberOfGroup:diagnostics.memberOfGroup,receiveAll:diagnostics.receiveAll,proactiveAllowed:diagnostics.proactiveAllowed};
    }
    async function perform(message,proactive=false){
      if(message.groupId!==expected||!online||typeof message.text!=='string'||!message.text.trim())throw Error('OFFICIAL_SEND_SCOPE');
      const {formatQQReply}=await import('../../../profiles/set-theory/response-format.mjs');
      const {oneBotImageSegments}=await import('../../../profiles/set-theory/onebot-client.mjs');
      const text=formatQQReply(message.text),imageSegments=await oneBotImageSegments(message.images||[]);
      if(text.length>200000)throw Error('OFFICIAL_TEXT_TOO_LARGE');
      let ticket=proactive?null:state.ticket(String(message.replyTo));
      if(!proactive&&(!ticket||ticket.groupId!==expected||ticket.scope!==(isPrivate?'c2c':'group')))throw Error('OFFICIAL_REPLY_SCOPE');
      if(!isPrivate&&replyPolicy==='mentions-only'&&(proactive||!ticket?.directMention))throw Error('MENTION_REQUIRED');
      if(proactive){await check();if(isPrivate||!allowProactive||!g.allowProactive||!diagnostics.proactiveAllowed||!diagnostics.memberOfGroup)throw Error('OFFICIAL_PROACTIVE_DISABLED');}
      const target={scope:isPrivate?'c2c':'group',targetId:ticket?.target||g.openid,...(ticket?{msgId:ticket.serverId}:{})};
      const parts=[];for(let i=0;i<text.length;i+=1200)parts.push(text.slice(i,i+1200));
      // Preserve the full long answer as a file instead of truncating or flooding.
      const fileMode=parts.length>2;const count=(fileMode?2:parts.length)+imageSegments.length;
      const writeKey=createHash('sha256').update(expected+':'+String(message.replyTo)+':'+text+':'+imageSegments.map(s=>s.data.file).join()).digest('hex');
      if(ticket)ticket=await state.reserve(String(message.replyTo),count,writeKey);
      const ids=[];
      try{
        // SDK convenience sendImage/sendFile return {upload,message}, and their
        // automatic msg_seq is process-local. Upload without sending, then use
        // the durable reservation's sequence for EVERY explicit message POST.
        let sequence=ticket?ticket.used-count+1:1;
        const sendPart=async body=>{
          if(ticket&&now()>ticket.expiresAt)throw Error('OFFICIAL_REPLY_EXPIRED');
          const result=await sdk.send({target,...body,extra:{msg_seq:sequence++}});
          if(!result?.id)throw Error('OFFICIAL_RECEIPT_MISSING');ids.push(result.id);return result;
        };
        const sendMedia=async(fileType,buffer,fileName)=>{
          const upload=await sdk.uploadMedia({target,fileType,buffer,...(fileName?{fileName}:{}),srvSendMsg:false});
          if(typeof upload?.file_info!=='string'||!upload.file_info)throw Error('OFFICIAL_UPLOAD_RECEIPT_MISSING');
          return sendPart({msgType:7,media:{file_info:upload.file_info}});
        };
        const first=await sendPart({msgType:0,content:fileMode?text.slice(0,1000)+'\n完整回答见附件。':parts[0],...(ticket?.msgIdx?{messageReference:{message_id:ticket.msgIdx}}:{})});
        if(fileMode)await sendMedia(MediaFileType.FILE,Buffer.from(text,'utf8'),'answer.txt');
        else for(const part of parts.slice(1))await sendPart({msgType:0,content:part});
        for(const image of imageSegments)await sendMedia(MediaFileType.IMAGE,Buffer.from(image.data.file.slice(9),'base64'));
        const localId=await state.alias('message:'+scopeKey(target.scope,target.targetId)+':'+first.id);
        cache.set(localId,{groupId:expected,senderId:config.botId,text,images:[],files:[]});
        if(first.ext_info?.ref_idx)refs.set(scopeKey(target.scope,target.targetId)+':'+first.ext_info.ref_idx,localId);
        diagnostics.sends+=ids.length;counters.sends+=ids.length;diagnostics.lastDeliveryMode=fileMode?'official-file':'official-inline';
        return {ok:true,messageId:String(first.id),messageIds:ids.map(String),verified:false,deliveryMode:diagnostics.lastDeliveryMode,verification:'platform-accepted-no-readback'};
      }catch(e){diagnostics.failedSends++;counters.failedSends++;const error=Error('OFFICIAL_DELIVERY_UNCERTAIN');error.code='OFFICIAL_DELIVERY_UNCERTAIN';error.partialMessageIds=ids.map(String);throw error;}
    }
    function send(message,proactive){const task=sendTail.then(()=>perform(message,proactive));sendTail=task.catch(()=>{});return task;}
    return {kind:'live',diagnostics,capabilities,check,
      replyTimeRemaining(id){const t=state.ticket(String(id));return t?.groupId===expected?Math.max(0,t.expiresAt-now()-10000):0;},
      send:m=>send(m,false),sendProactive:m=>send(m,true),
      async listJoinedGroups(){const result=[];for(const binding of groups.values()){try{const state=await sdk.api.get('/v2/groups/'+encodeURIComponent(binding.openid)+'/bot_state');if(online&&state.member_openid===binding.botMemberOpenid)result.push({groupId:binding.groupId,name:binding.name||binding.groupId});}catch{}}return result;},
      async listGroupFiles(){return [...files.values()].filter(f=>f.groupId===expected).map(({url,...f})=>({...f}));},
      async groupFileUrl(id){const f=files.get(id);if(!f||f.groupId!==expected)throw Error('OFFICIAL_ATTACHMENT_NOT_RECEIVED');return {file:{fileId:f.fileId,name:f.name,size:f.size},url:f.url};},
      async messageMedia(id){const c=cache.get(String(id));if(!c||c.groupId!==expected)return {images:[],files:[]};return structuredClone({images:c.images,files:c.files});},
      async imageUrl(ref){if(!allowedMedia(ref?.url))throw Error('OFFICIAL_IMAGE_HOST_DENIED');return ref.url;},
      async readQuote({groupId:requested,messageId}){const c=cache.get(String(messageId));return requested===expected&&c?.groupId===expected?{messageId:String(messageId),senderId:c.senderId,text:c.text}:null;}
    };
  }
  return {transport,bindIngress(fn){if(sink||typeof fn!=='function')throw Error('OFFICIAL_INGRESS_ALREADY_BOUND');sink=fn;},
    async authorizePrivate(userId){const p=peers.get(userId);return online&&Boolean(p)&&now()-p.observedAt<3600000;},
    get diagnostics(){return {...counters,online,...state.diagnostics,capabilities};},
    async start(signal){if(!sink)throw Error('OFFICIAL_INGRESS_NOT_BOUND');try{await sdk.start(signal);}finally{online=false;}},
    async close(){sdk.stop();online=false;await serial;await sendTail;}
  };
}
