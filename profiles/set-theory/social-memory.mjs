import {assessMemory} from './memory-quality.mjs';
import {anchorRuleVersion,groupAnchorEvidence} from './memory-anchor-semantics.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';

const hash=s=>createHash('sha256').update(s).digest('hex');
const personas=new Set(['axu','hui']),DAY=86400000;
const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
const stop=new Set(['什么','怎么','这个','那个','我们','你们','他们','上次','之前','记得','阿序','回答','问题','解释','现在','可以','一下']);
const words=text=>[...new Set([...segmenter.segment(String(text).normalize('NFKC').toLowerCase())].filter(x=>x.isWordLike&&x.segment.length>1&&!stop.has(x.segment)).map(x=>x.segment))];
const sensitive=/(?:密码|口令|验证码|密钥|password|passwd|token|cookie|secret|api[_ -]?key)\s*[:：=]|\bBearer\s+\S+|\b(?:gh[pousr]_|sk-)[A-Za-z0-9_-]{16,}|-----BEGIN .*PRIVATE KEY|\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|[A-Z]:[\\/]|身份证|银行卡|家庭住址|病历|诊断结果|[?&](?:token|ticket|auth|code|key|password)=/i;
export function privateConversationText(value){
 const text=typeof value==='string'?value:'';
 if(text.length>1048576)throw Error('SOCIAL_MEMORY_TEXT_LIMIT');
 const redacted=sensitive.test(text.normalize('NFKC').replace(/\p{Cf}/gu,''));
 return {text:redacted?'[敏感内容已脱敏]':text,redacted};
}
const finite=n=>Number.isSafeInteger(n)&&n>=0;
const validUser=id=>typeof id==='string'&&/^\d{4,20}$/.test(id);
const parse=v=>JSON.parse(v);

