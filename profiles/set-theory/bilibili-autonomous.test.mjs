import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {BilibiliExplorer} from './bilibili-explorer.mjs';
import {createBilibiliSite,signBilibiliQuery} from './bilibili-site.mjs';
const BILIBILI_UID='4000000004';
import {createBilibiliMedia,sampleTimestamps} from './bilibili-media.mjs';
const bvid='BV1gfpV6SEWb',video={bvid,aid:1,cid:2,title:'集合论视频',url:'https://www.bilibili.com/video/'+bvid,duration:120,pages:[{page:1}]};
const config={enabled:true,targetGroupId:'1000000001',intervalMs:7200000,maxSharesPerDay:2,maxCommentsPerDay:1,commentsEnabled:true};
const frames=sampleTimestamps(120).map((timestamp,i)=>({path:'frame-'+i,timestamp}));
const evidence={video,frames,scope:'first-video-part',transcriptKind:'platform-subtitles',transcriptEnd:120,transcript:'[0-120] 这是集合论内容'};
async function fixture(overrides={}){
 const root=await mkdtemp(join(tmpdir(),'bilibili-explore-')),calls={choose:0,review:0,watch:0,comment:0,share:0};let now=1700000000000;
 const site={check:async()=>({connected:true,uidMatched:true}),discover:async()=>[video],related:async()=>[],feed:async()=>[],comment:async()=>{calls.comment++;return {rpid:'991',aid:1,bvid,submitted:true};},verifyComment:async()=>({verified:true})};
 const transport={check:async()=>({online:true,memberOfGroup:true}),sendProactive:async message=>{assert.equal(message.groupId,'1000000001');assert.ok(message.text.includes(video.url));calls.share++;return {ok:true,messageId:'992',verified:true};}};
 const media={prepare:async()=>{calls.watch++;return evidence;}};
 const curator={diagnostics:{model:'gpt-6.1-sol'},choose:async()=>{calls.choose++;return {bvid,reason:'集合论',nextQueries:['数理逻辑']};},review:async()=>{calls.review++;return {summary:'观察了实际画面和文字',interestScore:0.9,share:true,shareText:'这里的集合论例子值得讨论。',commentWorthwhile:true,comment:'0:30 这里的例子把集合包含关系说清楚了。',evidenceTimes:[30],nextQueries:['集合论 公理']};}};
 const options={root,site,transport,media,curator,config,now:()=>now,...overrides};const explorer=await BilibiliExplorer.open(options);
 return {root,site,transport,media,curator,options,explorer,calls,advance:()=>{now+=config.intervalMs+1;}};
}
test('autonomous browser actually watches before commenting and sharing, and persists real receipts',async()=>{
 const f=await fixture();assert.equal((await f.explorer.run()).status,'complete');assert.deepEqual(f.calls,{choose:1,review:1,watch:1,comment:1,share:1});
 const recent=f.explorer.diagnostics.recent[0];assert.equal(recent.frameCount,12);assert.equal(recent.comment.phase,'verified');assert.equal(recent.share.verified,true);
 const status=JSON.parse(await readFile(join(f.root,'browse-status.json'),'utf8'));assert.equal(status.busy,false);assert.equal(f.explorer.due,false);
 f.advance();await f.explorer.run();assert.equal(f.calls.comment,1);assert.equal(f.calls.share,1);
});
test('browser may decline a candidate and never treats metadata as a watched video',async()=>{
 const f=await fixture();f.curator.choose=async()=>({bvid:null,nextQueries:['不可数集合']});assert.equal((await f.explorer.run()).status,'no-interest');assert.equal(f.calls.watch,0);assert.equal(f.calls.comment,0);assert.equal(f.calls.share,0);
});
test('unknown selected video and invalid evidence timestamps cannot cause writes',async()=>{
 const a=await fixture();a.curator.choose=async()=>({bvid:'BV1111111111'});assert.equal((await a.explorer.run()).error,'CURATOR_UNKNOWN_VIDEO');assert.equal(a.calls.comment,0);
 const b=await fixture();b.curator.review=async()=>({summary:'invalid',interestScore:1,evidenceTimes:[999],share:true,commentWorthwhile:true});assert.equal((await b.explorer.run()).error,'CURATOR_REVIEW_INVALID');assert.equal(b.calls.share,0);assert.equal(b.calls.comment,0);
});
test('uncertain comments are not retried and do not prevent independent group sharing',async()=>{
 const f=await fixture();f.site.comment=async()=>{f.calls.comment++;throw Error('NETWORK_TIMEOUT');};await f.explorer.run();assert.equal(f.calls.comment,1);assert.equal(f.calls.share,1);assert.equal(f.explorer.diagnostics.recent[0].comment.phase,'uncertain');
 const again=await BilibiliExplorer.open(f.options);f.advance();await again.run();assert.equal(f.calls.comment,1);assert.equal(f.calls.share,1);
});
test('in-flight comment/share state survives restart without automatic resend',async()=>{
 const f=await fixture();await f.explorer.run();const path=join(f.root,'browse-state.json'),s=JSON.parse(await readFile(path,'utf8'));s.phase='posting';s.visits[0].comment={phase:'sending'};s.visits[0].share={phase:'sending'};await writeFile(path,JSON.stringify(s));
 const recovered=await BilibiliExplorer.open(f.options);assert.equal(recovered.diagnostics.recent[0].comment.phase,'uncertain_after_restart');assert.equal(recovered.diagnostics.recent[0].share.phase,'uncertain_after_restart');assert.equal(recovered.due,false);
});
test('missing login pauses before watching or writing, and target group cannot be changed by content',async()=>{
 const f=await fixture();f.site.check=async()=>({connected:false});assert.equal((await f.explorer.run()).status,'authorization-or-backoff');assert.equal(f.calls.watch,0);assert.equal(f.calls.share,0);
 await assert.rejects(BilibiliExplorer.open({...f.options,config:{...config,targetGroupId:'1000000003'}}),/UNAPPROVED_BROWSE_CONFIG/);
});
test('normal WBI signing is deterministic and strips disallowed parameter characters',()=>{
 const images={img_url:'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',sub_url:'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'};
 const signed=signBilibiliQuery({keyword:"集合论!'()",search_type:'video'},images,1700000000000),q=new URLSearchParams(signed);assert.equal(q.get('keyword'),'集合论');assert.equal(q.get('wts'),'1700000000');assert.match(q.get('w_rid'),/^[a-f0-9]{32}$/);assert.equal(signed,signBilibiliQuery({search_type:'video',keyword:"集合论!'()"},images,1700000000000));
});
test('comments require explicit host authorization and matching account, with no credential in URL',async()=>{
 const responses=[{code:0,data:{isLogin:true,mid:BILIBILI_UID}},{code:0,data:{...video,bvid}},{code:0,data:{rpid:99}}],calls=[];
 const options={expectedUid:BILIBILI_UID,vault:{get:async()=>({uid:BILIBILI_UID,cookies:'SESSDATA=private;bili_jct=secret'})},fetchFn:async(u,o)=>{calls.push({url:String(u),...o});return new Response(JSON.stringify(responses.shift()));}};
 await assert.rejects(createBilibiliSite(options).comment(video,'0:30 这里的集合论例子讲得清楚。'),/NOT_AUTHORIZED/);assert.equal(calls.length,0);
 const result=await createBilibiliSite({...options,allowComments:true}).comment(video,'0:30 这里的集合论例子讲得清楚。');assert.equal(result.submitted,true);assert.equal(calls.at(-1).method,'POST');assert.equal(calls.at(-1).body.get('csrf'),'secret');assert.ok(!calls.at(-1).url.includes('secret'));assert.match(calls.at(-1).body.get('message'),/^AI学习笔记：/);
});
test('platform rejection creates a backoff and never retries in a loop',async()=>{
 let n=0;const site=createBilibiliSite({expectedUid:BILIBILI_UID,vault:{get:async()=>({uid:BILIBILI_UID,cookies:'fixture'})},fetchFn:async()=>{n++;return new Response('',{status:412});}});
 await assert.rejects(site.check(),/RESTRICTION/);await assert.rejects(site.check(),/BACKOFF/);assert.equal(n,1);
});
test('actual-media layer samples the full time range, decodes audio, and uses ASR only when needed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bili-media-')),ops=[];
 const media=createBilibiliMedia({site:{metadata:async()=>video,subtitle:async()=>[],playback:async()=>({url:'https://test.bilivideo.com/file.mp4',bytes:100})},ffmpegPath:'ffmpeg-fixture',whisperPath:'whisper-fixture',whisperModelPath:'model',download:async()=>({bytes:Buffer.alloc(100)}),runProcess:async(binary,args)=>{ops.push({binary,args});if(binary==='whisper-fixture')await writeFile(args[args.indexOf('-of')+1]+'.json',JSON.stringify({transcription:[{offsets:{from:0,to:120000},text:'实际音频内容'}]}));else await writeFile(args.at(-1),Buffer.alloc(1000));}});
 const result=await media.prepare(bvid,root);assert.equal(result.frames.length,12);assert.equal(result.audioDecoded,true);assert.equal(result.transcriptKind,'local-whisper-asr');assert.equal(result.transcriptEnd,120);assert.ok(ops.some(x=>x.args.includes('pcm_s16le')));assert.equal(result.frameTimestamps.at(-1),115);assert.equal(result.wholeVideoViewed,false);
});

