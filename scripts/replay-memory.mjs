import {readFile,writeFile,mkdir,realpath,stat} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {requestsNamedSecondary} from '../profiles/set-theory/provider-policy.mjs';
import {LongTermMemory} from '../profiles/set-theory/long-term-memory.mjs';
const id=v=>typeof v==='string'&&/^\d{4,20}$/.test(v);
export async function replayMemory({input,outDir,botId,root=process.cwd()}){
 if(!id(botId))throw Error('BOT_ID_REQUIRED');
 const privateRoot=resolve(root,'private');await mkdir(privateRoot,{recursive:true});
 if(resolve(await realpath(privateRoot))!==privateRoot)throw Error('LINKED_PRIVATE_ROOT');
 outDir=resolve(root,outDir);const local=relative(privateRoot,outDir);
 if(resolve(outDir,'..')!==privateRoot||!local||isAbsolute(local)||local==='..'||local.startsWith('..\\')||local.startsWith('../'))throw Error('PRIVATE_OUTPUT_REQUIRED');
 if((await stat(input)).size>16*1024*1024)throw Error('REPLAY_INPUT_TOO_LARGE');
 const rows=(await readFile(input,'utf8')).split(/\r?\n/).filter(x=>x.trim()).map(x=>JSON.parse(x));
 if(rows.length>10000)throw Error('REPLAY_EVENT_LIMIT');
 for(const e of rows)if(!id(e.groupId)||!id(e.senderId)||typeof e.messageId!=='string'||!e.messageId||e.messageId.length>128||typeof e.text!=='string'||e.text.length>12000||!Number.isFinite(e.at)||e.at<0)throw Error('INVALID_REPLAY_EVENT');
 // Create, never overwrite, a private destination. Validate its parent before writing.

 await mkdir(outDir);
 const seen=new Set(),events=rows.sort((a,b)=>a.at-b.at).filter(e=>{const k=e.groupId+':'+e.messageId;if(seen.has(k)||e.senderId===botId)return false;seen.add(k);return true;});
 const report={version:1,networkCalls:0,modelCalls:0,qqSends:0,autoApply:false,groups:[],limitations:['Saved sourced events are not an exhaustive transcript.','Development replay measures retrieval coverage, not model answer quality.']};
 for(const groupId of new Set(events.map(x=>x.groupId))){
  const data=events.filter(x=>x.groupId===groupId);let clock=data[0].at;
  const memory=await LongTermMemory.open(join(outDir,'scopes',groupId),{groupId,botId,now:()=>clock});
  let queries=0,hits=0,scopeLeaks=0,sourceLeaks=0;
  for(const [n,e] of data.entries()){
   clock=e.at;
   if(n>=Math.floor(data.length*.75)){
    queries++;const result=memory.context({userId:e.senderId,question:e.text,excludeMessageId:e.messageId});if(result.items.length)hits++;
    for(const hit of result.items){const item=memory.snapshot().items.find(i=>i.id===hit.id);if(item.scope!==groupId||(['preference','style_feedback'].includes(item.kind)&&item.subjectId!==e.senderId))scopeLeaks++;if(item.evidence.some(x=>x.messageId===e.messageId||x.at>clock))sourceLeaks++;}
   }
   await memory.observeHuman(e,{persona:requestsNamedSecondary(e.text,{enabled:true,name:'回',activationMode:'mentioned-name'},{hasSelfAt:e.hasSelfAt===true})?'hui':'axu'});
  }
  const items=memory.snapshot().items;report.groups.push({groupId,events:data.length,laterQueries:queries,queriesWithRecall:hits,retainedItems:items.length,byKind:Object.fromEntries([...new Set(items.map(x=>x.kind))].map(k=>[k,items.filter(x=>x.kind===k).length])),scopeLeaks,sourceLeaks,personaAutoApply:false});
 }
 await writeFile(join(outDir,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
 if(!args.includes('--input')||!args.includes('--out-dir')||!args.includes('--bot-id'))throw Error('Use --input PRIVATE_JSONL --out-dir private/NEW_DIRECTORY --bot-id BOT_ID');
 console.log(JSON.stringify(await replayMemory({input:resolve(value('--input')),outDir:value('--out-dir'),botId:value('--bot-id')})));
}