export class SocialMemory{
 #db;#group;#bot;#now;#date;#lastMaintenance=0;#closed=false;
 constructor(db,{groupId,botId,now,timeZone}){this.#db=db;this.#group=groupId;this.#bot=botId;this.#now=now;this.#date=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});}
 static async open(root,{groupId,botId='2000000002',now=Date.now,timeZone='Australia/Sydney'}={}){
  if(!validUser(groupId)||botId!=='2000000002')throw Error('INVALID_SOCIAL_MEMORY_SCOPE');
  root=resolve(root);await mkdir(root,{recursive:true,mode:0o700});if(resolve(await realpath(root))!==root)throw Error('LINKED_SOCIAL_MEMORY_ROOT');
  const path=join(root,'memory.sqlite');for(const file of [path,path+'-wal',path+'-shm']){const s=await lstat(file).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});if(s&&(!s.isFile()||s.isSymbolicLink()))throw Error('UNSAFE_SOCIAL_MEMORY_FILE');}
  const db=new DatabaseSync(path);try{
   db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members(user_id TEXT PRIMARY KEY,display_name TEXT NOT NULL,first_at INTEGER NOT NULL,last_at INTEGER NOT NULL,messages INTEGER NOT NULL,mentions INTEGER NOT NULL,dirty INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS observations(message_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,at INTEGER NOT NULL,persona TEXT NOT NULL,mentioned INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS observations_member ON observations(user_id,at);
    CREATE TABLE IF NOT EXISTS member_days(user_id TEXT NOT NULL,day TEXT NOT NULL,PRIMARY KEY(user_id,day));
    CREATE TABLE IF NOT EXISTS dialogues(id TEXT PRIMARY KEY,group_id TEXT NOT NULL,user_id TEXT NOT NULL,message_id TEXT NOT NULL,at INTEGER NOT NULL,persona TEXT NOT NULL,question TEXT NOT NULL,reply_to TEXT,redacted INTEGER NOT NULL,source TEXT NOT NULL,media_count INTEGER NOT NULL,root_id TEXT,root_at INTEGER,actual_mention INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS dialogues_member ON dialogues(user_id,persona,at);
    CREATE TABLE IF NOT EXISTS replies(id TEXT PRIMARY KEY,dialogue_id TEXT NOT NULL REFERENCES dialogues(id),persona TEXT NOT NULL,at INTEGER NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,delivered INTEGER NOT NULL,verified INTEGER NOT NULL,reply_id TEXT,redacted INTEGER NOT NULL,phase TEXT NOT NULL DEFAULT 'complete');
    CREATE INDEX IF NOT EXISTS replies_dialogue ON replies(dialogue_id,persona);
    CREATE VIRTUAL TABLE IF NOT EXISTS dialogue_fts USING fts5(id UNINDEXED,tokens);
    CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,persona TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,text TEXT NOT NULL,latest_at INTEGER NOT NULL,payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS evidence_member ON evidence(user_id,persona,latest_at);
    CREATE TABLE IF NOT EXISTS cards(user_id TEXT NOT NULL,persona TEXT NOT NULL,updated_at INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(user_id,persona));
    CREATE TABLE IF NOT EXISTS affinity_events(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,persona TEXT NOT NULL,at INTEGER NOT NULL,day TEXT NOT NULL,delta REAL NOT NULL,reason TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS affinity_member ON affinity_events(user_id,persona,at);`);
   const columns=new Set(db.prepare('PRAGMA table_info(dialogues)').all().map(c=>c.name));for(const [name,type] of [['root_id','TEXT'],['root_at','INTEGER'],['actual_mention','INTEGER NOT NULL DEFAULT 0']])if(!columns.has(name))db.exec('ALTER TABLE dialogues ADD COLUMN '+name+' '+type);
   if(!db.prepare('PRAGMA table_info(replies)').all().some(c=>c.name==='phase'))db.exec("ALTER TABLE replies ADD COLUMN phase TEXT NOT NULL DEFAULT 'complete'");
   const identity=db.prepare("SELECT value FROM metadata WHERE key='identity'").get();const expected=JSON.stringify({version:1,groupId,botId});
   if(identity&&identity.value!==expected)throw Error('SOCIAL_MEMORY_IDENTITY_MISMATCH');
   if(!identity)db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('identity',expected);
   if(db.prepare("SELECT value FROM metadata WHERE key='anchor-rules'").get()?.value!==anchorRuleVersion){
    db.exec('BEGIN IMMEDIATE');try{
     db.exec('UPDATE members SET dirty=1');
     db.prepare("INSERT INTO metadata VALUES('anchor-rules',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(anchorRuleVersion);
     db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
   }
   return new SocialMemory(db,{groupId,botId,now,timeZone});
  }catch(e){db.close();throw e;}
 }
 #transaction(fn){this.#db.exec('BEGIN IMMEDIATE');try{const result=fn();this.#db.exec('COMMIT');return result;}catch(e){this.#db.exec('ROLLBACK');throw e;}}
 #id(messageId){return hash(this.#group+':'+messageId);}
 #index(id){
  const d=this.#db.prepare('SELECT question FROM dialogues WHERE id=?').get(id);if(!d)return;
  const replies=this.#db.prepare('SELECT text FROM replies WHERE dialogue_id=? AND delivered=1').all(id);
  this.#db.prepare('DELETE FROM dialogue_fts WHERE id=?').run(id);
  this.#db.prepare('INSERT INTO dialogue_fts(id,tokens) VALUES(?,?)').run(id,words([d.question,...replies.map(r=>r.text)].join('\n')).join(' '));
 }
 #affinityChange({id,userId,persona,at,delta,reason}){
  if(!delta||this.#db.prepare('SELECT 1 FROM affinity_events WHERE id=?').get(id))return;
  const day=this.#date.format(new Date(at)),used=this.#db.prepare('SELECT COALESCE(SUM(ABS(delta)),0) n FROM affinity_events WHERE user_id=? AND persona=? AND day=?').get(userId,persona,day).n;
  delta=Math.sign(delta)*Math.min(Math.abs(delta),Math.max(0,2-used));
  if(delta)this.#db.prepare('INSERT INTO affinity_events VALUES(?,?,?,?,?,?,?)').run(id,userId,persona,at,day,delta,reason);
 }
 observeHuman(event,{persona='axu',historical=false}={}){
  const id=String(event?.raw?.message_id||event?.messageId||''),at=event?.at;
  if(event?.groupId!==this.#group||!validUser(event.senderId)||event.senderId===this.#bot||event.officialRobotMarker===true||!(personas.has(persona)||historical&&persona==='unknown')||!id||id.length>128||!finite(at)||at>this.#now()+60000)return {recorded:false};
  const question=privateConversationText(event.text),display=privateConversationText(String(event.displayName||'').slice(0,80)),mentioned=event.hasSelfAtSegment===true;
  return this.#transaction(()=>{
   const fresh=!this.#db.prepare('SELECT 1 FROM observations WHERE message_id=?').get(id);
   if(fresh){
    this.#db.prepare('INSERT INTO observations VALUES(?,?,?,?,?)').run(id,event.senderId,at,persona,Number(mentioned));
    this.#db.prepare(`INSERT INTO members VALUES(?,?,?,?,?,?,1) ON CONFLICT(user_id) DO UPDATE SET display_name=CASE WHEN excluded.display_name<>'' AND excluded.last_at>=members.last_at THEN excluded.display_name ELSE members.display_name END,first_at=MIN(members.first_at,excluded.first_at),last_at=MAX(members.last_at,excluded.last_at),messages=members.messages+1,mentions=members.mentions+excluded.mentions,dirty=1`).run(event.senderId,display.redacted?'':display.text,at,at,1,Number(mentioned));
    this.#db.prepare('INSERT OR IGNORE INTO member_days VALUES(?,?)').run(event.senderId,this.#date.format(new Date(at)));
   }
   const key=this.#id(id);let parent=null;
   if(!mentioned&&event.replyTo)parent=this.#db.prepare('SELECT d.* FROM dialogues d LEFT JOIN replies r ON r.dialogue_id=d.id WHERE d.message_id=? OR r.reply_id=? ORDER BY d.at DESC LIMIT 1').get(String(event.replyTo),String(event.replyTo));
   if(!mentioned&&!parent&&!event.hasAtSegment)parent=this.#db.prepare('SELECT * FROM dialogues WHERE user_id=? AND actual_mention=1 AND at<=? AND at>=? ORDER BY at DESC LIMIT 1').get(event.senderId,at,at-120000);
   const related=mentioned||!!parent;
   if(related){
    const inserted=this.#db.prepare('INSERT OR IGNORE INTO dialogues(id,group_id,user_id,message_id,at,persona,question,reply_to,redacted,source,media_count,root_id,root_at,actual_mention) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(key,this.#group,event.senderId,id,at,persona,question.text,event.replyTo?String(event.replyTo).slice(0,128):null,Number(question.redacted),historical?(event.timestampVerified?'saved-event-time':'saved-request-time'):'live-event',Math.min(10,(event.images?.length||0)+(event.files?.length||0)),mentioned?key:parent.root_id||parent.id,mentioned?at:parent.root_at||parent.at,Number(mentioned));
    if(inserted.changes)this.#index(key);
    if(mentioned&&fresh&&!historical&&!question.redacted&&!/[“”「」『』"]|有人说|他说|她说|引用|好感|亲密|affinity/i.test(question.text)){
     const prior=this.#db.prepare('SELECT 1 FROM replies r JOIN dialogues d ON d.id=r.dialogue_id WHERE d.user_id=? AND r.persona=? AND r.verified=1 AND r.at<? AND r.at>? LIMIT 1').get(event.senderId,persona,at,at-7*DAY);
     const technical=/纠正|更正|证明|推导|错误|不对|算错/.test(question.text);
     const delta=prior&&/谢谢|感谢|有帮助|讲清楚|讲得好|辛苦了/.test(question.text)?1:!technical&&/你(?:就是|真是|是个|这个)?(?:垃圾|废物|蠢货)|(?:阿序|回)[，,]?闭嘴/.test(question.text)?-1:0;
     this.#affinityChange({id:'human:'+key,userId:event.senderId,persona,at,delta,reason:delta>0?'explicit-helpful-feedback':'direct-personal-abuse'});
    }
   }
   return {recorded:fresh,archived:related,id:related?key:null};
  });
 }
 recordReply(event,{text,persona='axu',status='answer',delivered=false,verified=false,replyId=null,attemptId=null,phase='complete',at=this.#now()}={}){
  if(event?.groupId!==this.#group||!personas.has(persona)||!finite(at))return {recorded:false};
  this.observeHuman(event,{persona:event.memoryPersona||persona});
  const dialogueId=this.#id(String(event.raw?.message_id||event.messageId||'')),body=privateConversationText(text),id=hash(dialogueId+':'+(attemptId||replyId||'uncertain:'+persona+':'+status));
  return this.#transaction(()=>{
   const d=this.#db.prepare('SELECT user_id FROM dialogues WHERE id=?').get(dialogueId);if(!d)return {recorded:false};
   const fresh=!this.#db.prepare('SELECT 1 FROM replies WHERE id=?').get(id);
   this.#db.prepare("INSERT INTO replies(id,dialogue_id,persona,at,text,status,delivered,verified,reply_id,redacted,phase) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET delivered=MAX(replies.delivered,excluded.delivered),verified=MAX(replies.verified,excluded.verified),reply_id=COALESCE(excluded.reply_id,replies.reply_id),phase=CASE WHEN replies.delivered=1 THEN replies.phase ELSE excluded.phase END").run(id,dialogueId,persona,at,body.text,String(status).slice(0,80),Number(delivered===true),Number(verified===true),replyId?String(replyId).slice(0,128):null,Number(body.redacted),['prepared','complete','uncertain'].includes(phase)?phase:'uncertain');
   if(delivered&&verified&&status==='answer')this.#db.prepare("UPDATE dialogues SET persona=? WHERE id=? AND persona=\'unknown\'").run(persona,dialogueId);
   if(delivered&&verified&&status==='answer')this.#affinityChange({id:'reply:'+id,userId:d.user_id,persona,at,delta:0.25,reason:'verified-conversation'});
   this.#index(dialogueId);return {recorded:fresh};
  });
 }
 syncEvidence(items){
  this.#transaction(()=>{for(const item of items){
   if(item.scope!==this.#group||!validUser(item.subjectId)||!personas.has(item.persona)||!/^m-[a-f0-9]{24}$/.test(item.id)||!['preference','style_feedback','open_question','episode','correction','claim'].includes(item.kind)||!['reported','disputed'].includes(item.status)||!Array.isArray(item.evidence)||!item.evidence.length||item.evidence.some(e=>!finite(e.at)||typeof e.messageId!=='string'))continue;
   const quality=assessMemory(item.kind,item.text);if(!quality.eligible)continue;const normalized={...item,kind:quality.kind};const body=privateConversationText(item.text);if(body.redacted)continue;
   const old=this.#db.prepare('SELECT payload FROM evidence WHERE id=?').get(item.id),witnesses=new Map();
   for(const e of [...(old?parse(old.payload).evidence:[]),...normalized.evidence])if(!witnesses.has(e.messageId)||e.at<witnesses.get(e.messageId).at)witnesses.set(e.messageId,e);
   normalized.evidence=[...witnesses.values()].sort((a,b)=>a.at-b.at);
   const latest=Math.max(...normalized.evidence.map(e=>e.at)),payload=JSON.stringify(normalized);if(old?.payload===payload)continue;
   this.#db.prepare('INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,latest_at=excluded.latest_at,payload=excluded.payload').run(item.id,item.subjectId,item.persona,quality.kind,item.status,body.text,latest,payload);
   this.#db.prepare('UPDATE members SET dirty=1 WHERE user_id=?').run(item.subjectId);
  }});
 }
 maintain({online=false,force=false}={}){
  const now=this.#now();if(!online||!force&&now-this.#lastMaintenance<60000)return {updated:0};this.#lastMaintenance=now;
  const members=this.#db.prepare('SELECT m.*, (SELECT COUNT(*) FROM member_days d WHERE d.user_id=m.user_id) days FROM members m WHERE dirty=1 AND messages>=10 AND (SELECT COUNT(*) FROM member_days d WHERE d.user_id=m.user_id)>=2 ORDER BY last_at DESC LIMIT 20').all();
  this.#transaction(()=>{for(const member of members){for(const persona of personas){
   const evidence=this.#db.prepare('SELECT payload FROM evidence WHERE user_id=? AND persona=? ORDER BY latest_at DESC').all(member.user_id,persona).map(r=>parse(r.payload));
   const anchors=[],special=[],conflicts=[];
   for(const row of groupAnchorEvidence(evidence)){
    if(row.status==='disputed'){if(conflicts.length<4)conflicts.push(row);continue;}
    if(['preference','style_feedback','open_question'].includes(row.kind)&&row.independentPeriods>=2&&anchors.length<8)anchors.push(row);
    if(['episode','correction'].includes(row.kind)&&special.length<6)special.push(row);
   }
   const first=this.#db.prepare('SELECT message_id,at FROM dialogues WHERE user_id=? AND persona=? ORDER BY at LIMIT 1').get(member.user_id,persona);
   const milestones=first?[{kind:'first-real-mention',messageId:first.message_id,at:first.at}]:[];
   const payload={version:1,groupId:this.#group,userId:member.user_id,persona,stage:'frequent',displayName:member.display_name,anchors,specialMemories:special,conflicts,milestones,updatedAt:now};
   this.#db.prepare('INSERT INTO cards VALUES(?,?,?,?) ON CONFLICT(user_id,persona) DO UPDATE SET updated_at=excluded.updated_at,payload=excluded.payload').run(member.user_id,persona,now,JSON.stringify(payload));
  }this.#db.prepare('UPDATE members SET dirty=0 WHERE user_id=?').run(member.user_id);}});
  return {updated:members.length};
 }
 affinity(userId,persona){
  if(!validUser(userId)||!personas.has(persona))return null;
  const rows=this.#db.prepare('SELECT at,delta,reason FROM affinity_events WHERE user_id=? AND persona=? ORDER BY at').all(userId,persona),now=this.#now();
  const score=Math.max(0,Math.min(100,50+rows.reduce((n,r)=>n+r.delta*Math.exp(-Math.max(0,now-r.at)/(60*DAY)),0)));
  return {score:Math.round(score*10)/10,baseline:50,basis:rows.length,affects:'familiarity-and-tone-only',recentReasons:rows.slice(-4).map(r=>({reason:r.reason,at:r.at,delta:r.delta}))};
 }
 card(userId,persona){
  if(!validUser(userId)||!personas.has(persona))return null;
  const member=this.#db.prepare('SELECT *, (SELECT COUNT(*) FROM member_days WHERE user_id=members.user_id) days FROM members WHERE user_id=?').get(userId);if(!member)return null;
  const stored=this.#db.prepare('SELECT payload FROM cards WHERE user_id=? AND persona=?').get(userId,persona);
  return {...(stored?parse(stored.payload):{version:1,groupId:this.#group,userId,persona,stage:'observing',displayName:member.display_name,anchors:[],specialMemories:[],conflicts:[],milestones:[]}),activity:{messages:member.messages,realMentions:member.mentions,activeDays:member.days,firstSeenAt:member.first_at,lastSeenAt:member.last_at},affinity:this.affinity(userId,persona)};
 }
 cards(persona){if(!personas.has(persona))return [];return this.#db.prepare('SELECT user_id FROM cards WHERE persona=? ORDER BY updated_at DESC LIMIT 20').all(persona).map(r=>this.card(r.user_id,persona));}
 dialogue(messageId){
  const row=this.#db.prepare('SELECT * FROM dialogues WHERE id=? AND group_id=?').get(this.#id(messageId),this.#group);if(!row)return null;
  return {...row,replies:this.#db.prepare('SELECT * FROM replies WHERE dialogue_id=? ORDER BY at').all(row.id)};
 }
 recall({userId,persona,question,excludeMessageId=null,maxItems=3,maxCharacters=2400}={}){
  if(!validUser(userId)||!personas.has(persona))return [];
  const query=words(question).slice(0,8).map(w=>'"'+w.replaceAll('"','""')+'"').join(' OR ');let rows=[];
  if(query)rows=this.#db.prepare('SELECT d.* FROM dialogue_fts JOIN dialogues d ON d.id=dialogue_fts.id WHERE dialogue_fts MATCH ? AND d.group_id=? AND d.user_id=? AND d.message_id<>? AND (d.persona=? OR d.persona=\'unknown\' OR EXISTS(SELECT 1 FROM replies r WHERE r.dialogue_id=d.id AND r.persona=?)) ORDER BY bm25(dialogue_fts),d.at DESC LIMIT ?').all(query,this.#group,userId,excludeMessageId||'',persona,persona,Math.min(3,maxItems));
  if(!rows.length&&/之前|上次|记得|聊过|提过|记忆/.test(question))rows=this.#db.prepare('SELECT * FROM dialogues WHERE group_id=? AND user_id=? AND message_id<>? AND (persona=? OR persona=\'unknown\') ORDER BY at DESC LIMIT ?').all(this.#group,userId,excludeMessageId||'',persona,Math.min(3,maxItems));
  let budget=0;return rows.flatMap(d=>{
   const replies=this.#db.prepare('SELECT text,delivered,verified,at,status FROM replies WHERE dialogue_id=? AND persona=? AND delivered=1 ORDER BY at').all(d.id,persona);
   const available=Math.max(0,maxCharacters-budget);if(available<80)return [];
   const questionText=d.question.slice(0,Math.min(800,available)),answer=replies.map(r=>r.text).join('\n').slice(0,Math.min(1000,Math.max(0,available-questionText.length)));budget+=questionText.length+answer.length;
   return [{messageId:d.message_id,at:d.at,question:questionText,answer:answer||null,replyAvailable:replies.length>0,replyVerified:replies.length>0&&replies.every(r=>r.verified===1),source:d.source,personaAttribution:d.persona==='unknown'?'unknown-question-target':d.persona,scope:'current-group-current-member',role:'untrusted-historical-conversation',truncated:questionText.length<d.question.length||answer.length<replies.reduce((n,r)=>n+r.text.length,0)}];
  });
 }
 get diagnostics(){return {enabled:true,storage:'sqlite-wal',anchorRuleVersion,automaticExpiry:false,dialogues:this.#db.prepare('SELECT COUNT(*) n FROM dialogues').get().n,replies:this.#db.prepare('SELECT COUNT(*) n FROM replies').get().n,pendingOrUncertainReplies:this.#db.prepare("SELECT COUNT(*) n FROM replies WHERE phase<>'complete'").get().n,observedMessages:this.#db.prepare('SELECT COUNT(*) n FROM observations').get().n,members:this.#db.prepare('SELECT COUNT(*) n FROM members').get().n,frequentCards:this.#db.prepare('SELECT COUNT(*) n FROM cards').get().n,evidenceAnchors:this.#db.prepare('SELECT COUNT(*) n FROM evidence').get().n,retention:'real-self-mentions-related-reply-threads-and-reply-attempts',modelsCalled:0};}
 close(){if(!this.#closed){this.#db.close();this.#closed=true;}}
}
