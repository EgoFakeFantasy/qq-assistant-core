import {readdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=(await readdir(new URL('../profiles/set-theory/',import.meta.url))).filter(x=>x.endsWith('.test.mjs')).sort().map(x=>'profiles/set-theory/'+x);
// Windows hosted runners may expose DOS 8.3 aliases in TEMP/TMP.
// Normalize only the test environment; production link checks remain strict.
const testTemporaryRoot=await realpath(tmpdir());
const testEnv={...process.env,...(process.platform==='win32'?{TEMP:testTemporaryRoot,TMP:testTemporaryRoot}:{TMPDIR:testTemporaryRoot})};
const child=spawn(process.execPath,['--test','--test-concurrency=1',...files],{cwd:root,env:testEnv,stdio:'inherit',windowsHide:true});
child.on('error',()=>{console.error('CORE_TEST_START_FAILED');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
