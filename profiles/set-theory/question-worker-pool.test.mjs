import test from 'node:test';
import assert from 'node:assert/strict';
import {QuestionWorkerPool} from './question-worker-pool.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<100;i++){if(check())return;await tick();}assert.fail('worker did not reach expected state');}
function fixture(groups,options={}){
 const started=[],running=new Map(),errors=[],queues=new Map();
 const scopes=new Map(groups.map((jobs,index)=>{
  const groupId=String(index),queue=jobs.map(([messageId,mandatory=true])=>({messageId,mandatory,senderId:messageId}));
  queues.set(groupId,queue);return [groupId,{config:{groupId},bot:{peekJob:()=>queue[0]||null,startNext:()=>{
   const job=queue.shift(),key=groupId+':'+job.messageId;started.push(key);
   return new Promise((resolve,reject)=>running.set(key,{resolve,reject}));
  }}}];
 }));
 const pool=new QuestionWorkerPool(scopes,{concurrency:3,perGroup:2,optional:1,onError:e=>errors.push(e),...options});
 const finish=async()=>{for(let i=0;i<100;i++){for(const [key,task] of running){running.delete(key);task.resolve();}await tick();if(!pool.diagnostics.active)break;}};
 return {pool,started,running,errors,finish,enqueue:(group,id,mandatory=true)=>queues.get(String(group)).push({messageId:id,senderId:id,mandatory})};
}
test('global and per-group limits permit three independent jobs before completion',async()=>{
 const f=fixture([[['a'],['b'],['c']],[['d'],['e']]]);
 const drained=f.pool.drain();assert.equal(f.started.length,3);assert.equal(f.pool.diagnostics.active,3);
 assert.equal(f.started.filter(k=>k.startsWith('0:')).length,2);
 f.running.get('1:d').resolve();f.running.delete('1:d');await until(()=>f.started.length===4);
 assert.equal(f.started[3],'1:e');assert.equal(f.pool.diagnostics.active,3);
 await f.finish();await drained;assert.equal(f.started.length,5);assert.equal(new Set(f.started).size,5);
});
test('mandatory mentions take priority and optional work occupies at most one slot',async()=>{
 const f=fixture([[['a',false],['b',false]],[['c',true]],[['d',true]],[['e',false]]]);
 const drained=f.pool.drain();assert.deepEqual(f.started.slice(0,2),['1:c','2:d']);assert.equal(f.pool.diagnostics.activeOptional,1);
 f.running.get('1:c').resolve();f.running.delete('1:c');await until(()=>f.pool.diagnostics.active===2);
 assert.equal(f.started.length,3);assert.equal(f.pool.diagnostics.activeOptional,1);
 await f.finish();await drained;assert.equal(f.started.length,5);
});
test('pause finishes active jobs but preserves queued jobs until resume',async()=>{
 const f=fixture([[['a'],['b'],['c']]],{concurrency:1,perGroup:1});
 const drained=f.pool.drain();f.pool.pause();await f.finish();await drained;
 assert.deepEqual(f.started,['0:a']);assert.equal(f.pool.diagnostics.paused,true);
 const resumed=f.pool.resume();await f.finish();await resumed;assert.equal(f.started.length,3);
});
test('one rejected task releases its slot and does not stop other jobs',async()=>{
 const f=fixture([[['a'],['b']]],{concurrency:1,perGroup:1});
 const drained=f.pool.drain();f.running.get('0:a').reject(Error('fixture'));f.running.delete('0:a');
 await until(()=>f.started.length===2);await f.finish();await drained;assert.equal(f.errors.length,1);assert.equal(f.pool.diagnostics.active,0);
});

test('background browsing uses a spare optional slot and yields to queued questions',async()=>{
 const f=fixture([[['a']],[['b']]],{concurrency:3,perGroup:2});
 assert.equal(f.pool.runBackground('0',async()=>{}),null);
 const drained=f.pool.drain();let done;
 const browse=f.pool.runBackground('0',()=>new Promise(resolve=>{done=resolve;}));
 assert.ok(browse);await tick();assert.equal(f.pool.diagnostics.active,3);assert.equal(f.pool.diagnostics.activeBackground,1);assert.equal(f.pool.runBackground('1',async()=>{}),null);
 done();await browse;await f.finish();await drained;assert.equal(f.pool.diagnostics.active,0);
});

test('a fresh mention reclaims a running background slot without interrupting normal replies',async()=>{
 const f=fixture([[['a']],[['b']]]);const drained=f.pool.drain();let signal;
 const background=f.pool.runBackground('0',options=>new Promise(resolve=>{signal=options.signal;signal.addEventListener('abort',resolve,{once:true});}));await tick();
 f.enqueue(1,'c');f.pool.drain();await background;await until(()=>f.started.length===3);assert.equal(signal.aborted,true);assert.equal(f.pool.diagnostics.activeBackground,0);assert.deepEqual(f.started,['0:a','1:b','1:c']);
 await f.finish();await drained;
});

test('a ready non-mention reply reclaims the optional background slot',async()=>{
 const f=fixture([[]]);let signal;const background=f.pool.runBackground('0',options=>new Promise(resolve=>{signal=options.signal;signal.addEventListener('abort',resolve,{once:true});}));await tick();
 f.enqueue(0,'casual',false);const drained=f.pool.drain();await background;await until(()=>f.started.length===1);assert.equal(signal.aborted,true);assert.deepEqual(f.started,['0:casual']);await f.finish();await drained;
});
