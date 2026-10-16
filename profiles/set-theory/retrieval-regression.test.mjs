import test from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeBase} from './knowledge.mjs';
import {formatQQReply} from './response-format.mjs';
const id='c'.repeat(64);
const pages=[
 {bookId:id,title:'Jech fixture (English)',page:100,text:'9. Combinatorial Set Theory\nWeakly compact cardinals have the tree property.'},
 {bookId:id,title:'Jech fixture (English)',page:127,text:'10. Measurable Cardinals\nDefinition of measurable cardinal.'},
 {bookId:id,title:'Jech fixture (English)',page:136,text:'134 Part I. Basic Set Theory\nLemma 10.18. Every measurable cardinal is weakly compact. Proof uses a complete ultrafilter and the tree property.'},
 {bookId:id,title:'Jech fixture (English)',page:141,text:'11. Borel and Analytic Sets\nMeasurable sets and cardinal arithmetic.'},
 {bookId:id,title:'Jech fixture (English)',page:410,text:'22. Saturated Ideals\nCardinal cardinal cardinal measurable real-valued.'}
];
test('Chinese measurable-to-weakly-compact query selects the actual proof in requested chapter',()=>{
 const kb=createKnowledgeBase({version:1,pages});
 const hits=kb.search('检索Jech第10章可测基数的内容，怎么证明可测基数是弱紧致的？',{bookIds:[id],chapter:10,limit:4});
 assert.equal(hits[0].pdfPage,136);assert(hits.every(p=>p.pdfPage>=127&&p.pdfPage<141));
 assert.equal(kb.chapters.find(c=>c.number===10).startPage,127);
});
test('Chinese concept conjunction outranks repeated generic cardinal words',()=>{
 assert.equal(createKnowledgeBase({pages}).search('可测基数为什么是弱紧致的？')[0].pdfPage,136);
});
test('all QQ bold variants and boilerplate are stripped without touching multiplication',()=>{
 const input='**甲** \\*\\*乙\\*\\* ＊＊丙＊＊ *\u200b*丁*\u200b*\n2*3=6\n本次未引用已检索教材；回答需独立核对。';
 const output=formatQQReply(input);assert.doesNotMatch(output,/\*\*|\\\*|＊＊|独立核对/);assert.match(output,/2\*3=6/);assert.match(output,/甲/);
});
test('Chinese lemma-number lookup works even without any English subject words',()=>{
 const kb=createKnowledgeBase({pages});assert.equal(kb.search('Jech 引理10.18的证明',{bookIds:[id]})[0].pdfPage,136);
});
// Generic author queries must search every imported volume, not silently choose volume one.
test('Feng Qi without a volume searches all volumes; explicit third-volume routing is precise',async()=>{
 const {loadTextbooks}=await import('./textbooks.mjs');
 const {mkdtemp,writeFile}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const root=await mkdtemp(join(tmpdir(),'qq-textbook-routing-'));
 const first='d'.repeat(64),third='e'.repeat(64);
 await writeFile(join(root,'manifest.json'),JSON.stringify({books:[
 {bookId:first,file:first+'.pdf',title:'冯琦《集合论导引》第一卷',pages:30},
 {bookId:third,file:third+'.pdf',title:'冯琦《集合论导引》第三卷：高阶无穷',pages:30}]}));
 const indexPath=join(root,'index.json');await writeFile(indexPath,JSON.stringify({pages:[
 {bookId:first,title:'第一卷',page:12,text:'Countable sets are countable.'},
 {bookId:third,title:'第三卷',page:12,text:'A measurable cardinal carries a complete ultrafilter.'}]}));
 const kb=await loadTextbooks({corpusRoot:root,indexPath});
 assert.equal(kb.search('冯琦的可测基数定义')[0].bookId,third);
 assert.equal(kb.search('/读书 冯琦第三卷 第12页')[0].bookId,third);
 assert.equal(kb.search('集合论导引第一卷 可数集合')[0].bookId,first);
});

test('definition requests rank the definition block above frequent applications',()=>{
 const kb=createKnowledgeBase({pages:[
 {bookId:id,title:'fixture',page:23,text:'定义 1.1 称一个基数是可测基数，当且仅当存在非平凡完全的超滤子。\n定理 1.1 可测基数是不可达基数。'},
 {bookId:id,title:'fixture',page:176,text:'普利克瑞力迫\n'+('可测基数 完全超滤子 '.repeat(16))},
 {bookId:id,title:'fixture',page:39,text:'定义 1.5 一个同质嵌入映射满足初等性。\n定理 1.9 可测基数上的正规超滤子给出超幂。'}]});
 assert.equal(kb.search('可测基数与完备超滤子的定义')[0].pdfPage,23);
});

test('an absent numbered theorem does not return unrelated theorem pages',()=>{
 const kb=createKnowledgeBase({pages});assert.deepEqual(kb.search('Jech定理999.999的证明',{bookIds:[id]}),[]);assert.equal(kb.search('引理10.18',{bookIds:[id]})[0].pdfPage,136);
});

test('number-before-Theorem statements outrank pages that merely refer to the number',()=>{
 const k=createKnowledgeBase({pages:[{bookId:id,title:'fixture',page:27,text:'3.11 Theorem (Comparison). Correct statement.'},{bookId:id,title:'fixture',page:31,text:'By Theorem 3.11 and again 3.11 and 3.11.'}]});assert.equal(k.search('定理3.11')[0].pdfPage,27);
});
test('early chapter headings in articles remain available',()=>{
 const k=createKnowledgeBase({pages:[{bookId:id,title:'fixture',page:5,text:'An Outline\n1. Introduction\nOverview.'},{bookId:id,title:'fixture',page:6,text:'2. Premice\nDefinition.'},{bookId:id,title:'fixture',page:21,text:'3. Comparison\nMethods.'}]});assert.equal(k.chapters.find(c=>c.number===2).startPage,6);
});
