import { readFile } from 'node:fs/promises';

const aliases = new Map([
  ['迭代策略',['iteration strategy','iteration strategies']], ['迭代树',['iteration tree','iteration trees']], ['内模型',['inner model']], ['前鼠',['premouse','premice']], ['鼠对',['mouse pair','mouse pairs']], ['比较过程',['comparison process']], ['分支凝聚',['branch condensation']], ['最小分支',['least branch']], ['规范化',['normalizing','normalization']], ['正规化',['normalizing','normalization']], ['细结构',['fine structure']], ['投射序数',['projectum','projecta']], ['伍丁',['woodin']],
  ['可测基数', ['measurable cardinal']], ['可测', ['measurable']],
  ['扩张子', ['extender','extenders']], ['超幂', ['ultrapower']], ['可构造', ['constructible']],
  ['覆盖定理', ['covering theorem']], ['平稳', ['stationary']],
  ['替换公理', ['replacement','替换原则']], ['分离公理', ['separation','子集合分离原则','分离原则']],
  ['无穷公理', ['axiom of infinity']], ['不可数', ['uncountable']], ['弱紧致', ['weakly compact']],
  ['不可达', ['inaccessible']], ['强不可达', ['strongly inaccessible']],
  ['超紧致', ['supercompact']], ['强紧致', ['strongly compact']],
  ['正规测度', ['normal measure']], ['超滤子', ['ultrafilter']],
  ['同质嵌入', ['elementary embedding']], ['初等嵌入', ['elementary embedding']],
  ['树性质', ['tree property']], ['树性', ['tree property']],
  ['共尾', ['cofinality','cofinal']], ['可数', ['countable','countability']],
  ['选择公理', ['axiom of choice']], ['序数', ['ordinal','ordinals']],
  ['基数', ['cardinal','cardinals']], ['正则', ['regular']],
  ['幂集', ['power set']], ['良序', ['well ordering','well-ordering']], ['强迫', ['forcing']]
]);
const fold = s => String(s).normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
export function parseChapterNumber(query) {
  const match=String(query).match(/第\s*([零〇一二三四五六七八九十百\d]+)\s*章|\bchapter\s+(\d+)\b/i);
  if(!match)return null;
  const s=match[1]||match[2];if(/^\d+$/.test(s))return Number(s);
  const digits='零一二三四五六七八九';
  if(s.includes('十')){const [a,b]=s.split('十');return(a?digits.indexOf(a):1)*10+(b?digits.indexOf(b):0);}
  return digits.indexOf(s.replace('〇','零'));
}
function tokens(text) {
  const normalized=fold(text);
  const expanded=[...aliases].reduce((s,[key,values])=>[key,...values].some(term=>normalized.includes(term))?s+' '+[key,...values].join(' '):s,normalized);
  const english=[...expanded.matchAll(/[a-z]{2,}/g)].map(m=>m[0]).filter(t=>!['jech','chapter','the','is','an','of','how','that','prove'].includes(t));
  const chinese=[];for(const m of expanded.matchAll(/[\u3400-\u9fff]+/gu))for(let i=0;i<m[0].length-1;i++)chinese.push(m[0].slice(i,i+2));
  return [...new Set([...english,...chinese])];
}
function findChapters(pages) {
  const found=new Map();
  for(const p of [...pages].sort((a,b)=>a.page-b.page)){
    const head=p.text.normalize('NFKC').trim().slice(0,600);
    if(/contents|目录/i.test(head.slice(0,250)))continue;
    const first=head.split('\n')[0].trim();
    const named=head.match(/(?:^|\n)\s*CHAPTER\s+(\d{1,2})[.\s]+([^\n]+)/i);
    const en=head.match(/(?:^|\n)\s*(\d{1,2})\.\s+([A-Za-z][^\n]*)/);
    const zh=first.match(/^(?:\d+\s+)?第\s*([一二三四五六七八九十\d]+)\s*章/);
    const number=named?Number(named[1]):en?Number(en[1]):zh?parseChapterNumber('第'+zh[1]+'章'):null;
    const heading=named?named[0].trim():en?en[0].trim():first;
    if(!number||number>99||/\.\s*\.\s*\./.test(heading))continue;
    const key=p.bookId+':'+number;
    if(!found.has(key))found.set(key,{bookId:p.bookId,number,startPage:p.page,heading});
  }
  const chapters=[...found.values()];
  for(const c of chapters){const next=chapters.filter(x=>x.bookId===c.bookId&&x.startPage>c.startPage).sort((a,b)=>a.startPage-b.startPage)[0];c.endPage=next?next.startPage-1:Math.max(...pages.filter(p=>p.bookId===c.bookId).map(p=>p.page));}
  return chapters;
}
function source(p,text=p.text){return {citation:p.citation,bookId:p.bookId,title:p.title,pdfPage:p.page,printedPage:null,text,truncated:text!==p.text,sourceType:p.sourceType||'text-layer',ocrEngine:p.ocrEngine||null,transcriptionKind:p.transcriptionKind||null};}
export function createKnowledgeBase(index = { pages: [] }) {
  if(index.version!==undefined&&index.version!==1)throw new Error('INDEX_VERSION');
  const pages=index.pages.map(p=>{
    if(!/^[a-f0-9]{64}$/.test(p.bookId)||!Number.isInteger(p.page)||p.page<1||typeof p.title!=='string'||typeof p.text!=='string')throw new Error('INVALID_INDEX_PAGE');
    return {...p,folded:fold(p.text).replace(/(?<=\d)\s*\.\s*(?=\d)/g,'.'),citation:`${p.bookId.slice(0,12)}:p${p.page}`};
  });
  const chapters=findChapters(pages);
  return {
    readPage(bookId,pdfPage){const p=pages.find(p=>p.bookId===bookId&&p.page===pdfPage);return p?source(p):null;},
    search(query,{limit=4,maxCharacters=7200,bookIds,chapter}={}){
      const theorem=String(query).match(/(?:引理|定理|命题|推论|定义|lemma|theorem|proposition|corollary|definition)\s*(\d+(?:\.\d+){0,3})/i)?.[1];
      const terms=tokens(String(query).slice(0,12000)).slice(0,64);if(theorem)terms.push(theorem);if(!terms.length)return[];
      let eligible=pages.filter(p=>!bookIds||bookIds.includes(p.bookId));
      if(theorem){const exactNumber=new RegExp('(?<![\\d.])'+theorem.replaceAll('.','\\.')+'(?!\\d|\\.\\d)');eligible=eligible.filter(p=>exactNumber.test(p.folded));}
      if(chapter){const ranges=chapters.filter(c=>c.number===chapter&&(!bookIds||bookIds.includes(c.bookId)));eligible=eligible.filter(p=>ranges.some(c=>c.bookId===p.bookId&&p.page>=c.startPage&&p.page<=c.endPage));}
      if(!eligible.length)return[];
      const average=eligible.reduce((n,p)=>n+p.text.length,0)/eligible.length;
      const frequencies=terms.map(term=>({term,idf:Math.log(1+(eligible.length+1)/(1+eligible.filter(p=>p.folded.includes(term)).length))}));
      const definitionQuery=/定义|(?<!为)什么是|是什么|是什么意思|\b(?:definition|define|what is)\b/i.test(query);
      const q=fold(query);const concepts=[...aliases].filter(([zh,en])=>q.includes(zh)||en.some(s=>q.includes(s)));
      const matches=eligible.map(p=>{
        let score=frequencies.reduce((n,{term,idf})=>{const tf=p.folded.split(term).length-1;const normalization=1.2*(.25+.75*p.text.length/Math.max(1,average));return n+idf*(tf*2.2/(tf+normalization));},0);
        if(concepts.length){const matched=concepts.filter(([zh,en])=>p.folded.includes(zh)||en.some(s=>p.folded.includes(s))).length;score*=1+8*(matched/concepts.length)**2;}
        if(definitionQuery&&concepts.length){
          let relevance=0,headRelevance=0;
          for(const label of p.text.matchAll(/(?:^|\n)\s*(?:定义\s*\d[\d\s．.]*|Definition\b)/gi)){
            const start=label.index+label[0].length;
            const body=p.text.slice(start,start+700).split(/\n\s*(?:定理|引理|命题|推论|证明|定义|Theorem|Lemma|Proposition|Corollary|Proof|Definition)\s*/i)[0];
            const block=fold(body);
            const matched=concepts.filter(([zh,en])=>block.includes(zh)||en.some(s=>block.includes(s))).length;
            relevance=Math.max(relevance,matched/concepts.length);
            let head=fold(body.split('\n')[0].slice(0,250));
            const named=head.match(/^[（(]\s*([^）)]+)[）)]/);if(named)head=named[1];
            if(/^(?:设|let\b)/i.test(head)&&!/称|called/i.test(head))head='';
            const headMatched=concepts.filter(([zh,en])=>head.includes(zh)||en.some(s=>head.includes(s))).length;
            headRelevance=Math.max(headRelevance,headMatched/concepts.length);
          }
          score*=1+8*relevance**2+100*headRelevance**2;
        }
        if(theorem&&p.folded.includes(theorem)){
          score*=20;
          const number=theorem.replaceAll('.','\\.');
          const label='(?:Lemma|Theorem|Proposition|Corollary|Definition|定义|定理|引理|命题|推论)';
          const statement=new RegExp('(?:^|\\n)\\s*(?:'+label+'\\s*'+number+'(?!\\d|\\.\\d)|'+number+'\\s*'+label+')','i');
          if(statement.test(p.text.normalize('NFKC')))score*=8;
        }
        const firstChapter=chapters.filter(c=>c.bookId===p.bookId).sort((a,b)=>a.startPage-b.startPage)[0];
        if((firstChapter&&p.page<firstChapter.startPage)||/目录|table of contents|^index\b|索引/.test(p.folded.slice(0,220)))score*=0.12;
        return{p,score};
      }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.p.page-b.p.page).slice(0,limit);
      const budget=Math.floor(maxCharacters/Math.max(1,matches.length));
      return matches.map(({p,score})=>({...source(p,p.text.slice(0,budget)),score:Math.round(score*1000)/1000}));
    },pageCount:pages.length,chapters
  };
}
export async function loadKnowledgeBase(path){return createKnowledgeBase(JSON.parse(await readFile(path,'utf8')));}