import {readdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const suite=process.argv[2];
const files=suite==='channels'?['test/qq-official.test.js','test/llbot-runtime.test.js','test/cognition-review.test.js','test/portable-channel.test.js']:suite==='operations'?(await readdir(new URL('../deployment/',import.meta.url))).filter(x=>x.endsWith('.test.mjs')).sort().map(x=>'deployment/'+x):null;
if(!files?.length)throw Error('UNKNOWN_OFFLINE_TEST_SUITE');
// Hosted Windows TEMP/TMP can be DOS 8.3 aliases. Canonicalize only child-test
// environment paths, retaining strict production symlink and state-root checks.
const temporaryRoot=await realpath(tmpdir());
const env={...process.env,...(process.platform==='win32'?{TEMP:temporaryRoot,TMP:temporaryRoot}:{TMPDIR:temporaryRoot})};
const child=spawn(process.execPath,['--test','--test-concurrency=1',...files],{cwd:root,env,stdio:'inherit',windowsHide:true});
child.on('error',()=>{console.error('OFFLINE_TEST_START_FAILED');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
