import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicSearch} from './public-search.mjs';
import {choosePublicTopics,publicTopicLabels} from './public-topics.mjs';
import {createLiveOneBot} from './live-onebot.mjs';

test('public lookup emits only fixed vocabulary and refuses non-public input before network',async()=>{
 const urls=[];
 const api=createPublicSearch({}, {fetchFn:async(url,options)=>{
  urls.push(String(url));assert.equal(options.redirect,'error');
  return new Response(JSON.stringify(url.hostname==='en.wikipedia.org'?{query:{pages:{1:{title:'Measurable cardinal',extract:'A nonprincipal complete ultrafilter.'}}}}:{message:{items:[{title:['Fixture reference'],DOI:'10.1234/fixture'}]}}),{status:200,headers:{'content-type':'application/json'}});
 }});
 const secret='私人群内容 1234567890 C:/private/password.txt';
 const ids=choosePublicTopics('请搜索可测基数。'+secret);
 assert.deepEqual(ids,['measurable']);assert.deepEqual(publicTopicLabels(ids),['measurable cardinals']);
 const result=await api.lookup(ids);assert(result.sources.length>=1);assert(urls.every(u=>!u.includes('1234567890')&&!u.includes('private')&&!u.includes('password')));
 const before=urls.length;await assert.rejects(api.lookup(['私人群内容']),/NON_PUBLIC/);assert.equal(urls.length,before);
 await api.lookup(ids);assert.equal(urls.length,before);
});
test('no public results fails explicitly instead of inventing a citation',async()=>{
 const api=createPublicSearch({}, {fetchFn:async()=>new Response(JSON.stringify({}),{status:200})});
 await assert.rejects(api.lookup(['measurable']),/NO_PUBLIC_SEARCH_RESULTS/);
});
test('last OneBot boundary removes escaped and fullwidth bold markers',async()=>{
 const writes=[];
 const transport=createLiveOneBot({baseUrl:'http://127.0.0.1:3000/',token:'x'.repeat(32),groupId:'1000000001',botId:'2000000002',fetchFn:async(url,options)=>{
  const action=new URL(url).pathname;
  const data=action==='/get_login_info'?{user_id:2000000002}:action==='/get_group_list'?[{group_id:1000000001}]:{message_id:55};
  if(action==='/send_group_msg')writes.push(JSON.parse(options.body));
  return new Response(JSON.stringify({status:'ok',retcode:0,data}),{status:200});
 }});
 await transport.send({groupId:'1000000001',replyTo:'123',text:'**正文** \\*\\*甲\\*\\* ＊＊乙＊＊ 2*3=6'});
 const text=writes[0].message[1].data.text;assert.doesNotMatch(text,/\*\*|\\\*|＊＊/);assert.match(text,/2\*3=6/);
});