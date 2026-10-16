import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createBilibiliSite} from './bilibili-site.mjs';
import {BilibiliExplorer} from './bilibili-explorer.mjs';
import {createBackgroundScheduler} from './background-scheduler.mjs';
const uid='4000000004',bv='BV1234567890',v={bvid:bv,aid:2,cid:3,title:'test',duration:120,url:'https://www.bilibili.com/video/'+bv,pages:[]};
const vault={get:async()=>({uid,cookies:'SESSDATA=fixture;bili_jct=fixture'})};
function likeSite({already=false,allow=true,wrong=false}={}){
 let liked=already,posts=0;const urls=[];
 const site=createBilibiliSite({vault,expectedUid:uid,allowLikes:allow,fetchFn:async(u,o)=>{
  urls.push(String(u));assert.ok(!String(u).includes('fixture'));let data;
  if(u.pathname.endsWith('/nav'))data={mid:wrong?'4999999999':uid,isLogin:true};
  else if(u.pathname.endsWith('/view'))data=v;
  else if(u.pathname.endsWith('/has/like'))data=Number(liked);
  else if(u.pathname.endsWith('/archive/like')){assert.equal(o.method,'POST');assert.equal(o.body.get('csrf'),'fixture');assert.equal(o.body.get('like'),'1');liked=true;posts++;data={};}
  else throw Error('UNEXPECTED_ENDPOINT');
  return new Response(JSON.stringify({code:0,data}));
 }});
 return {site,posts:()=>posts,urls};
}
test('likes verify account and target, post CSRF in body, and read back liked state',async()=>{
 const f=likeSite();const r=await f.site.like(v);assert.equal(r.verified,true);assert.equal(r.liked,true);assert.equal(f.posts(),1);
 await f.site.like(v);assert.equal(f.posts(),1);
 const existing=likeSite({already:true});assert.equal((await existing.site.like(v)).alreadyLiked,true);assert.equal(existing.posts(),0);
});
test('likes fail closed without authorization, with wrong identity, or mismatched video',async()=>{
 await assert.rejects(likeSite({allow:false}).site.like(v),/NOT_AUTHORIZED/);
 await assert.rejects(likeSite({wrong:true}).site.like(v),/WRONG_BILIBILI_ACCOUNT/);
 await assert.rejects(likeSite().site.like({...v,aid:999}),/VIDEO_ID_MISMATCH/);
});
async function explorerFixture(overrides={}){
 const root=await mkdtemp(join(tmpdir(),'bili-multi-')),videos=[v,{...v,bvid:'BV1234567891',url:'https://www.bilibili.com/video/BV1234567891'}],calls={like:0,watch:0,comment:0,share:0,modes:[]};
 const site={check:async()=>({connected:true,uidMatched:true}),feed:async()=>{calls.modes.push('feed');return videos;},related:async()=>{calls.modes.push('related');return videos;},discover:async()=>{calls.modes.push('search');return videos;},like:async()=>{calls.like++;return {liked:true,verified:true};},likeStatus:async()=>({liked:true,verified:true})};
 const media={prepare:async bvid=>{calls.watch++;return {video:videos.find(v=>v.bvid===bvid),frames:[],transcriptKind:'fixture'};}};
 const curator={choose:async({candidates})=>({bvid:candidates[0].bvid}),review:async()=>({summary:'actual fixture content',interestScore:0.9,like:true,continueBrowsing:true,browseMode:'related',evidenceTimes:[12],share:false,commentWorthwhile:false,nextQueries:['animation']})};
 const config={enabled:true,targetGroupId:'1000000001',intervalMs:1800000,maxVideosPerCycle:2,maxSharesPerDay:2,maxCommentsPerDay:3,maxLikesPerDay:12,likesEnabled:true,commentsEnabled:true};
 const options={root,site,media,curator,config,transport:{check:async()=>({online:true,memberOfGroup:true})},...overrides};return {...options,calls,options,explorer:await BilibiliExplorer.open(options)};
}
test('a browse cycle follows its own related-video choice and can watch several without sharing',async()=>{
 const f=await explorerFixture();const r=await f.explorer.run();assert.equal(r.completed,2);assert.equal(f.calls.watch,2);assert.equal(f.calls.like,2);assert.deepEqual(f.calls.modes,['feed','related']);assert.equal(f.calls.share,0);
});
test('model may stop early independently of social quotas',async()=>{
 const f=await explorerFixture();const review=f.curator.review;f.curator.review=async()=>({...await review(),continueBrowsing:false});assert.equal((await f.explorer.run()).completed,1);assert.equal(f.calls.watch,1);
});
test('uncertain likes remain recorded across restart and are not blindly posted again',async()=>{
 const f=await explorerFixture();f.site.like=async()=>{f.calls.like++;throw Error('NETWORK_TIMEOUT');};await f.explorer.run();assert.equal(f.calls.like,2);
 const path=join(f.root,'browse-state.json'),state=JSON.parse(await readFile(path,'utf8'));state.seen=[];await writeFile(path,JSON.stringify(state));f.site.likeStatus=async()=>({liked:false,verified:true});
 const again=await BilibiliExplorer.open(f.options);await again.run({manual:true});assert.equal(f.calls.like,2);
});
test('background scheduler rotates due providers and does not bypass a busy question pool',async()=>{
 const calls=[],jobs=Object.fromEntries(['bilibili','scholar'].map(k=>[k,{due:true,run:async()=>calls.push(k)}]));let busy=false;
 const scheduler=createBackgroundScheduler({groupId:'1000000001',jobs,intervalMs:100000,workers:{runBackground(_id,fn){if(busy)return null;return Promise.resolve(fn({signal:new AbortController().signal}));}}});
 try{scheduler.tick();await new Promise(setImmediate);scheduler.tick();await new Promise(setImmediate);assert.deepEqual(calls,['bilibili','scholar']);busy=true;scheduler.tick();await new Promise(setImmediate);assert.equal(calls.length,2);}finally{scheduler.close();}
});
