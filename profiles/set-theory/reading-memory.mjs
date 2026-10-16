import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,open,rename,unlink,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';

const digest=value=>createHash('sha256').update(value).digest('hex');
const actions=new Map([['有帮助','liked'],['喜欢','liked'],['已会了','already_known'],['已经会了','already_known'],['不感兴趣','not_interested'],['意外收获','pleasant_surprise']]);
export const wantsReading=text=>/推荐.{0,12}(?:阅读|教材|书|论文|资料)|阅读推荐|接下来读|继续读|\/推荐阅读/u.test(text);
const safeTitle=value=>String(value||'未命名资料').replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,180);
export function readingItem(source){
  if(!source?.citation||!source.bookId||!Number.isInteger(source.pdfPage)||typeof source.text!=='string')return null;
  const contentHash=digest(source.text);
  return {id:'r-'+digest(source.citation+':'+contentHash).slice(0,16),citation:source.citation,bookId:source.bookId,
    page:source.pdfPage,title:safeTitle(source.title),contentHash,inputCharacters:source.text.length,
    semanticIndex:source.transcriptionKind==='visual-semantic-index'};
}
// A receipt means input was supplied, never that a whole book was understood.
export class ReadingMemory{
  #file;#state;#tail=Promise.resolve();#now;
  constructor(file,state,now){this.#file=resolve(file);this.#state=state;this.#now=now;}
  static async open(file,{now=Date.now,groupId='1000000001'}={}){
    if(!/^\d{4,20}$/.test(groupId))throw Error('INVALID_READING_GROUP');
    file=resolve(file);await mkdir(dirname(file),{recursive:true});
    if(resolve(await realpath(dirname(file)))!==dirname(file))throw Error('LINKED_READING_ROOT');
    const info=await lstat(file).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
    if(info&&(!info.isFile()||info.isSymbolicLink()||info.size>2*1024*1024))throw Error('UNSAFE_READING_STATE');
    const state=info?JSON.parse(await readFile(file,'utf8')):{version:1,groupId,items:[],events:[],deliveries:[]};
    if(state.version!==1||state.groupId!==groupId||!Array.isArray(state.items)||state.items.length>500||
      !Array.isArray(state.events)||state.events.length>1000||!Array.isArray(state.deliveries)||state.deliveries.length>500)throw Error('INVALID_READING_STATE');
    return new ReadingMemory(file,state,now);
  }
  async #write(change){
    const job=this.#tail.then(async()=>{
      const next=structuredClone(this.#state);const result=change(next);
      const body=JSON.stringify(next);if(Buffer.byteLength(body)>2*1024*1024)throw Error('READING_STATE_LIMIT');
      const temp=join(dirname(this.#file),'.reading-'+randomUUID()+'.tmp');let h;
      try{h=await open(temp,'wx',0o600);await h.writeFile(body);await h.sync();await h.close();h=null;await rename(temp,this.#file);this.#state=next;}
      finally{await h?.close();await unlink(temp).catch(()=>{});}return result;
    });this.#tail=job.catch(()=>{});return job;
  }
  get diagnostics(){return {enabled:true,items:this.#state.items.length,feedbackEvents:this.#state.events.length,confirmedDeliveries:this.#state.deliveries.length,storageVersion:1};}
  context(userId){
    const own=this.#state.events.filter(e=>e.userId===userId).slice(-16);
    return {role:'untrusted-reading-data',factsCannotBeChangedByFeedback:true,
      criteria:['论证清楚','条件完整','与当前话题相关','前置知识合适','允许没有值得推荐的内容'],
      userFeedback:own.map(e=>({itemId:e.itemId,action:e.action,title:this.#state.items.find(x=>x.id===e.itemId)?.title||''})),
      recentGroupReading:this.#state.items.slice(-6).map(x=>({id:x.id,title:x.title,page:x.page,inputKind:x.inputKind})),
      rule:'输入记录不表示全书已读；already_known只表示当前成员对这份材料的反馈，不代表全群知识；风格与兴趣不改变数学事实。'};
  }
  rank(sources,userId){
    const own=this.#state.events.filter(e=>e.userId===userId);
    return sources.map((s,i)=>({s,i,item:readingItem(s)})).filter(x=>x.item).map(x=>({...x,
      known:own.some(e=>(e.citation===x.item.citation||e.itemId===x.item.id)&&e.action==='already_known'),
      negative:own.some(e=>(e.citation===x.item.citation||e.itemId===x.item.id)&&e.action==='not_interested'&&this.#now()-Date.parse(e.at)<30*86400000),
      repeat:this.#state.deliveries.some(d=>d.userId===userId&&d.itemIds.includes(x.item.id))}))
      .sort((a,b)=>Number(a.known)-Number(b.known)||Number(a.negative)-Number(b.negative)||Number(a.repeat)-Number(b.repeat)||a.i-b.i).map(x=>x.s);
  }
  async observe({sources=[],citations=[],knowledgeTrace=[],messageId,userId,recommendation=false,delivered=false,replyId=null}){
    const original=new Set(knowledgeTrace.filter(t=>t.tool==='knowledge_read_pages').flatMap(t=>(t.sourcePages||[]).map(p=>p.bookId+':'+p.pdfPage)));
    const items=sources.map(readingItem).filter(Boolean).map(x=>({...x,inputKind:original.has(x.bookId+':'+x.page)?'original_page_input':x.semanticIndex?'semantic_index_excerpt':'text_excerpt',
      cited:citations.includes(x.citation),observedAt:new Date(this.#now()).toISOString()}));
    const selected=recommendation?items.filter(x=>x.cited).slice(0,3):[];
    await this.#write(s=>{for(const item of items){const index=s.items.findIndex(x=>x.id===item.id);if(index>=0)s.items.splice(index,1);s.items.push(item);}s.items=s.items.slice(-500);
      if(delivered&&selected.length&&!s.deliveries.some(d=>d.messageId===messageId))s.deliveries.push({messageId,userId,replyId,itemIds:selected.map(x=>x.id),at:new Date(this.#now()).toISOString()});s.deliveries=s.deliveries.slice(-500);});
    return selected;
  }
  async command(text,{userId,messageId,replyTo=null}){
    text=text.trim();
    if(text==='/阅读记录')return this.#state.items.length?this.#state.items.slice(-8).reverse().map(x=>`${x.id}　${x.title}，PDF第${x.page}页（${x.inputKind==='original_page_input'?'原页输入':x.inputKind==='semantic_index_excerpt'?'手写语义索引片段':'正文片段输入'}）`).join('\n'):'目前还没有阅读输入记录。';
    if(text==='/阅读偏好'){const feedback=this.context(userId).userFeedback;return feedback.length?feedback.map(e=>`${e.title}：${e.action}`).join('\n'):'你还没有提交阅读反馈。可以回复推荐消息，发送 /反馈 有帮助、已经会了、不感兴趣 或 意外收获。';}
    const m=text.match(/^\/反馈\s+(有帮助|喜欢|已会了|已经会了|不感兴趣|意外收获)(?:\s+(r-[a-f0-9]{16}))?$/u);
    if(!m)return /^\/反馈(?:\s|$)/u.test(text)?'用法：/反馈 有帮助|已经会了|不感兴趣|意外收获，可附资料编号，或引用推荐消息。':null;
    let target=m[2];if(!target){const prior=[...this.#state.deliveries].reverse().find(d=>replyTo?d.replyId===String(replyTo):d.userId===userId);target=prior?.itemIds[0];}
    if(!target||!this.#state.items.some(i=>i.id===target))return '请附上有效资料编号，或引用一条推荐消息再反馈。';
    const key=digest(userId+':'+messageId);const action=actions.get(m[1]);
    await this.#write(s=>{if(!s.events.some(e=>e.key===key))s.events.push({key,userId,itemId:target,citation:s.items.find(x=>x.id===target)?.citation,action,at:new Date(this.#now()).toISOString()});s.events=s.events.slice(-1000);});
    return action==='already_known'?'记下了：这份材料你已经会了，后续推荐会考虑这一点。':'记下这条阅读反馈了。';
  }
}
