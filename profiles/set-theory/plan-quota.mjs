import {spawn} from 'node:child_process';
import {runtimeEnv} from './live-model.mjs';
import {resolveInstalledCodex} from './codex-path.mjs';
import {codexQuotaSnapshot} from './provider-policy.mjs';
export function createPlanQuotaReader({codexPath,authHome,spawnProcess=spawn,now=Date.now,ttlMs=60000}){
 let cache=null,pending=null,checkedAt=0;
 async function read(){
  const executable=spawnProcess===spawn?await resolveInstalledCodex(codexPath):codexPath;
  return new Promise(resolve=>{
   let child,buffer='',done=false;const timer=setTimeout(()=>finish({state:'unknown',remaining:null}),15000);
   function finish(v){if(done)return;done=true;clearTimeout(timer);child?.kill();resolve(v);}
   try{child=spawnProcess(executable,['app-server','--stdio'],{env:runtimeEnv(authHome),windowsHide:true,stdio:['pipe','pipe','pipe']});}catch{return finish({state:'unknown',remaining:null});}
   child.on('error',()=>finish({state:'unknown',remaining:null}));child.on('exit',()=>finish({state:'unknown',remaining:null}));child.stdin.on('error',()=>finish({state:'unknown',remaining:null}));child.stderr.resume();child.stdout.setEncoding('utf8');
   child.stdout.on('data',s=>{buffer+=s;if(buffer.length>1000000)return finish({state:'unknown',remaining:null});let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let v;try{v=JSON.parse(line);}catch{continue;}
    if(v.id===1){if(v.error)return finish({state:'unknown',remaining:null});child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');child.stdin.write(JSON.stringify({id:2,method:'account/rateLimits/read',params:{}})+'\n');}
    if(v.id===2)return finish(v.error?{state:'unknown',remaining:null}:codexQuotaSnapshot(v.result,now()));
   }});
   child.stdin.write(JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'qq_quota_reader',title:'QQ quota reader',version:'1'}}})+'\n');
  });
 }
 return async()=>{if(cache&&now()-checkedAt<ttlMs)return cache;if(!pending)pending=read().then(v=>{cache=v;checkedAt=now();return v;}).finally(()=>pending=null);return pending;};
}
