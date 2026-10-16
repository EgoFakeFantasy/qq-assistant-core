import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
let checked=0;
async function walk(path){for(const e of await readdir(path,{withFileTypes:true}).catch(()=>[])){if(['node_modules','private','__pycache__'].includes(e.name))continue;const p=join(path,e.name);if(e.isDirectory())await walk(p);else if(/\.(?:js|mjs)$/.test(e.name)){const r=spawnSync(process.execPath,['--check',p],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr||'SYNTAX_CHECK_FAILED');checked++;}}}
for(const path of ['profiles/set-theory','src','scripts','deployment'])await walk(join(root,path));
for(const path of ['package.json','profiles/set-theory/profile.json','config/assistant.example.json'])JSON.parse(await readFile(join(root,path),'utf8'));
console.log('Checked '+checked+' JavaScript files and public JSON configuration.');
