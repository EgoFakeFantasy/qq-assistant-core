import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=(await readdir(new URL('../profiles/set-theory/',import.meta.url))).filter(x=>x.endsWith('.test.mjs')).sort().map(x=>'profiles/set-theory/'+x);
const child=spawn(process.execPath,['--test','--test-concurrency=1',...files],{cwd:root,stdio:'inherit',windowsHide:true});
child.on('error',()=>{console.error('CORE_TEST_START_FAILED');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
