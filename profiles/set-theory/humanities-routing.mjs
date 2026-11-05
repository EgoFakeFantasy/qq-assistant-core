// Current-message topic selection only. This never authorizes a reply or calls a model.
const rules=[
 ['philosophy',/哲学|美学|存在先于本质|物自体|绝对精神|理想国|沉思录|纯粹理性批判|社会契约论|正义论|认识论|本体论|形而上学|伦理学|存在主义|虚无主义|现象学|实用主义|功利主义|辩证法|唯心主义|唯物主义|经验主义|自由意志|道德经|康德|黑格尔|海德格尔|维特根斯坦|柏拉图|亚里士多德|尼采|苏格拉底|笛卡尔|萨特|加缪|休谟|罗尔斯|斯宾诺莎|庄子|孔子|孟子|儒家|道家|墨家|法家|老子(?:的思想|的哲学|认为|与庄子)|\b(?:philosoph(?:y|ical)|epistemology|ontology|metaphysics|ethics|existentialism|phenomenology|free will|Kant|Hegel|Nietzsche|Plato|Aristotle|Wittgenstein|Heidegger)\b/iu],
 ['literature',/文学|诗歌|诗词|这首诗|古诗|唐诗|宋词|小说|散文|戏剧|作家|诗人|文学流派|叙事|修辞|意象|隐喻|人物塑造|叙述视角|红楼梦|水浒传|三国演义|西游记|百年孤独|卡拉马佐夫|罪与罚|变形记|哈姆雷特|堂吉诃德|追忆似水年华|局外人|鲁迅|老舍|沈从文|张爱玲|余华|莫言|卡夫卡|莎士比亚|陀思妥耶夫斯基|托尔斯泰|博尔赫斯|马尔克斯|李白|杜甫|苏轼|王维|辛弃疾|陶渊明|白居易|李清照|曹雪芹|\b(?:literature|literary|poetry|poem|novel|fiction|Shakespeare|Kafka|Dostoevsky|Tolstoy|Borges)\b/iu],
 ['history',/历史|思想史|哲学史|科学史|数学史|曹操|秦始皇|李世民|汉武帝|朱元璋|拿破仑|凯撒|成吉思汗|张居正|曾国藩|史学|史料|考古|朝代|王朝|近代史|世界史|中国史|历史学|唐朝|宋朝|元朝|明朝|清朝|汉朝|秦朝|春秋战国|西周|东周|三国时期|北宋|南宋|魏晋|南北朝|古罗马|罗马帝国|罗马共和国|古希腊|拜占庭|奥斯曼|文艺复兴|启蒙运动|工业革命|法国大革命|辛亥革命|鸦片战争|世界大战|冷战|\b(?:history|historical|historiography|archaeology|Roman Empire|Roman Republic|Renaissance|French Revolution|Cold War)\b/iu]
];
function currentText(text){return typeof text==='string'?text.normalize('NFKC').slice(0,20000).replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g,' ').replace(/\x60[^\x60\n]*\x60/g,' ').replace(/(?:^|\n)\s*>[^\n]*/g,' '):'';}
export function addressesAxu(text){return /^\s*(?:阿序(?:\s*[,，:：!！、]\s*|\s+)|\/阿序(?:\s|$)|(?:请\s*)?(?:以|用|使用|切换到)\s*阿序(?:的)?(?:人格|身份|模式)|(?:请问|请教|请让|请|让|麻烦|能不能请|可以请|我想请|我想让)\s*阿序\s*(?:回答|回复|解释|讲讲|[，,:：]))/u.test(currentText(text));}
export function humanitiesDiscussionTopic(text){
 let clean=currentText(text);
 // Operational histories are not historical discussion, including when quoted as terms.
 clean=clean.replace(/(?:聊天|对话|浏览|搜索|版本|提交|命令|操作|登录|调用|消息)历史|历史(?:记录|版本|消息|日志|命令)|\b(?:chat|conversation|browser|search|commit|version|command|shell|git)\s+(?:history|log)\b|\bhistory\.(?:back|forward|go|pushState|replaceState|length|state)\b/giu,' ');
 const technical=/集合论|共尾|序数|基数|强迫|超滤|矩阵|微积分|方程|算法|代码|编译|\b(?:ZFC?|Lean|Python|JavaScript|TypeScript|SQL|C\+\+|forcing|cardinal|ordinal)\b/iu.test(clean);
 const technicalTask=/证明|求证|推导|计算|求解|实现|调试|编译|报错|解释[\s\S]{0,80}(?:定义|定理|算法|代码)|\b(?:prove|compute|solve|debug|implement|compile)\b/iu.test(clean);
 const humanitiesFocus=/哲学(?:角度|意义|问题|分析|思想)|(?:思想|哲学|科学|数学)史|文学分析|历史研究|\b(?:philosophy of|philosophical implications|history of mathematics)\b/iu.test(clean);
 if(technical&&technicalTask&&!humanitiesFocus)return null;
 return rules.find(([,pattern])=>pattern.test(clean))?.[0]||null;
}
