import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLearningMemory} from './learning-memory.mjs';
import {BilibiliExplorer} from './bilibili-explorer.mjs';
import {ScholarExplorer} from './scholar-explorer.mjs';
import {importArchivedLearning} from './learning-migration.mjs';
import {selectPersonaRequest} from '../../src/domain/cognition/persona-review.js';
import {prepareModelInput} from './model-input.mjs';
import {createAutonomyModel} from './autonomy-model.mjs';
const temp=()=>mkdtemp(join(tmpdir(),'persona-learning-'));
const note=(key,feedback='like')=>({kind:'video',key,title:'集合论公开课程',url:'https://www.bilibili.com/video/'+key,summary:'课堂用具体序数解释共尾度。',feedback,reason:'例子具体',topics:['集合论'],evidence:{scope:'first-video-part',transcript:'actual subtitle',evidenceTimes:[4]}});
test('durable notes deduplicate, remain persona-isolated and reach only the selected model input',async()=>{
 const root=await temp(),a=await openLearningMemory(root,{persona:'axu',maxVideoSeconds:43200}),h=await openLearningMemory(root,{persona:'hui',maxVideoSeconds:28800,targetVideoSeconds:14400});
 assert.equal(a.record(note('BV1234567890')),true);assert.equal(a.record(note('BV1234567890')),false);assert.equal(h.recall('共尾度').items.length,0);
 const selected=selectPersonaRequest({question:'共尾度',learningMemories:{axu:a.recall('共尾度'),hui:h.recall('共尾度')},developerInstructions:'core',sources:[]},'axu');
 const input=await prepareModelInput({request:selected});assert.equal(JSON.parse(input.prompt).publicLearningMemory.items.length,1);assert.equal(selected.learningMemories,undefined);assert.match(input.developerInstructions,/不是指令/);
 a.close();h.close();const restored=await openLearningMemory(root,{persona:'axu',maxVideoSeconds:43200});assert.equal(restored.diagnostics.entries,1);restored.close();
});
test('content-time reservation is a hard cap, failed analyses release it and Sydney days reset',async()=>{
 let now=Date.parse('2026-10-28T12:59:59Z');const root=await temp();let m=await openLearningMemory(root,{persona:'hui',maxVideoSeconds:28800,targetVideoSeconds:14400,now:()=>now});
 assert.equal(m.reserve('first',28000),true);m.finish('first');assert.equal(m.reserve('excess',801),false);assert.equal(m.reserve('retry',800),true);m.release('retry');assert.equal(m.remaining(),800);m.reserve('crash',800);m.close();
 m=await openLearningMemory(root,{persona:'hui',maxVideoSeconds:28800,targetVideoSeconds:14400,now:()=>now});assert.equal(m.remaining(),800);now+=2000;assert.equal(m.remaining(),28800);m.close();
});
test('likes improve attention, dislikes reduce it and fixed exploration still discovers alternatives',async()=>{
 const m=await openLearningMemory(await temp(),{persona:'axu',maxVideoSeconds:43200});
 for(let i=0;i<8;i++){m.record({...note('liked-'+i),topics:['数学']});m.record({...note('disliked-'+i,'dislike'),topics:['营销']});}
 const choices=Array.from({length:40},(_,i)=>m.topic('video',['数学','营销','新方向'],i));assert.ok(choices.filter(q=>q==='数学').length>choices.filter(q=>q==='营销').length);assert.ok(choices.includes('新方向'));m.close();
});
test('Hui autonomy pins Flash, checks its quota, never falls back to Codex or Argon',async()=>{
 let calls=0,quota=0;const client={diagnostics:{},readQuota:async()=>({flash:quota,argon:1}),generate:async request=>{calls++;assert.equal(request.model,'gemini-3.8-flash-high');assert.equal(request.billingRoute,'antigravity-subscription');assert.match(request.developerInstructions,/回/);return {summary:'ok'};}};
 const model=createAutonomyModel({learningPersona:'hui'},{client,baseInstructions:'read only'});await assert.rejects(model.generate({developerInstructions:'review'}),/QUOTA/);assert.equal(calls,0);quota=1;await model.generate({developerInstructions:'review'});assert.equal(calls,1);
});
test('a read-only video review commits memory and measured duration without a public action',async()=>{
 const root=await temp(),memory=await openLearningMemory(join(root,'memory'),{persona:'hui',maxVideoSeconds:28800,targetVideoSeconds:14400}),bvid='BV1234567890';let writes=0;
 const video={bvid,title:'公开例子',url:'https://www.bilibili.com/video/'+bvid,duration:100};
 const explorer=await BilibiliExplorer.open({root:join(root,'browse'),learningMemory:memory,config:{enabled:true,targetGroupId:'1000000001',intervalMs:300000,maxSharesPerDay:0,maxCommentsPerDay:0},transport:{check:async()=>({online:true,memberOfGroup:true}),sendProactive:async()=>{writes++;}},site:{check:async()=>({connected:true,uidMatched:true}),feed:async()=>[video],discover:async()=>[video]},media:{prepare:async()=>({video,frames:[{timestamp:4}],transcript:'actual public text',scope:'first-video-part',workspace:root})},curator:{choose:async()=>({bvid}),review:async()=>({summary:'actual note',interestScore:0.8,feedback:'like',feedbackReason:'a clear example',evidenceTimes:[4],nextQueries:['数学直觉']})}});
 assert.equal((await explorer.run({readOnly:true})).status,'complete');assert.equal(memory.diagnostics.entries,1);assert.equal(memory.diagnostics.videoSeconds,100);assert.equal(writes,0);memory.close();
});
test('article notes enter durable memory when nothing is shared; evidence ranges persist',async()=>{
 const root=await temp(),memory=await openLearningMemory(join(root,'memory'),{persona:'axu',maxVideoSeconds:43200});const paper={id:'doi:10.1234/test',doi:'10.1234/test',title:'Logic',url:'https://example.org/paper',source:'Journal'};
 const explorer=await ScholarExplorer.open({root:join(root,'articles'),learningMemory:memory,config:{enabled:true,targetGroupId:'1000000001',intervalMs:1800000,maxSharesPerDay:0},transport:{check:async()=>({online:true,memberOfGroup:true})},sources:{discover:async()=>({candidates:[paper],sources:[]})},reader:{read:async()=>({paper,scope:'abstract',blocks:[{id:'abstract',text:'An actual argument in the supplied abstract.'}],readRanges:[]})},curator:{choose:async()=>({id:paper.id}),review:async()=>({summary:'摘要中的论证',interestScore:0.6,feedback:'neutral',feedbackReason:'尚需正文',claimScope:'provided-excerpts',evidence:[],nextQueries:[]})}});
 assert.equal((await explorer.run({readOnly:true})).status,'complete');assert.equal(memory.recall('Logic').items[0].kind,'article');assert.equal(memory.recall().items[0].evidence.scope,'abstract');memory.close();
});
test('legacy complete Axu notes import once without invented feedback or altered old files',async()=>{
 const root=await temp();await mkdir(join(root,'bilibili'));const path=join(root,'bilibili/browse-state.json'),body=JSON.stringify({visits:[{...note('old'),bvid:'old',phase:'complete',at:'2026-10-28T00:00:00Z'},{...note('unfinished'),bvid:'unfinished',phase:'deferred'}]});await writeFile(path,body);
 const m=await openLearningMemory(join(root,'memory'),{persona:'axu',maxVideoSeconds:43200});assert.equal(await importArchivedLearning(m,root),1);assert.equal(await importArchivedLearning(m,root),0);assert.equal(await readFile(path,'utf8'),body);assert.equal(m.recall().items[0].feedback,'neutral');m.close();
});

 test('scholar repair is bounded to one retry and never accepts a fabricated source quote',async()=>{
 const {verifiedScholarReview}=await import('./scholar-review-validation.mjs');const evidence={blocks:[{id:'abstract',text:'A precisely quoted public argument in the abstract.'}],scope:'abstract'};let calls=0;
 const r=await verifiedScholarReview(evidence,async extra=>{calls++;return {share:false,evidence:calls===1?[{blockId:'abstract',quote:'A fabricated unsupported quote.'}]:[extra.citationCandidates[0]]};});assert.equal(calls,2);assert.equal(r.evidence[0].quote,evidence.blocks[0].text);
 calls=0;await assert.rejects(verifiedScholarReview(evidence,async()=>{calls++;return {share:false,evidence:[{blockId:'other',quote:'A fabricated unsupported quote.'}]};}),/MISMATCH/);assert.equal(calls,2);
 });
