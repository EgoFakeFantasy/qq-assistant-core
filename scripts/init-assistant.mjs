import {readFile,writeFile,mkdir,lstat,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const repository=fileURLToPath(new URL('../',import.meta.url));
const id=value=>typeof value==='string'&&/^\d{4,20}$/.test(value);
export async function initializeAssistant({root=repository,botId,groupIds,bilibiliUid=null,codexPath='codex',pythonPath='python',authHome=join(homedir(),'.codex')}={}){
 if(!id(botId)||!Array.isArray(groupIds)||!groupIds.length||groupIds.length>16||groupIds.some(x=>!id(x))||new Set(groupIds).size!==groupIds.length)throw Error('BOT_AND_UNIQUE_ALLOWED_GROUP_IDS_REQUIRED');
 if(bilibiliUid!==null&&!id(bilibiliUid))throw Error('INVALID_BILIBILI_UID');
 root=resolve(root);const privateRoot=join(root,'private');await mkdir(privateRoot,{recursive:true});
 if((await lstat(privateRoot)).isSymbolicLink())throw Error('LINKED_PRIVATE_ROOT');
 const configPath=join(privateRoot,'live-config.json');
 if(await lstat(configPath).catch(e=>{if(e.code!=='ENOENT')throw e;return null;}))throw Error('PRIVATE_CONFIG_ALREADY_EXISTS');
 const profile=JSON.parse(await readFile(join(repository,'profiles/set-theory/profile.json'),'utf8'));
 Object.assign(profile,{groupId:groupIds[0],botId,allowedGroupIds:groupIds,additionalGroups:groupIds.slice(1).map((groupId,i)=>({groupId,name:'Additional group '+(i+1)}))});
 profile.autonomousBilibili={...profile.autonomousBilibili,enabled:false,commentsEnabled:false,targetGroupId:groupIds[0]};
 const corpusRoot=join(privateRoot,'knowledge','corpus'),indexPath=join(privateRoot,'knowledge','pages.json');
 await mkdir(corpusRoot,{recursive:true});
 for(const [file,data] of [[join(corpusRoot,'manifest.json'),{version:1,books:[]}],[indexPath,{version:1,pages:[]}]]){
  try{await writeFile(file,JSON.stringify(data),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
 }
 const profilePath=join(privateRoot,'profile.json');
 await writeFile(profilePath,JSON.stringify(profile,null,2)+'\n',{flag:'wx',mode:0o600});
 const config={runtimeRoot:join(privateRoot,'runtime'),profilePath,corpusRoot,indexPath,pythonPath,codexPath,authHome:resolve(authHome),isolatedHome:join(privateRoot,'model-home'),oneBotBase:'http://127.0.0.1:3000/',oneBotToken:randomBytes(32).toString('hex'),hubToken:randomBytes(32).toString('hex'),webuiToken:randomBytes(24).toString('hex'),hubPort:3789,platformPanelPort:3791,bilibiliUid};
 await writeFile(configPath,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
 const network={network:{httpServers:[{name:'assistant-local',enable:true,host:'127.0.0.1',port:3000,enableCors:false,enableWebsocket:false,messagePostFormat:'array',token:config.oneBotToken,debug:false}],httpClients:[{name:'assistant-events',enable:true,url:'http://127.0.0.1:3789/api/onebot/event',messagePostFormat:'array',reportSelfMessage:false,token:config.hubToken,debug:false}],httpSseServers:[],websocketServers:[],websocketClients:[],plugins:[]},enableLocalFile2Url:false,parseMultMsg:false};
 const napcat=join(privateRoot,'napcat-config');await mkdir(napcat,{recursive:true});
 await writeFile(join(napcat,'onebot11_'+botId+'.json'),JSON.stringify(network,null,2)+'\n',{flag:'wx',mode:0o600});
 await writeFile(join(napcat,'webui.json'),JSON.stringify({host:'127.0.0.1',port:6099,token:config.webuiToken,loginRate:20},null,2)+'\n',{flag:'wx',mode:0o600});
 return {configPath,profilePath,napcatConfigDirectory:napcat,groupCount:groupIds.length,credentialsPrinted:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
 initializeAssistant({botId:value('--bot-id'),groupIds:value('--group-id')?.split(','),bilibiliUid:value('--bilibili-uid')||null,codexPath:value('--codex-path')||'codex',pythonPath:value('--python-path')||'python',authHome:value('--auth-home')||join(homedir(),'.codex')}).then(result=>console.log(JSON.stringify(result))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
