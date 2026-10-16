// Round-robin between autonomous interests. Both share the existing low-priority slot.
export function createBackgroundScheduler({workers,groupId,jobs,intervalMs=30000}){
 let cursor=0,closed=false;const controller=new AbortController();
 const names=Object.keys(jobs);
 function run(name,{manual=false}={}){
  const job=jobs[name];if(closed||!job||(!manual&&!job.due))return null;
  const task=workers.runBackground(groupId,({signal})=>job.run({signal:AbortSignal.any([signal,controller.signal]),manual}));
  if(task)cursor=(names.indexOf(name)+1)%names.length;return task;
 }
 function tick(){for(let i=0;i<names.length;i++){const name=names[(cursor+i)%names.length];if(jobs[name]?.due){const task=run(name);if(task){void task.catch(()=>{});break;}}}}
 const timer=setInterval(tick,intervalMs);timer.unref();const initial=setTimeout(tick,5000);initial.unref();
 return {run,tick,close(){closed=true;clearInterval(timer);clearTimeout(initial);controller.abort();}};
}
