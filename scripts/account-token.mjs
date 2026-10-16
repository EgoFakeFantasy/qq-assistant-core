import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createWindowsVault} from '../profiles/set-theory/account-vault.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const at=process.argv.indexOf('--config');
const c=JSON.parse(await readFile(at<0?join(root,'private/live-config.json'):resolve(process.argv[at+1]),'utf8'));
const vault=createWindowsVault(join(c.runtimeRoot,'..','credentials','platforms'));
let panel=await vault.get('platform-panel');if(!panel){panel={token:randomBytes(32).toString('hex')};await vault.set('platform-panel',panel);}
// Explicit local operator command. Never expose this through chat tools or log collectors.
console.log(panel.token);
