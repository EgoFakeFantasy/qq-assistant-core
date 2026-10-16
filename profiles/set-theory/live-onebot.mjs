import {readFile} from 'node:fs/promises';
import {formatQQReply} from './response-format.mjs';
export function createLiveOneBot({ baseUrl, token, groupId, botId, allowProactive = false, fetchFn = fetch }) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
      || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('LOOPBACK_ONEBOT_REQUIRED');
  if (typeof token !== 'string' || token.length < 24) throw new Error('ONEBOT_TOKEN_REQUIRED');
  const diagnostics = { online: false, memberOfGroup: false, sends: 0, failedSends: 0, checkedAt: null, quoteReads:0, quoteMisses:0 };
  async function call(action, params = {}, timeoutMs=2500) {
    const response = await fetchFn(new URL(action, base), { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(params), signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    if (!response.ok) throw new Error('ONEBOT_HTTP_ERROR');
    const body = await response.json();
    if (body.retcode !== 0 || body.status !== 'ok') throw new Error('ONEBOT_ACTION_ERROR');
    return body.data;
  }
  async function check() {
    try {
      const login = await call('get_login_info');
      if (String(login.user_id) !== botId) throw new Error('WRONG_BOT_ACCOUNT');
      const groups = await call('get_group_list');
      diagnostics.online = true; diagnostics.memberOfGroup = groups.some(g => String(g.group_id) === groupId);
      diagnostics.checkedAt = new Date().toISOString(); return { ...diagnostics };
    } catch (error) { diagnostics.online = false; diagnostics.memberOfGroup = false; throw error; }
  }
async function imageSegments(images){if(!Array.isArray(images)||images.length>2)throw new Error('IMAGE_SEND_LIMIT');return Promise.all(images.map(async image=>{if(!image||typeof image.path!=='string')throw new Error('INVALID_OUTGOING_IMAGE');const bytes=await readFile(image.path);if(bytes.length>8*1024*1024||!(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes[0]===255&&bytes[1]===216))throw new Error('INVALID_OUTGOING_IMAGE');return {type:'image',data:{file:'base64://'+bytes.toString('base64')}};}));}
  let fileCache=null;
  async function listGroupFiles({refresh=false}={}){
    await check();if(!diagnostics.memberOfGroup)throw new Error('BOT_NOT_IN_GROUP');
    if(!refresh&&fileCache&&Date.now()-fileCache.time<60000)return fileCache.value;
    const files=[];const seen=new Set();const folders=[{id:null,path:''}];let visited=0;const started=Date.now();
    while(folders.length){if(Date.now()-started>60000)throw new Error('GROUP_DIRECTORY_TIMEOUT');if(++visited>200)throw new Error('GROUP_DIRECTORY_LIMIT');const folder=folders.shift();if(seen.has(folder.id))continue;seen.add(folder.id);
      const body=await call(folder.id?'get_group_files_by_folder':'get_group_root_files',{group_id:Number(groupId),...(folder.id?{folder_id:folder.id}: {})},15000);
      for(const f of body.files||[]){if(f.group_id!=null&&String(f.group_id)!==groupId)throw new Error('ONEBOT_SCOPE');if(typeof f.file_id!=='string'||!f.file_id||f.file_id.length>200)continue;files.push({fileId:f.file_id,name:String(f.file_name||'').slice(0,500),folder:folder.path,size:Number(f.file_size||f.size||0),busid:Number(f.busid||0),modified:f.modify_time||f.upload_time||null});if(files.length>10000)throw new Error('GROUP_FILE_LIMIT');}
      for(const f of body.folders||[])if(typeof f.folder_id==='string')folders.push({id:f.folder_id,path:(folder.path+'/'+String(f.folder_name||'')).slice(0,1000)});
    }
    const value=[...new Map(files.map(f=>[f.fileId,f])).values()];fileCache={time:Date.now(),value};diagnostics.groupFilesListed=value.length;return value;
  }
  async function groupFileUrl(fileId){const f=(await listGroupFiles()).find(f=>f.fileId===fileId);if(!f)throw new Error('UNKNOWN_GROUP_FILE');const data=await call('get_group_file_url',{group_id:Number(groupId),file_id:f.fileId,busid:f.busid},20000);if(typeof data?.url!=='string')throw new Error('GROUP_FILE_URL_MISSING');return {file:f,url:data.url};}
  async function messageMedia(messageId){if(!/^-?\d{1,20}$/.test(String(messageId)))return {images:[],files:[]};const m=await call('get_msg',{message_id:Number(messageId)},12000);if(m.message_type!=='group'||String(m.group_id)!==groupId)throw new Error('ONEBOT_SCOPE');return {images:(m.message||[]).filter(s=>s.type==='image').map(s=>({file:String(s.data?.file||''),url:String(s.data?.url||'')})).slice(0,3),files:(m.message||[]).filter(s=>s.type==='file').map(s=>({fileId:String(s.data?.file_id||s.data?.id||''),name:String(s.data?.name||'')})).slice(0,2)};}
  async function imageUrl(ref){if(ref.url){const u=new URL(ref.url);if(['https:','http:'].includes(u.protocol)&&/(?:^|\.)(?:qq\.com|qpic\.cn|gtimg\.cn)$/.test(u.hostname))return u.href;}if(!/^[A-Za-z0-9_.-]{1,180}$/.test(ref.file||''))throw new Error('INVALID_IMAGE_REFERENCE');const data=await call('get_image',{file:ref.file},15000);const u=new URL(data.url||'');if(!['https:','http:'].includes(u.protocol))throw new Error('IMAGE_URL_MISSING');return u.href;}
  return { kind: 'live', diagnostics, check, async sendProactive(message){
    if(!allowProactive||message.groupId!==groupId||typeof message.text!=='string'||message.text.length>1800)throw Error('PROACTIVE_GROUP_SCOPE');
    const text=formatQQReply(message.text);if(!text)throw Error('EMPTY_PLAIN_TEXT');await check();if(!diagnostics.memberOfGroup)throw Error('BOT_NOT_IN_GROUP');
    const sent=await call('send_group_msg',{group_id:Number(groupId),message:[{type:'text',data:{text}}]},25000);
    if(sent?.message_id==null)throw Error('MISSING_DELIVERY_RECEIPT');diagnostics.sends++;
    const id=String(sent.message_id);let verified=false;
    try{const readback=await call('get_msg',{message_id:Number(id)},10000);verified=readback.message_type==='group'&&String(readback.group_id)===groupId&&String(readback.sender?.user_id||readback.user_id)===botId&&readback.message.filter(s=>s.type==='text').map(s=>String(s.data?.text||'')).join('')===text;}catch{}
    return {ok:true,messageId:id,verified};
  },async listJoinedGroups(){const login=await call('get_login_info');if(String(login.user_id)!==botId)throw Error('WRONG_BOT_ACCOUNT');const groups=await call('get_group_list');return groups.filter(g=>/^\d{4,20}$/.test(String(g.group_id))&&typeof g.group_name==='string').map(g=>({groupId:String(g.group_id),name:g.group_name}));},listGroupFiles,groupFileUrl,messageMedia,imageUrl, async readQuote({groupId:requestedGroup,messageId}){
    if(requestedGroup!==groupId||!(/^-?\d{1,20}$/).test(messageId)||!Number.isSafeInteger(Number(messageId)))return null;
    try{
      const message=await call('get_msg',{message_id:Number(messageId)});
      if(message.message_type!=='group'||String(message.group_id)!==groupId){diagnostics.quoteMisses++;return null;}
      const text=Array.isArray(message.message)?message.message.filter(s=>s.type==='text').map(s=>String(s.data?.text||'')).join('').slice(0,2000):'';
      if(!text){diagnostics.quoteMisses++;return null;}
      diagnostics.quoteReads++;
      return {messageId:String(messageId),senderId:String(message.sender?.user_id||message.user_id||''),text:String(message.sender?.user_id||message.user_id)===botId?formatQQReply(text):text};
    }catch{diagnostics.quoteMisses++;return null;}
  }, async send(message) {
    if (message.groupId !== groupId || typeof message.text !== 'string' || !message.text.trim()) throw new Error('ONEBOT_SCOPE');
    const plainText = formatQQReply(message.text);
    if (!plainText) throw new Error('EMPTY_PLAIN_TEXT');
    await check();
    if (!diagnostics.memberOfGroup) throw new Error('BOT_NOT_IN_GROUP');
    try {
      const data = await call('send_group_msg', { group_id: Number(groupId), message: [
        { type: 'reply', data: { id: String(message.replyTo) } }, { type: 'text', data: { text: plainText } }, ...await imageSegments(message.images||[])] },25000);
      if (data?.message_id == null) throw new Error('MISSING_DELIVERY_RECEIPT');
      diagnostics.sends++; return { ok: true, messageId: String(data.message_id) };
    } catch (error) { diagnostics.failedSends++; throw error; }
  } };
}
