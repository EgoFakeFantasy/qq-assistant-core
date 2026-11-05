import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {probeLLBot} from '../profiles/set-theory/llbot-runtime.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function llbotHealth(){
 const m=JSON.parse(await readFile(join(root,'private/llbot/deployment.json'),'utf8'));
 if(m.version!==1||m.bridge!=='llbot'||!/^\d{4,20}$/.test(m.account)||resolve(m.runtimePath)!==resolve(root,'private/llbot/live-config.json')||!resolve(m.dataRoot).startsWith(resolve(root,'private/llbot')+'/')&&!resolve(m.dataRoot).startsWith(resolve(root,'private/llbot')+'\\'))throw Error('LLBOT_MANIFEST_INVALID');
 const runtime=JSON.parse(await readFile(m.runtimePath,'utf8'));const webuiToken=await readFile(join(m.dataRoot,'webui_token.txt'),'utf8');
 const profile=JSON.parse(await readFile(runtime.profilePath,'utf8'));if(profile.botId!==m.account)throw Error('LLBOT_ACCOUNT_MISMATCH');
 return probeLLBot({runtime,profile,webuiToken,webuiPort:m.webuiPort});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await llbotHealth()));}catch{console.log(JSON.stringify({bridge:'llbot',qqOnline:false,allGroupsVerified:false,code:'LLBOT_HEALTH_UNAVAILABLE'}));process.exitCode=1;}
}
