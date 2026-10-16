import process from 'node:process';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rename,lstat,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';

export function createWindowsVault(directory,{run=runProtected}={}){
  directory=resolve(directory);
  const path=name=>{if(!['bilibili','zhihu','platform-panel'].includes(name))throw Error('UNKNOWN_ACCOUNT');return join(directory,name+'.dpapi');};
  async function check(file){await mkdir(directory,{recursive:true});if(resolve(await realpath(directory))!==directory)throw Error('LINKED_VAULT');const s=await lstat(file).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});if(s&&(!s.isFile()||s.isSymbolicLink()||s.size>65536))throw Error('UNSAFE_CREDENTIAL_FILE');return s;}
  return {async get(name){const file=path(name);if(!await check(file))return null;const body=await readFile(file,'utf8');return JSON.parse(await run('decrypt',body));},
    async set(name,value){const file=path(name);await check(file);const cipher=await run('encrypt',JSON.stringify(value));const tmp=file+'.'+randomUUID()+'.pending';await writeFile(tmp,cipher,{flag:'wx',mode:0o600});await rename(tmp,file);}};
}
function runProtected(mode,input){
  if(process.platform!=='win32')return Promise.reject(Error('WINDOWS_DPAPI_REQUIRED'));
  const common="$ErrorActionPreference='Stop';$inputText=[Console]::In.ReadToEnd();";
  const code=mode==='encrypt'?common+"$secure=ConvertTo-SecureString $inputText -AsPlainText -Force;try{[Console]::Write((ConvertFrom-SecureString $secure))}finally{$secure.Dispose();$inputText=$null}":common+"$secure=ConvertTo-SecureString $inputText;$ptr=[IntPtr]::Zero;try{$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr))}finally{if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)};$secure.Dispose();$inputText=$null}";
  return new Promise((done,fail)=>{let output='',ended=false;const win=process.env.SystemRoot||'C:\\Windows';const child=spawn(join(win,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{env:{...process.env,PSModulePath:join(win,'System32','WindowsPowerShell','v1.0','Modules')},windowsHide:true,stdio:['pipe','pipe','pipe']});
    const timer=setTimeout(()=>finish(false),15000);function finish(ok){if(ended)return;ended=true;clearTimeout(timer);if(!ok)child.kill();ok?done(output.trim()):fail(Error('PROTECTED_STORAGE_FAILED'));}
    child.stderr.resume();child.stdout.setEncoding('utf8');child.stdout.on('data',s=>{output+=s;if(output.length>65536)finish(false);});child.on('error',()=>finish(false));child.on('exit',code=>finish(code===0));child.stdin.on('error',()=>finish(false));child.stdin.end(input);});
}
