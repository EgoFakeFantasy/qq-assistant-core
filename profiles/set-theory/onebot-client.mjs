import {readFile} from 'node:fs/promises';
export function createOneBotCaller({baseUrl,token,fetchFn=fetch}){
 const base=new URL(baseUrl);
 if(!['http:','https:'].includes(base.protocol)||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('LOOPBACK_ONEBOT_REQUIRED');
 if(typeof token!=='string'||token.length<24)throw Error('ONEBOT_TOKEN_REQUIRED');
 return async function call(action,params={},timeoutMs=2500){
  if(!/^[a-z_]+$/.test(action))throw Error('ONEBOT_ACTION_INVALID');
  const response=await fetchFn(new URL(action,base),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(params),signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
  if(!response.ok)throw Error('ONEBOT_HTTP_ERROR');
  const body=await response.json();if(body.retcode!==0||body.status!=='ok')throw Error('ONEBOT_ACTION_ERROR');return body.data;
 };
}
export async function oneBotImageSegments(images){
 if(!Array.isArray(images)||images.length>2)throw Error('IMAGE_SEND_LIMIT');
 return Promise.all(images.map(async image=>{
  if(!image||typeof image.path!=='string')throw Error('INVALID_OUTGOING_IMAGE');
  const bytes=await readFile(image.path);
  if(bytes.length>8*1024*1024||!(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes[0]===255&&bytes[1]===216))throw Error('INVALID_OUTGOING_IMAGE');
  return {type:'image',data:{file:'base64://'+bytes.toString('base64')}};
 }));
}
