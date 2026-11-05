// Recognize expression preferences, never arbitrary instructions quoted as feedback.
const reported=/(?:他说|她说|有人说|引用|转述|假设有人|假如有人)/u;
const examples=/“[^“”\n]{1,120}”|「[^「」\n]{1,120}」|『[^『』\n]{1,120}』|"[^"\n]{1,120}"/gu;
const framing=/防御|框定|免责声明|边界声明|反复限定|过度限定|重复限定|预防性|不是.{0,30}(?:只是|而是)|不代表.{0,30}只/u;
const addressed=/(?:你|阿序|回|助手|机器人|bot).{0,50}(?:表达|说话|回答|语气|口吻|总是|每次|限定)|(?:别|少用|减少|不要|不用|保留|继续).{0,35}(?:限定|框定|防御|免责声明|边界声明|套话)/iu;
const reduce=/太多|过多|过度|多余|没必要|无效|啰嗦|繁琐|污染理解|少用|减少|别再|不要再|不要每次|不用每次|别每次|总是|每次都/u;
const preserve=/(?:不要|别|不用).{0,6}(?:减少|省略|删掉|去掉|取消).{0,12}(?:限定|条件|边界)|(?<!不|没|不要|不用|别|不再)(?:保留|继续|需要|喜欢).{0,15}(?:必要的?)?(?:限定|边界声明)|(?:限定|边界声明).{0,12}(?:很有帮助|有必要|很清楚)/u;

export function framingFeedback(text){
 const outside=String(text).replace(examples,'');
 if(reported.test(outside)||!addressed.test(outside)||!framing.test(text))return null;
 if(preserve.test(outside))return 'preserve';
 return reduce.test(outside)?'reduce':null;
}

export function isQuotedStyleExample(text){
 if(reported.test(text)||!framingFeedback(text))return false;
 const matches=[...text.matchAll(examples)];
 return matches.length>0&&matches.length<=3&&!/[“”「」『』"]/.test(text.replace(examples,''))&&matches.every(([value])=>
  /不是.{0,80}(?:只是|而是)|不代表|不等于|不意味着|宣称|仅仅|只是/u.test(value)&&
  !/请|忽略|无视|修改|删除|执行|关闭|开启|切换|绕过|你是|你叫|从现在起|system|developer|assistant/iu.test(value));
}

export function isExplicitStyleFeedback(text){
 return Boolean(framingFeedback(text))||
  /别再|不要再|不要每次|别每次|不需要每次|不用每次|你.{0,6}(?:总是|每次)/u.test(text)&&
  /反问|追问|自我介绍|加粗|套话|复读|道歉|结尾|开头|太长|太短|重复推荐|口吻|语气/u.test(text);
}

export function memberStylePreferences(items,{persona='axu'}={}){
 const feedback=items.filter(i=>i.kind==='style_feedback'&&i.persona===persona);
 const directions=new Set(feedback.map(i=>framingFeedback(i.text)).filter(Boolean));
 if(directions.size!==1||feedback.some(i=>i.status==='disputed'))return [];
 const direction=[...directions][0];
 return [{id:direction==='reduce'?'direct-answer':'explicit-conditions',
  instruction:direction==='reduce'?'直接回答，把影响结论的必要条件随结论说明一次。':'清楚交代影响结论的条件，按当前问题展开。'}];
}
