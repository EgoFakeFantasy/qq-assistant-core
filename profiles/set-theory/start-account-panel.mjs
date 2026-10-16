import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import QRCode from 'qrcode';
import {createWindowsVault} from './account-vault.mjs';
import {createPlatformAccounts} from './platform-accounts.mjs';
import {createAccountPanel} from './account-panel.mjs';
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const at=process.argv.indexOf('--config');
const runtime=JSON.parse(await readFile(at<0?join(root,'private/live-config.json'):resolve(process.argv[at+1]),'utf8'));
const vault=createWindowsVault(join(runtime.runtimeRoot,'..','credentials','platforms'));
let panel=await vault.get('platform-panel');if(!panel){panel={token:randomBytes(32).toString('hex')};await vault.set('platform-panel',panel);}
const accounts=createPlatformAccounts({vault,expectedUid:runtime.bilibiliUid});
const app=createAccountPanel({accounts,token:panel.token,toQR:text=>QRCode.toDataURL(text,{width:260,margin:2}),port:runtime.platformPanelPort||3791,browseStatus:async()=>{try{return JSON.parse(await readFile(join(runtime.runtimeRoot,'bilibili/browse-status.json'),'utf8'));}catch{return {enabled:false};}}});
await app.listen();console.log(JSON.stringify({started:true,port:runtime.platformPanelPort||3791,loopbackOnly:true,tokenCommand:'npm run accounts:token'}));
for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>app.close().finally(()=>process.exit()));
