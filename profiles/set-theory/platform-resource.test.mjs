import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourceSession} from './resource-session.mjs';
test('Bilibili access restrictions use public topic search without a second platform attempt',async()=>{
 let calls=0,query='';
 const s=createResourceSession({request:{question:'推荐集合论视频',context:[],sources:[]},runtime:{autonomousPublicSearch:true,resources:{list:async()=>[]},platformAccounts:{searchBilibili:async()=>{calls++;throw Error('PLATFORM_LOGIN_OR_RATE_LIMIT');}},webResources:{search:async q=>{query=q;return{sources:[{id:'web-fixture',url:'https://www.bilibili.com/video/BV1234567890',title:'课程',text:'公开搜索片段'}]};}}}});
 const r=await s.call({tool:'bilibili_search',query:'集合论'},{});assert.equal(calls,1);assert.equal(query,'site:bilibili.com/video/ 集合论');assert.equal(r.data.publicSearchFallback,true);assert.equal(r.data.sources[0].bvid,'BV1234567890');
});
test('model cannot request a video id that was not returned in this research session',async()=>{
 let reads=0;const s=createResourceSession({request:{question:'集合论',context:[],sources:[]},runtime:{autonomousPublicSearch:true,resources:{list:async()=>[]},platformAccounts:{readBilibili:async()=>{reads++;}}}});
 const r=await s.call({tool:'bilibili_read',bookId:'bili-BV1234567890'},{});assert.equal(r.data.error,'UNKNOWN_VIDEO_SEARCH_RESULT');assert.equal(reads,0);
});