test('mention preemption defers an unwritten video and permits a later viewing retry',async()=>{
 const f=await fixture(),controller=new AbortController();f.media.prepare=async()=>{controller.abort();throw Error('ABORTED');};
 assert.equal((await f.explorer.run({signal:controller.signal})).status,'deferred-for-mentions');assert.equal(f.calls.comment,0);assert.equal(f.calls.share,0);const state=JSON.parse(await readFile(join(f.root,'browse-state.json'),'utf8'));assert.ok(!state.seen.includes(bvid));
});

test('curator uses the same high reasoning route and both six-frame batches with actual private schemas',async()=>{
 const {createBilibiliCurator}=await import('./bilibili-curator.mjs');const {mkdir}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'bili-curator-')),auth=join(root,'auth');await mkdir(auth);const access='fixture.'+Buffer.from(JSON.stringify({exp:4102444800})).toString('base64url')+'.fixture';await writeFile(join(auth,'auth.json'),JSON.stringify({tokens:{access_token:access,account_id:'fixture'}}));
 const calls=[],results=[{bvid,reason:'math',nextQueries:[]},{summary:'first six',observations:[{timestamp:5,observation:'visible example'}]},{summary:'all evidence',interestScore:0.8,share:true,shareText:'example',commentWorthwhile:false,comment:'',evidenceTimes:[5],nextQueries:[]}];
 const curator=createBilibiliCurator({codexPath:'fixture',authHome:auth,isolatedHome:join(root,'home')},{runTurn:async options=>{calls.push(options);return {finalResponse:JSON.stringify(results.shift())};}});
 await curator.choose({candidates:[video],interests:['集合论'],recent:[],workspace:root});await curator.review({...evidence,workspace:root});
 assert.equal(calls.length,3);for(const c of calls){assert.equal(c.model,'gpt-6.1-sol');assert.equal(c.reasoningEffort,'high');assert.equal(c.env.OPENAI_API_KEY,undefined);assert.equal(c.dynamicTools.length,0);assert.equal(c.outputSchema.additionalProperties,false);}
 assert.equal(calls[0].imagePaths.length,0);assert.equal(calls[1].imagePaths.length,6);assert.equal(calls[2].imagePaths.length,6);assert.ok(!calls[0].outputSchema.properties.status);assert.ok(JSON.parse(calls[2].prompt).taskData.priorVisualNotes.summary==='first six');
});

test('broad interests keep animation games music and daily-life anchors while learning new topics',async()=>{
 const f=await fixture({config:{...config,interestScope:'broad'}});await f.explorer.run();const i=f.explorer.diagnostics.interests;for(const topic of ['动画','游戏','音乐','生活日常'])assert.ok(i.includes(topic));assert.ok(i.includes('集合论 公理'));assert.equal(f.explorer.diagnostics.interestScope,'broad');
});
