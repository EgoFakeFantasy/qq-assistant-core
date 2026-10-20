import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {replayMemory} from '../../scripts/replay-memory.mjs';
test('private chronological replay deduplicates, excludes current sources and never calls services',async()=>{
 const root=await mkdtemp(join(tmpdir(),'synthetic-memory-replay-'));await mkdir(join(root,'private'));
 const input=join(root,'private/events.jsonl'),at=Date.parse('2026-10-21T00:00:00Z');
 const row=(n,text)=>({groupId:'1000000001',senderId:'3000000003',messageId:String(n),text,at:at+n});
 const rows=[row(1,'我喜欢通过反例理解拓扑空间'),row(2,'随便聊几句'),row(3,'聊一聊今天的学习'),row(4,'拓扑空间的反例')];
 await writeFile(input,[...rows,rows[0]].map(x=>JSON.stringify(x)).join('\n'));
 const report=await replayMemory({root,input,outDir:'private/replay',botId:'2000000002'});
 assert.equal(report.groups[0].events,4);assert.equal(report.groups[0].queriesWithRecall,1);
 assert.equal(report.groups[0].scopeLeaks,0);assert.equal(report.groups[0].sourceLeaks,0);
 assert.equal(report.modelCalls+report.networkCalls+report.qqSends,0);assert.equal(report.autoApply,false);
 const body=await readFile(join(root,'private/replay/report.json'),'utf8');assert(!body.includes('我喜欢'));
 await assert.rejects(replayMemory({root,input,outDir:'private/replay',botId:'2000000002'}),/EEXIST/);
 await assert.rejects(replayMemory({root,input,outDir:'outside',botId:'2000000002'}),/PRIVATE_OUTPUT_REQUIRED/);
});
