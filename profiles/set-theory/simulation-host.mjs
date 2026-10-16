import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTeachingHub } from '../../src/app/teaching-hub.js';
import { runCodexAppServerTurn } from '../../src/codex-app-server-turn.js';

async function readJson(req) {
  const chunks=[];let length=0;
  for await(const chunk of req){length+=chunk.length;if(length>65536)throw new Error('BODY_LIMIT');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function listen(server){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return`http://127.0.0.1:${server.address().port}`;}
async function close(server){server.closeIdleConnections?.();await new Promise(resolve=>server.close(resolve));}

// This factory creates BOTH fake endpoints itself. No user-supplied QQ URL or
// Codex binary can be selected, so running it cannot accidentally reach live QQ.
export async function createSimulationHost({config,knowledge,runtimeRoot,autoDrain=true,fixtureBehavior='normal',failDelivery=false}) {
  const token=randomUUID(); const deliveries=[];const protocol=[];
  const fakeOneBot=createServer(async(req,res)=>{
    try {
      if(req.method!=='POST'||req.url!=='/send_group_msg'||req.headers.authorization!==`Bearer ${token}`){res.writeHead(403).end();return;}
      const body=await readJson(req);
      if(String(body.group_id)!==config.groupId)throw new Error('SCOPE');
      if(failDelivery){res.writeHead(503).end('{}');return;}
      deliveries.push(body);res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'ok',retcode:0,data:{message_id:deliveries.length}}));
    }catch{res.writeHead(400).end();}
  });
  const onebotUrl=await listen(fakeOneBot);
  let hub;
  try {
    hub=await createTeachingHub({config,knowledge,runtimeRoot,token,autoDrain,
      model:{kind:'mock',generate:async(request,{signal})=>{
        const result=await runCodexAppServerTurn({cwd:request.cwd,env:{SystemRoot:process.env.SystemRoot||''},model:request.model,
          reasoningEffort:request.reasoningEffort,prompt:JSON.stringify({...request,fixtureBehavior}),
          developerInstructions:request.developerInstructions,sandbox:'read-only',approvalPolicy:'never',ephemeral:true,dynamicTools:[],
          timeoutMs:5000,signal,
          spawnProcess:(_binary,args,options)=>{
            protocol.push({args,model:request.model,reasoningEffort:request.reasoningEffort,cwd:options.cwd,envKeys:Object.keys(options.env)});
            return spawn(process.execPath,[fileURLToPath(new URL('./fake-app-server.mjs',import.meta.url)),'--fixture-only'],options);
          }});
        return JSON.parse(result.finalResponse);
      }},
      transport:{kind:'mock',send:async message=>{
        const response=await fetch(onebotUrl+'/send_group_msg',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
          body:JSON.stringify({group_id:message.groupId,message:[{type:'reply',data:{id:message.replyTo}},{type:'text',data:{text:message.text}}]}),signal:AbortSignal.timeout(3000)});
        const body=await response.json();return{ok:response.ok&&body.retcode===0,messageId:body.data?.message_id};
      }}});
  }catch(error){await close(fakeOneBot);throw error;}
  let baseUrl;
  try{baseUrl=await hub.listen();}catch(error){await hub.close();await close(fakeOneBot);throw error;}
  return {baseUrl,token,deliveries,protocol,failures:hub.failures,bot:hub.bot,drain:()=>hub.drain(),
    close:async()=>{try{await hub.close();}finally{await close(fakeOneBot);}}};
}
