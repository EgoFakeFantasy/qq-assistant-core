import {createBilibiliSite} from './bilibili-site.mjs';
import {createHash} from 'node:crypto';
import {plainHtml} from './public-fetch.mjs';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';
const origins=new Set(['passport.bilibili.com','api.bilibili.com','developer.zhihu.com']);
export function createPlatformAccounts({vault,fetchFn=fetch,now=Date.now,enableZhihu=false,expectedUid=null}={}){
 const UID=expectedUid===null?null:String(expectedUid);
 if(UID!==null&&!/^\d{4,20}$/.test(UID))throw Error('INVALID_BILIBILI_UID');
 let pending=null,lastPoll=0;
 const readOnlySite=createBilibiliSite({vault,fetchFn,now,expectedUid:UID});
 const diagnostics={bilibiliConnected:false,zhihuConfigured:false,requests:0,readOnly:true};
 async function json(url,{headers={},signal,...options}={}){
  const u=new URL(url);if(u.protocol!=='https:'||!origins.has(u.hostname)||u.username||u.password)throw Error('PLATFORM_ORIGIN_DENIED');
  diagnostics.requests++;const r=await fetchFn(u,{...options,headers:{'user-agent':UA,...headers},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  if([401,403,412,429].includes(r.status))throw Error('PLATFORM_LOGIN_OR_RATE_LIMIT');
  if(!r.ok)throw Error('PLATFORM_UNAVAILABLE');const body=await r.text();if(body.length>2*1024*1024)throw Error('PLATFORM_RESPONSE_LIMIT');
  try{return {data:JSON.parse(body),headers:r.headers};}catch{throw Error('PLATFORM_INVALID_JSON');}
 }
 async function bili(path,params={},options={}){
  if(!UID)throw Error('BILIBILI_UID_NOT_CONFIGURED');
  const c=await vault.get('bilibili');if(!c)throw Error('BILIBILI_LOGIN_REQUIRED');if(c.uid!==UID)throw Error('WRONG_BILIBILI_ACCOUNT');
  const u=new URL('https://api.bilibili.com'+path);for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);
  const {data}=await json(u,{...options,headers:{cookie:c.cookies,referer:'https://www.bilibili.com/'}});
  if(data.code!==0)throw Error('BILIBILI_LOGIN_OR_SERVICE_ERROR');return data.data;
 }
 const safe=s=>plainHtml(String(s||'')).slice(0,180);
 return {diagnostics,
 async status(){return {bilibili:{configured:Boolean(await vault.get('bilibili')),connected:diagnostics.bilibiliConnected,expectedUid:UID},zhihu:{enabled:enableZhihu,configured:enableZhihu&&Boolean(await vault.get('zhihu')),displayName:'Example User',officialApi:true},readOnly:true};},
 async startBilibili(){
  if(!UID)throw Error('BILIBILI_UID_NOT_CONFIGURED');
  if(pending&&now()-pending.created<180000)return {url:pending.url,expiresAt:pending.created+180000};
  const {data}=await json('https://passport.bilibili.com/x/passport-login/web/qrcode/generate');
  if(data.code!==0)throw Error('BILIBILI_LOGIN_UNAVAILABLE');
  const u=new URL(data.data.url);if(u.protocol!=='https:'||!['passport.bilibili.com','account.bilibili.com'].includes(u.hostname)||typeof data.data.qrcode_key!=='string')throw Error('UNTRUSTED_LOGIN_QR');
  pending={url:u.href,key:data.data.qrcode_key,created:now()};lastPoll=0;return {url:pending.url,expiresAt:pending.created+180000};
 },
 async pollBilibili(){
  if(!pending&&diagnostics.bilibiliConnected)return {phase:'connected',uid:UID};
  if(!pending||now()-pending.created>180000){pending=null;return {phase:'expired'};}
  if(now()-lastPoll<2500)return {phase:'waiting'};lastPoll=now();
  const u=new URL('https://passport.bilibili.com/x/passport-login/web/qrcode/poll');u.searchParams.set('qrcode_key',pending.key);
  const {data,headers}=await json(u);if(data.code!==0)throw Error('BILIBILI_LOGIN_UNAVAILABLE');const s=data.data;
  if(s.code===86101)return {phase:'waiting'};if(s.code===86090)return {phase:'scanned'};if(s.code===86038){pending=null;return {phase:'expired'};}
  if(s.code!==0)throw Error('BILIBILI_VERIFICATION_REQUIRED');
  const cookies=new Map((headers.getSetCookie?.()||[]).map(s=>{const p=s.split(';')[0],at=p.indexOf('=');return[p.slice(0,at),p.slice(at+1)];}));
  if(!cookies.has('SESSDATA')||!cookies.has('DedeUserID'))throw Error('BILIBILI_SESSION_MISSING');
  if(cookies.get('DedeUserID')!==UID){pending=null;throw Error('WRONG_BILIBILI_ACCOUNT');}
  const cookie=[...cookies].filter(([k])=>['SESSDATA','bili_jct','DedeUserID','DedeUserID__ckMd5','sid'].includes(k)).map(([k,v])=>k+'='+v).join('; ');
  await vault.set('bilibili',{uid:UID,cookies:cookie,createdAt:new Date(now()).toISOString()});pending=null;diagnostics.bilibiliConnected=true;return {phase:'connected',uid:UID};
 },
 async checkBilibili(){try{const d=await bili('/x/web-interface/nav');diagnostics.bilibiliConnected=d.isLogin===true&&String(d.mid)===UID;return {connected:diagnostics.bilibiliConnected};}catch{diagnostics.bilibiliConnected=false;return {connected:false,requiresAuthorization:true};}},
 async setZhihu(secret){if(!enableZhihu)throw Error('ZHIHU_DISABLED');if(typeof secret!=='string'||secret.length<16||secret.length>4096||/[\r\n]/.test(secret))throw Error('INVALID_ZHIHU_ACCESS_SECRET');await vault.set('zhihu',{accessSecret:secret,createdAt:new Date(now()).toISOString()});diagnostics.zhihuConfigured=true;return {configured:true,verified:false};},
 async searchBilibili(query,options={}){
  try{const rows=await readOnlySite.discover(query,options);return {sources:rows.map(x=>({...x,id:'bili-'+x.bvid,text:x.description,kind:'video-search-metadata'}))};}
  catch(e){if(/RESTRICTION|VERIFICATION|BACKOFF/.test(e.message))throw Error('PLATFORM_LOGIN_OR_RATE_LIMIT');throw e;}
 },
 async readBilibili(bvid,options={}){
  if(!/^BV[A-Za-z0-9]{10}$/.test(bvid))throw Error('INVALID_VIDEO_ID');
  const info=await bili('/x/web-interface/view',{bvid},options);let text=String(info.desc||'').slice(0,5000),kind='video-description',segments=[];
  let sub=null;try{const p=await bili('/x/player/v2',{bvid,cid:info.cid},options);sub=p.subtitle?.subtitles?.find(x=>/^zh/.test(x.lan))||p.subtitle?.subtitles?.[0];}catch{}
  if(sub?.subtitle_url){
   const u=new URL(sub.subtitle_url.startsWith('//')?'https:'+sub.subtitle_url:sub.subtitle_url);
   if(u.protocol==='https:'&&(u.hostname==='hdslb.com'||u.hostname.endsWith('.hdslb.com'))&&!u.username&&!u.password){
    const r=await fetchFn(u,{redirect:'error',signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
    if(r.ok){const body=await r.text();if(body.length<1024*1024){const s=JSON.parse(body);segments=(s.body||[]).slice(0,180).map(x=>({from:x.from,to:x.to,text:String(x.content||'').slice(0,500)}));text=segments.map(x=>'['+x.from+'-'+x.to+'] '+x.text).join('\n').slice(0,14000);if(segments.length)kind='video-subtitles';}}
   }
  }
  return {id:'bili-'+bvid,bvid,title:safe(info.title),url:'https://www.bilibili.com/video/'+bvid,text,segments,kind,contentStatus:kind==='video-subtitles'?'partial':'metadata-only',scope:'first-video-part',videoViewed:false};
 },
 async searchZhihu(query,options={}){
  if(!enableZhihu)throw Error('ZHIHU_DISABLED');
  const c=await vault.get('zhihu');if(!c)throw Error('ZHIHU_AUTHORIZATION_REQUIRED');
  const u=new URL('https://developer.zhihu.com/api/v1/content/zhihu_search');u.searchParams.set('Query',query);
  const {data}=await json(u,{signal:options.signal,headers:{authorization:'Bearer '+c.accessSecret,'X-Request-Timestamp':String(Math.floor(now()/1000))}});
  const rows=Array.isArray(data.data)?data.data:Array.isArray(data.data?.items)?data.data.items:Array.isArray(data.items)?data.items:null;
  if(!rows)throw Error('ZHIHU_RESPONSE_REQUIRES_REVIEW');
  return {sources:rows.slice(0,5).flatMap((x,i)=>{let u;try{u=new URL(x.url||x.link);}catch{return [];}if(u.protocol!=='https:'||!(u.hostname==='zhihu.com'||u.hostname.endsWith('.zhihu.com')))return [];return[{id:'zhihu-'+createHash('sha256').update(u.href).digest('hex').slice(0,16),title:safe(x.title||x.question?.title),url:u.href,text:plainHtml(x.excerpt||x.content||'').slice(0,8000),kind:'platform-search-result'}];})};
 }
 };
}
