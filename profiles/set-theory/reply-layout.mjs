const segmenter=new Intl.Segmenter('zh',{granularity:'grapheme'});
const glyphs=text=>Array.from(segmenter.segment(text),part=>part.segment);
export const DEFAULT_REPLY_PRESENTATION=Object.freeze({inlineMaxCharacters:500,inlineMaxLines:12,forwardNodeCharacters:800});
export const MAX_FORWARD_CHARACTERS=16000;
export const MAX_FORWARD_NODES=64;
export function normalizeReplyPresentation(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(DEFAULT_REPLY_PRESENTATION,k)))throw Error('INVALID_REPLY_PRESENTATION');
 const result={...DEFAULT_REPLY_PRESENTATION,...value};
 for(const [key,min,max] of [['inlineMaxCharacters',100,2000],['inlineMaxLines',3,40],['forwardNodeCharacters',600,2000]])
  if(!Number.isSafeInteger(result[key])||result[key]<min||result[key]>max)throw Error('INVALID_REPLY_PRESENTATION');
 return Object.freeze(result);
}
export function planReply(text,settings={}){
 if(typeof text!=='string'||!text.trim())throw Error('EMPTY_PLAIN_TEXT');
 const config=normalizeReplyPresentation(settings),chars=glyphs(text),lines=text.split(/\r\n|\r|\n/).length;
 if(chars.length>MAX_FORWARD_CHARACTERS)throw Error('OUTGOING_REPLY_LIMIT');
 if(chars.length<=config.inlineMaxCharacters&&lines<=config.inlineMaxLines)return {mode:'inline',characters:chars.length,lines,parts:[text]};
 const parts=[];let start=0;
 while(start<chars.length){
  let end=Math.min(start+config.forwardNodeCharacters,chars.length);
  if(end<chars.length){
   const floor=start+Math.floor(config.forwardNodeCharacters/2);
   let candidate=-1;
   // Prefer paragraph/line boundaries, then sentence endings. Preserve every glyph.
   for(let i=end;i>floor;i--)if(/[\r\n]/.test(chars[i-1])){candidate=i;break;}
   if(candidate<0)for(let i=end;i>floor;i--)if(/[。！？；.!?;]/.test(chars[i-1])){candidate=i;break;}
   if(candidate>start)end=candidate;
  }
  parts.push(chars.slice(start,end).join(''));start=end;
 }
 if(parts.length+2>MAX_FORWARD_NODES)throw Error('OUTGOING_REPLY_LIMIT');
 return {mode:'forward',characters:chars.length,lines,parts};
}
export function makeReplyNodes({plan,botId,nickname,replyTo,question='',images=[]}){
 const original=typeof question==='string'?question.slice(0,12000).replace(/[\p{Cc}\s]+/gu,' ').trim():'';
 const excerpt=glyphs(original);const header='完整回复（共'+plan.parts.length+'段）'+(excerpt.length?'\n回复：'+excerpt.slice(0,100).join('')+(excerpt.length>100?'…':''):'');
 const make=content=>({type:'node',data:{user_id:String(botId),nickname,content}});
 const nodes=[make([...(replyTo?[{type:'reply',data:{id:String(replyTo)}}]:[]),{type:'text',data:{text:header}}])];
 nodes.push(...plan.parts.map(text=>make([{type:'text',data:{text}}])));
 if(images.length)nodes.push(make(images));
 return nodes;
}
export function forwardReference(message){
 for(const segment of message.message||[]){
  let id;
  if(segment.type==='forward')id=segment.data?.id;
  if(segment.type==='json'){try{const data=typeof segment.data?.data==='string'?JSON.parse(segment.data.data):segment.data?.data;if(data?.app==='com.tencent.multimsg')id=data.meta?.detail?.resid;}catch{}}
  if(typeof id==='number')id=String(id);
  if(typeof id==='string'&&/^[A-Za-z0-9+/_=-]{1,1024}$/.test(id))return id;
 }
 return null;
}
export function parseForwardRecords(body,botId){
 const nodes=body?.messages;
 if(!Array.isArray(nodes)||!nodes.length||nodes.length>MAX_FORWARD_NODES)throw Error('INVALID_FORWARD_READBACK');
 let total=0;
 return nodes.map(node=>{
  const data=node.type==='node'?node.data:node;
  const sender=String(data?.sender?.user_id??data?.user_id??data?.uin??'');
  const content=Array.isArray(data?.message)&&data.message.length?data.message:data?.content;
  if(sender!==String(botId)||!Array.isArray(content)||content.some(s=>!s||!['text','image','reply'].includes(s.type)))throw Error('INVALID_FORWARD_READBACK');
  const text=content.filter(s=>s.type==='text').map(s=>String(s.data?.text||'')).join('');
  total+=text.length;if(total>MAX_FORWARD_CHARACTERS*2+200)throw Error('INVALID_FORWARD_READBACK');
  return {text,images:content.filter(s=>s.type==='image'),segments:content};
 });
}
export function forwardReplyText(records){
 const content=/^完整回复（共\d+段）(?:\n回复：[\s\S]*)?$/.test(records[0]?.text||'')?records.slice(1):records;
 return content.map(r=>r.text).join('');
}
