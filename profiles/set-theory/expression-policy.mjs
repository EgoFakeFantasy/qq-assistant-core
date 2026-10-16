// One expression policy for ordinary replies, autonomous shares and public comments.
export const EXPRESSION_POLICY_VERSION='2026-10-17.1';
export const expressionInstructions='表达温和、平等，不用😂、🤣、😅、🙃、😏、🙄、🤡或带嘲讽、攻击、阴阳意味的表情及表情图，不用狗头、滑稽、鄙视、斜眼笑、笑哭等表情标记。日常交流可以轻松可爱，优先后台明确提供的已审核本地可爱表情包，也可少量使用(｡•ᴗ•｡)、(๑•̀ㅂ•́)و✧等颜文字；不强行每条添加，不用表情装饰数学定义、证明或严肃讨论。没有合适表情就用自然文字。只能从本题resourceContext.localStickers列表选取本地表情包id放入imageIds，最多一张，不需要搜图请求；列表以外的图片仍须明确搜图请求且从实际搜索结果选择，不能编造id、路径或图片链接。';

const unwelcomeEmoji=/[😂🤣😅🙃😏🙄🤡😹😈👿🖕💩😒😡😠🤬🤢🤮👎][\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}]*/gu;
const faceNames='狗头|滑稽|鄙视|斜眼笑?|白眼|嘲笑|阴险|偷笑|笑哭|狗狗笑哭|奥特笑哭|企鹅笑哭|doge|旺柴|小丑';
const namedFace=new RegExp('(?:\\[|【|\\[表情[:：]?)(?:'+faceNames+')(?:\\]|】)','giu');
const slashFace=new RegExp('/(?:'+faceNames+')(?=$|[\\s，。！？；：、])','gimu');
// Numeric ids are the named faces in NapCat's bundled QQ face table. Unknown ids stay intact.
const unwelcomeFaceIds=new Set(['20','22','105','108','178','179','182','361','368','378']);
const faceNamePattern=new RegExp('^(?:'+faceNames+')$','iu');
function cleanPart(value){
 return value.replace(unwelcomeEmoji,'').replace(namedFace,'').replace(slashFace,'')
  .replace(/\[CQ:face,([^\]\r\n]*)\]/giu,(marker,attributes)=>{
   const fields=attributes.split(',').map(p=>p.trim().split('='));
   return fields.some(([key,id])=>key?.toLowerCase()==='id'&&(unwelcomeFaceIds.has(id)||faceNamePattern.test(id)))?'':marker;
  });
}
export function applyExpressionPolicy(value){
 // Preserve links exactly, even if a legitimate URL contains a face name or emoji.
 return String(value).split(/(https?:\/\/[^\s<>]+)/giu)
  .map((part,index)=>index%2?part:cleanPart(part)).join('');
}
