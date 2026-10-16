const cannedClause = /^(?:注[:：]?|说明[:：]?|提示[:：]?)?(?:(?:本次|此次|本回答|这次(?:回答)?|本次回答)?(?:未|没有)(?:引用|使用)(?:(?:已|本次)?检索(?:到|的)?)?(?:教材|资料|书籍)|(?:本次)?(?:回答|答案)(?:还|仍)?(?:需|需要|须|应)(?:自行|独立|额外)?(?:核对|核实|验证)|(?:超出|不在|超过)(?:了|我的|本次|现有|当前|所提供|已检索|本地)*知识库(?:的)?范围|(?:该|这个|此)?(?:概念|术语|表述)(?:可能|也许|或许)(?:不够准确|不准确)|(?:以下|下面|这些)?(?:是|为)?(?:可以相信|可信的部分|可靠的部分))/u;
export function stripCannedDisclaimers(value){
 const parts=String(value).split(/([。！？；;\n]+)/u);let output='';
 for(let i=0;i<parts.length;i+=2){
  const clause=parts[i];const canonical=clause.normalize('NFKC').replace(/[\p{Cf}\s]/gu,'').replace(/^[“"'「『]+|[”"'」』]+$/g,'');
  if(!cannedClause.test(canonical))output+=clause+(parts[i+1]||'');
 }
 return output.replace(/\n{3,}/g,'\n\n').trim();
}
export function cleanBotHistory(context=[],botId='2000000002'){
 return context.map(item=>String(item.senderId)===botId?{...item,text:formatQQReply(item.text)}:{...item});
}
export function formatQQReply(value){
 return stripCannedDisclaimers(String(value)
  .replace(/(?:\\+)?\*(?:[\u200b\u200c\u200d\ufeff \t]*(?:\\+)?\*)+/g,'')
  .replace(/[＊﹡]{2,}/g,'')
  .replace(/cite[^]*/g,'')
  .replace(/本次未引用(?:已检索)?教材[；;，,]?\s*回答需独立核对[。.]?/g,'')
  .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,'$1（$2）')
  .replace(/^\s{0,3}#{1,6}\s+/gm,'')
  .replace(/```[^\n]*\n?/g,'')
  .replace(/\n{3,}/g,'\n\n').trim());
}
export function formatWebSources(sources=[]){
 if(!Array.isArray(sources)||sources.length>6)throw new Error('INVALID_WEB_SOURCES');
 return sources.map((source,i)=>{
  if(typeof source?.title!=='string'||source.title.length>200||typeof source.url!=='string')throw new Error('INVALID_WEB_SOURCE');
  const u=new URL(source.url);
  if(u.protocol!=='https:'||u.username||u.password||['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw new Error('INVALID_WEB_SOURCE');
  return `〔网${i+1}〕${source.title}：${source.url}`;
 }).join('\n');
}