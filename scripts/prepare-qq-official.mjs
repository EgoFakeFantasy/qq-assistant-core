import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';

// Creates a NEW private config. Never updates the accepted OneBot live config.
export async function prepareOfficialRuntime({source,destination}){
  source=resolve(source);destination=resolve(destination);if(source===destination)throw Error('OFFICIAL_NEW_CONFIG_REQUIRED');
  const runtime=JSON.parse(await readFile(source,'utf8'));
  const profilePath=resolve(runtime.profilePath||fileURLToPath(new URL('../profiles/set-theory/profile.json',import.meta.url)));
  const profile=JSON.parse(await readFile(profilePath,'utf8'));
  const legacyPort=runtime.hubPort||3789;if(!Number.isInteger(legacyPort)||legacyPort<1||legacyPort>=65535)throw Error('OFFICIAL_PORT_REQUIRED');
  const value={...runtime,transport:'qq-official',profilePath,legacyRuntimeRoot:resolve(runtime.runtimeRoot),legacyHubPort:legacyPort,
    runtimeRoot:resolve(runtime.runtimeRoot)+'-official',hubPort:legacyPort+1,hubToken:randomBytes(32).toString('hex'),
    qqOfficial:{appId:'',groups:(profile.allowedGroupIds||[profile.groupId]).map(groupId=>({groupId,openid:'',botMemberOpenid:'',allowProactive:false}))}};
  for(const k of ['oneBotBase','oneBotToken','webuiToken','appSecret'])delete value[k];
  await mkdir(dirname(destination),{recursive:true,mode:0o700});
  await writeFile(destination,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  return {prepared:true,activated:false,groups:value.qqOfficial.groups.map(g=>g.groupId),profilePreserved:true,memberMemoryAutoMerged:false,requiresAppId:true,requiresAppSecretEnvironment:true,requiresGroupBindings:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),source=args[args.indexOf('--source')+1],destination=args[args.indexOf('--destination')+1];
  if(!args.includes('--source')||!args.includes('--destination')||!source||!destination)throw Error('Use --source EXISTING_PRIVATE_CONFIG --destination NEW_PRIVATE_CONFIG');
  try{console.log(JSON.stringify(await prepareOfficialRuntime({source,destination})));}catch(e){console.error(JSON.stringify({prepared:false,code:e.code==='EEXIST'?'OFFICIAL_CONFIG_ALREADY_EXISTS':'OFFICIAL_PREPARATION_FAILED'}));process.exitCode=1;}
}
