import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildLLBotConfig} from '../profiles/set-theory/llbot-runtime.mjs';

export async function prepareLLBot({projectRoot,vendorRoot}){
  projectRoot=resolve(projectRoot);vendorRoot=resolve(vendorRoot);
  const vendorRelative=relative(join(projectRoot,'private','llbot','vendor'),vendorRoot);
  if(!vendorRelative||vendorRelative.startsWith('..')||isAbsolute(vendorRelative))throw Error('LLBOT_VENDOR_OUTSIDE_PRIVATE_ROOT');
  const root=join(projectRoot,'private','llbot'),runtime=JSON.parse(await readFile(join(projectRoot,'private','live-config.json'),'utf8'));
  const profile=JSON.parse(await readFile(runtime.profilePath,'utf8'));
  const llRoot=join(vendorRoot,'bin','llbot'),dataRoot=join(llRoot,'data');
  const pkg=JSON.parse(await readFile(join(llRoot,'package.json'),'utf8'));if(pkg.version!=='8.3.2')throw Error('LLBOT_VERSION_MISMATCH');
  const defaults=JSON.parse(await readFile(join(llRoot,'default_config.json'),'utf8'));
  const config=buildLLBotConfig({runtime,profile,defaults});
  const newRuntime={...runtime,transport:'onebot',oneBotImplementation:'llbot'};
  const runtimePath=join(root,'live-config.json');try{await access(runtimePath);throw Error('LLBOT_ALREADY_PREPARED');}catch(e){if(e.code!=='ENOENT')throw e;}
  await mkdir(dataRoot,{recursive:true});
  await writeFile(join(dataRoot,'config_'+profile.botId+'.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(join(dataRoot,'webui_token.txt'),randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});
  await writeFile(runtimePath,JSON.stringify(newRuntime,null,2)+'\n',{flag:'wx',mode:0o600});
  const manifest={version:1,bridge:'llbot',account:profile.botId,vendorRoot,llRoot,dataRoot,runtimePath,webuiPort:3080,mode:'pmhq',forwardEvents:false,autoStart:false};
  await writeFile(join(root,'deployment.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return {prepared:true,activated:false,account:profile.botId,profilePreserved:true,memoryRootPreserved:true,forwardEvents:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await prepareLLBot({projectRoot:process.argv[2]||fileURLToPath(new URL('../',import.meta.url)),vendorRoot:process.argv[3]})));}catch(e){console.error(JSON.stringify({prepared:false,code:e.message.startsWith('LLBOT_')?e.message:'LLBOT_PREPARATION_FAILED'}));process.exitCode=1;}
}
