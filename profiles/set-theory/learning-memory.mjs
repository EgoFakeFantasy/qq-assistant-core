import {DatabaseSync} from 'node:sqlite';
import {mkdir,realpath,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {publicQuery} from './public-fetch.mjs';
import {quotaDay} from './quota-day.mjs';

export const feedbackValues=['like','neutral','dislike'];
export function publicTopics(values=[]){return [...new Set(values.slice(0,16).flatMap(v=>{try{return [publicQuery(v).slice(0,80)];}catch{return [];}}))];}
export function learningFeedback(review){return feedbackValues.includes(review.feedback)?review.feedback:review.interestScore>=0.65?'like':review.interestScore<0.35?'dislike':'neutral';}
export async function openLearningMemory(root,{persona,now=Date.now,timeZone='Australia/Sydney',maxVideoSeconds,targetVideoSeconds=maxVideoSeconds}={}){
 if(!['axu','hui'].includes(persona)||!Number.isSafeInteger(maxVideoSeconds)||maxVideoSeconds<0||maxVideoSeconds>43200||!Number.isSafeInteger(targetVideoSeconds)||targetVideoSeconds<0||targetVideoSeconds>maxVideoSeconds)throw Error('INVALID_LEARNING_CONFIG');
 root=resolve(root);await mkdir(root,{recursive:true});if(resolve(await realpath(root))!==root)throw Error('LINKED_LEARNING_ROOT');
 const file=join(root,persona+'.sqlite'),info=await lstat(file).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});if(info&&(!info.isFile()||info.isSymbolicLink()))throw Error('UNSAFE_LEARNING_DATABASE');
 const db=new DatabaseSync(file);db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS notes(kind TEXT,key TEXT,title TEXT,url TEXT,summary TEXT,feedback TEXT,reason TEXT,evidence TEXT,topics TEXT,at INTEGER,PRIMARY KEY(kind,key));
 CREATE TABLE IF NOT EXISTS topics(kind TEXT,query TEXT,score REAL DEFAULT 0,count INTEGER DEFAULT 0,PRIMARY KEY(kind,query));
 CREATE TABLE IF NOT EXISTS video_budget(id TEXT PRIMARY KEY,day TEXT,seconds INTEGER,status TEXT);`);
 // The single Hub lease owns writers. Interrupted reviews did not finish analysis.
 db.prepare("DELETE FROM video_budget WHERE status='reserved'").run();
 const day=()=>quotaDay(now(),timeZone),usage=()=>Number(db.prepare("SELECT coalesce(sum(seconds),0) AS n FROM video_budget WHERE day=?").get(day()).n);
 return {
  persona,
  get diagnostics(){return {persona,entries:Number(db.prepare('SELECT count(*) AS n FROM notes').get().n),day:day(),videoSeconds:usage(),maxVideoSeconds,targetVideoSeconds,accounting:'analysed-first-part-duration-not-full-frame-viewing'};},
  remaining(){return Math.max(0,maxVideoSeconds-usage());},
  reserve(id,seconds){seconds=Math.ceil(seconds);if(!Number.isSafeInteger(seconds)||seconds<1||seconds>this.remaining())return false;db.prepare('INSERT INTO video_budget VALUES(?,?,?,?)').run(id,day(),seconds,'reserved');return true;},
  importVideoTime(key,seconds,at){if(!Number.isFinite(at)||!Number.isFinite(seconds)||seconds<10||seconds>1800)return;db.prepare('INSERT OR IGNORE INTO video_budget VALUES(?,?,?,?)').run('legacy:'+key+':'+at,quotaDay(at,timeZone),Math.ceil(seconds),'complete');},
  finish(id){db.prepare("UPDATE video_budget SET status='complete' WHERE id=?").run(id);},
  release(id){db.prepare("DELETE FROM video_budget WHERE id=? AND status='reserved'").run(id);},
  wantsMore(){if(persona!=='hui'||usage()<targetVideoSeconds)return true;const recent=db.prepare("SELECT feedback FROM notes WHERE kind='video' ORDER BY at DESC LIMIT 5").all();return recent.some(r=>r.feedback==='like');},
  topic(kind,seeds,step=0){const base=publicTopics(seeds),learned=db.prepare('SELECT query,score,count FROM topics WHERE kind=? ORDER BY score DESC,query').all(kind);const pool=[...new Set([...base,...learned.map(r=>r.query)])];if(!pool.length)return kind==='video'?'集合论':'set theory';
   if(step%5===0)return pool[Math.floor(step/5)%pool.length];
   const scores=new Map(learned.map(r=>[r.query,r.score/Math.max(1,r.count)]));
   const ranked=pool.map(query=>({query,score:(scores.get(query)||0)+1/Math.sqrt(1+(learned.find(r=>r.query===query)?.count||0))})).sort((a,b)=>b.score-a.score||a.query.localeCompare(b.query));const weights=ranked.map(r=>Math.exp(2*r.score)),total=weights.reduce((a,b)=>a+b,0);let draw=((step*0.61803398875)%1)*total;for(let i=0;i<ranked.length;i++){draw-=weights[i];if(draw<0)return ranked[i].query;}return ranked.at(-1).query;},
  record({kind,key,title,url,summary,feedback,reason='',evidence={},topics=[],at=now(),historical=false,budgetId=null}){
   if(!['video','article'].includes(kind)||typeof key!=='string'||!key||typeof summary!=='string'||!summary.trim()||!feedbackValues.includes(feedback))throw Error('INVALID_LEARNING_NOTE');
   const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('INVALID_LEARNING_SOURCE');
   const selected=publicTopics(topics),body=JSON.stringify(evidence);if(body.length>180000)throw Error('LEARNING_EVIDENCE_LIMIT');
   db.exec('BEGIN IMMEDIATE');try{
    const result=db.prepare('INSERT OR IGNORE INTO notes VALUES(?,?,?,?,?,?,?,?,?,?)').run(kind,key,String(title).slice(0,400),u.href,summary.slice(0,1800),feedback,String(reason).slice(0,500),body,JSON.stringify(selected),Number.isFinite(at)?at:now());
    if(result.changes&&!historical)for(const query of selected)db.prepare('INSERT INTO topics(kind,query,score,count) VALUES(?,?,?,1) ON CONFLICT(kind,query) DO UPDATE SET score=score+excluded.score,count=count+1').run(kind,query,{like:1,neutral:0,dislike:-1}[feedback]);
    if(budgetId)db.prepare("UPDATE video_budget SET status='complete' WHERE id=? AND status='reserved'").run(budgetId);
    db.exec('COMMIT');return Boolean(result.changes);
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  recall(question='',limit=5){
   const text=String(question).toLowerCase(),words=text.match(/[a-z]{3,}/g)||[],han=text.match(/[\u4e00-\u9fff]+/g)||[];
   const terms=[...new Set([...words,...han.flatMap(t=>Array.from({length:Math.max(0,t.length-1)},(_,i)=>t.slice(i,i+2)))])].slice(0,24);
   const rank=terms.length?terms.map(()=>"CASE WHEN instr(lower(title||' '||summary||' '||topics),?)>0 THEN 1 ELSE 0 END").join('+'):'CASE WHEN 1 THEN 0 END';
   const rows=db.prepare('SELECT kind,key,title,url,summary,feedback,reason,evidence,topics,at FROM notes ORDER BY ('+rank+') DESC,at DESC LIMIT ?').all(...terms,Math.max(1,Math.min(8,limit)));
   return {persona,role:'untrusted-public-learning-memory',items:rows.map(({topics,evidence,...r})=>{const e=JSON.parse(evidence);return {...r,topics:JSON.parse(topics),evidence:{scope:e.scope||null,evidenceTimes:(e.evidenceTimes||[]).slice(0,4),quotes:(Array.isArray(e.evidence)?e.evidence:Array.isArray(e.quotes)?e.quotes:[]).slice(0,2)}};})};
  },
  close(){db.close();}
 };
}
