import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean);
const denied=/(?:^|\/)(?:private|node_modules|__pycache__|\.venv)\/|\.(?:pdf|dpapi|sqlite(?:3)?|db|log|zip|7z|mp4|wav)$/i;
const secret=/(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const failures=[];
for(const path of files){if(denied.test(path))failures.push({path,reason:'private-or-generated-file'});const bytes=await readFile(path);if(bytes.length<2000000&&!bytes.includes(0)&&secret.test(bytes.toString('utf8')))failures.push({path,reason:'credential-shaped-content'});}
console.log(JSON.stringify({trackedFiles:files.length,findings:failures},null,2));
if(failures.length)process.exitCode=1;
