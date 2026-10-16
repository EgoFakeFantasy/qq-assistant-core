// Only this fixed public vocabulary can leave the group-answering subsystem.
const topics=[
 ['world_of_darkness',['黑暗世界','world of darkness','白狼桌游'],'World of Darkness role-playing game'],
 ['self_reference_engine',['自指引擎','self-reference engine'],'Self-Reference ENGINE EnJoe'],
 ['gta6',['gta6','gta 6','gta vi','侠盗猎车手6'],'Grand Theft Auto VI'],
 ['self_reference',['自指','悖论','self reference'],'self reference paradox logic'],
 ['extender',['扩张子','extender'],'set theory extenders'],
 ['ultrafilter',['超滤子','ultrafilter'],'ultrafilters set theory'],
 ['inaccessible',['不可达','inaccessible cardinal'],'inaccessible cardinals'],
 ['strongly_compact',['强紧致','strongly compact'],'strongly compact cardinals'],
 ['constructible',['可构造','constructible'],'constructible universe'],
 ['zfc',['zfc','zf公理','zermelo'],'Zermelo Fraenkel set theory'],
 ['measurable',['可测基数','measurable cardinal'],'measurable cardinals'],
 ['weakly_compact',['弱紧致','weakly compact'],'weakly compact cardinals'],
 ['jech',['jech'],'Thomas Jech Set Theory'],
 ['kanamori',['higher infinite','kanamori'],'Akihiro Kanamori The Higher Infinite'],
 ['forcing',['强迫','forcing'],'set theory forcing'],
 ['cofinality',['共尾','cofinality'],'ordinal cofinality'],
 ['supercompact',['超紧致','supercompact'],'supercompact cardinals'],
 ['set_theory',['集合论','set theory'],'axiomatic set theory'],
 ['choice',['选择公理','axiom of choice'],'axiom of choice'],
 ['ordinal',['序数','ordinal'],'ordinal numbers'],
 ['cardinal',['基数','cardinal'],'cardinal numbers'],
 ['math',['数学','mathematics'],'mathematics'],
 ['python',['python','派森'],'Python official documentation'],
 ['asyncio',['asyncio'],'Python asyncio official documentation'],
 ['lean',['lean'],'Lean theorem prover official documentation'],
 ['javascript',['javascript','js代码'],'JavaScript MDN documentation'],
 ['openai',['openai','codex','chatgpt'],'OpenAI Codex ChatGPT official documentation'],
 ['qq',['qq','腾讯'],'Tencent QQ official documentation'],
 ['weather_sydney',['悉尼天气','sydney weather'],'Sydney weather forecast'],
 ['weather_melbourne',['墨尔本天气','melbourne weather'],'Melbourne weather forecast'],
 ['weather_beijing',['北京天气'],'Beijing weather forecast'],
 ['world_news',['新闻','news'],'latest world news'],
 ['physics',['物理','physics'],'physics educational resources'],
 ['chemistry',['化学','chemistry'],'chemistry educational resources']
];
const dictionary=new Map(topics.map(([id,,label])=>[id,label]));
export function choosePublicTopics(question){
 const q=String(question).normalize('NFKC').toLowerCase();
 const selected=topics.filter(([,matches])=>matches.some(s=>q.includes(s))).map(([id])=>id);
 const specific=selected.some(id=>['extender','ultrafilter','inaccessible','strongly_compact','constructible','zfc','measurable','weakly_compact','forcing','cofinality','supercompact','choice','ordinal'].includes(id));
 return selected.filter(id=>!specific||!['cardinal','set_theory','math'].includes(id)).slice(0,4);
}
export function publicTopicLabels(ids){
 if(!Array.isArray(ids)||!ids.length||ids.length>4||ids.some(id=>!dictionary.has(id)))throw new Error('NON_PUBLIC_SEARCH_INPUT');
 return ids.map(id=>dictionary.get(id));
}
export function needsPublicLookup(question,sources){return /联网|上网|网络|网上|搜索|查一下|查资料|最新|今天|现在|新闻|天气|最近|延期|发售|发布时间|发布日期|出处|来源/.test(question)&&choosePublicTopics(question).length>0;}