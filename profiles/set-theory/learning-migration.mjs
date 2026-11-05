import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
// Historic records belong to the original Axu curator. Never attribute them to Hui
// or manufacture retrospective likes. Keep all original runtime files unchanged.
export async function importArchivedLearning(memory,root){
 let imported=0;
 for(const [kind,path] of [['video','bilibili/browse-state.json'],['article','scholar/scholar-state.json']]){
  let state;try{state=JSON.parse(await readFile(join(root,path),'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
  for(const v of state.visits||[]){
   if(v.phase!=='complete'||!v.summary||!v.url)continue;
   if(kind==='video')memory.importVideoTime(v.bvid,v.duration,Date.parse(v.at));
   imported+=Number(memory.record({kind,key:v.bvid||v.key||v.id,title:v.title,url:v.url,summary:v.summary,feedback:'neutral',reason:'legacy-note-no-explicit-self-feedback',at:Date.parse(v.at),historical:true,evidence:{scope:v.scope||'legacy-recorded-excerpts',evidenceTimes:v.evidenceTimes||[],readRanges:v.readRanges||[],missingRanges:v.missingRanges||[],quotes:v.evidence||[],historical:true}}));
  }
 }
 return imported;
}
