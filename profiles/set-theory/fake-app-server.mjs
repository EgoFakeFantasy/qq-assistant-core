// Synthetic test process only. No OpenAI/QQ client, auth, shell or network imports.
import { createInterface } from 'node:readline';
if(process.argv[2]!=='--fixture-only')throw new Error('Fixture requires --fixture-only');
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);
  if(m.method==='initialize')send({id:m.id,result:{userAgent:'offline-fixture'}});
  if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'fixture-thread'}}});
  if(m.method==='turn/start'){
    const request=JSON.parse(m.params.input[0].text);
    send({id:m.id,result:{turn:{id:'fixture-turn',status:'inProgress',items:[]}}});
    if(request.fixtureBehavior==='fail'){
      send({method:'turn/completed',params:{threadId:'fixture-thread',turn:{id:'fixture-turn',status:'failed',error:{message:'Synthetic failure'},items:[]}}});return;
    }
    const text=JSON.stringify({status:'answer',text:'模拟协议回答：'+request.question,citations:request.sources.slice(0,1).map(s=>s.citation),
      model:m.params.model,reasoningEffort:m.params.effort,billingRoute:'chatgpt-plan'});
    const item={id:'fixture-answer',type:'agentMessage',phase:'final_answer',text};
    send({method:'item/completed',params:{threadId:'fixture-thread',turnId:'fixture-turn',item}});
    send({method:'turn/completed',params:{threadId:'fixture-thread',turn:{id:'fixture-turn',status:'completed',items:[item]}}});
  }
});
