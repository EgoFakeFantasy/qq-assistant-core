import { readFile,mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSimulationHost } from './simulation-host.mjs';
import { createKnowledgeBase } from './knowledge.mjs';
if(process.argv[2]!=='--once')throw new Error('Only --once is supported; no persistent service is installed.');
const config=JSON.parse(await readFile(new URL('./profile.json',import.meta.url),'utf8'));
const root=await mkdtemp(join(tmpdir(),'qq-local-once-'));
const host=await createSimulationHost({config,knowledge:createKnowledgeBase(),runtimeRoot:root,autoDrain:false});
try{
  const payload={post_type:'message',message_type:'group',group_id:config.groupId,self_id:config.botId,user_id:'12345678',message_id:'local-fixture-1',
    message:[{type:'at',data:{qq:config.botId}},{type:'text',data:{text:'解释序数和基数的区别'}}]};
  const response=await fetch(host.baseUrl+'/api/onebot/event',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${host.token}`},body:JSON.stringify(payload)});
  if(response.status!==202)throw new Error('SIMULATION_INGRESS_FAILED');await host.drain();
  const success=host.bot.diagnostics.receipts.length===1&&host.bot.diagnostics.receipts[0].delivered===true;
  console.log(JSON.stringify({mode:'simulation',success,realQQMessages:0,realModelCalls:0,mockChildProcesses:host.protocol.length,mockDeliveries:host.deliveries.length,persistentAutoStart:false}));
  if(!success)process.exitCode=1;
}finally{await host.close();}
