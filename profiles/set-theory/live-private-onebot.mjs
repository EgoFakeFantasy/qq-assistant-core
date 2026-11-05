import {createOneBotCaller,oneBotImageSegments} from './onebot-client.mjs';
import {formatQQReply} from './response-format.mjs';
import {planReply,makeReplyNodes,normalizeReplyPresentation,forwardReference,parseForwardRecords,forwardReplyText} from './reply-layout.mjs';
const valid=id=>typeof id==='string'&&/^\d{4,20}$/.test(id)&&Number.isSafeInteger(Number(id));
const messageId=id=>/^-?\d{1,20}$/.test(String(id))&&Number.isSafeInteger(Number(id));
export function createPrivatePeerAuthorizer(options){
 const call=createOneBotCaller(options);
 return async userId=>{
  if(!valid(userId)||userId===options.botId)return false;
  const status=await call('get_status');if(status?.online!==true)return false;
  const login=await call('get_login_info');if(String(login?.user_id)!==options.botId)return false;
  const friends=await call('get_friend_list');
  return Array.isArray(friends)&&friends.some(f=>String(f.user_id)===userId);
 };
}
export function createLivePrivateOneBot({userId,botId,replyPresentation,...options}){
 if(!valid(userId)||!valid(botId)||userId===botId)throw Error('INVALID_PRIVATE_PEER');
 const call=createOneBotCaller(options),authorize=createPrivatePeerAuthorizer({...options,botId});
 const scope='private:'+userId,presentation=normalizeReplyPresentation(replyPresentation);
 const diagnostics={scopeType:'private',online:false,friend:false,sends:0,failedSends:0,readbacks:0,quoteReads:0,quoteMisses:0,replyPresentation:presentation};
 function inPeer(m){
  if(m?.message_type!=='private'||m.group_id!=null&&String(m.group_id)!=='0')return false;
  const author=String(m.sender?.user_id??m.user_id??'');
  if(author===userId)return true;
  if(author!==botId)return false;
  const destinations=[m.target_id,m.peer_id,m.recipient_id].filter(id=>id!=null).map(String);
  return destinations.length?destinations.every(id=>id===userId):String(m.user_id)===userId;
 }
 const textOf=m=>Array.isArray(m?.message)?m.message.filter(s=>s.type==='text').map(s=>String(s.data?.text||'')).join(''):'';
 async function check(){
  diagnostics.friend=await authorize(userId);diagnostics.online=diagnostics.friend;diagnostics.checkedAt=new Date().toISOString();
  return {...diagnostics};
 }
 return {kind:'live',diagnostics,check,async readQuote({groupId,messageId:id}){
  if(groupId!==scope||!messageId(id))return null;
  try{
   const m=await call('get_msg',{message_id:Number(id)});if(!inPeer(m)||m.message_id!=null&&String(m.message_id)!==String(id))throw Error('ONEBOT_PRIVATE_SCOPE');
   let text=textOf(m);
   if(forwardReference(m)&&String(m.sender?.user_id)===botId)text=forwardReplyText(parseForwardRecords(await call('get_forward_msg',{message_id:forwardReference(m)}),botId));
   if(!text)return null;diagnostics.quoteReads++;return {messageId:String(id),senderId:String(m.sender?.user_id||m.user_id),text:text.slice(0,16000)};
  }catch{diagnostics.quoteMisses++;return null;}
 },async send(message){
  if(message.groupId!==scope||!messageId(message.replyTo))throw Error('ONEBOT_PRIVATE_SCOPE');
  const original=await call('get_msg',{message_id:Number(message.replyTo)});
  if(!inPeer(original)||String(original.sender?.user_id??original.user_id)!==userId||original.message_id!=null&&String(original.message_id)!==String(message.replyTo))throw Error('ONEBOT_PRIVATE_SCOPE');
  const health=await check();if(!health.friend)throw Error('PRIVATE_FRIEND_REQUIRED');
  const text=formatQQReply(message.text);if(!text)throw Error('EMPTY_PLAIN_TEXT');
  const plan=planReply(text,presentation),images=await oneBotImageSegments(message.images||[]);
  try{
   let sent,nodes;
   if(plan.mode==='forward'){
    nodes=makeReplyNodes({plan,botId,nickname:'阿序',replyTo:message.replyTo,question:formatQQReply(message.question||''),images});
    sent=await call('send_private_forward_msg',{user_id:Number(userId),messages:nodes},18000);
   }else sent=await call('send_private_msg',{user_id:Number(userId),message:[{type:'reply',data:{id:String(message.replyTo)}},{type:'text',data:{text}},...images]},18000);
   if(!messageId(sent?.message_id))throw Error('MISSING_DELIVERY_RECEIPT');
   diagnostics.sends++;const id=String(sent.message_id);let verified=false,reference=null;
   try{
    const parent=await call('get_msg',{message_id:Number(id)},3000);
    if(inPeer(parent)&&String(parent.sender?.user_id??parent.user_id)===botId){
     if(nodes){
      reference=forwardReference(parent);
      if(reference){const rows=parseForwardRecords(await call('get_forward_msg',{message_id:reference},3000),botId);verified=rows.length===nodes.length&&rows.every((row,i)=>row.text===textOf({message:nodes[i].data.content})&&row.images.length===nodes[i].data.content.filter(s=>s.type==='image').length)&&forwardReplyText(rows)===text;}
     }else verified=textOf(parent)===text&&parent.message.filter(s=>s.type==='image').length===images.length;
    }
   }catch{}
   if(verified)diagnostics.readbacks++;
   return {ok:true,messageId:id,verified,deliveryMode:plan.mode, ...(nodes?{forwardId:reference,nodeCount:nodes.length}:{})};
  }catch(e){diagnostics.failedSends++;throw e;}
 }};
}
