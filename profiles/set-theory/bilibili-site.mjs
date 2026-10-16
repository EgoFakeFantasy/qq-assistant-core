import {applyExpressionPolicy} from './expression-policy.mjs';
import {createHash} from 'node:crypto';
import {plainHtml,publicQuery} from './public-fetch.mjs';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';
const MIX=[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const clean=s=>plainHtml(String(s||'')).slice(0,240);
export function signBilibiliQuery(params,images,now=Date.now()){
 const key=['img_url','sub_url'].map(k=>new URL(images[k]).pathname.split('/').at(-1).split('.')[0]).join('');
 if(key.length!==64)throw Error('BILIBILI_SIGNING_KEY_INVALID');
 const mix=MIX.map(i=>key[i]).join('').slice(0,32),fields={...params,wts:Math.floor(now/1000)};
 const query=Object.keys(fields).sort().map(k=>encodeURIComponent(k)+'='+encodeURIComponent(String(fields[k]).replace(/[!'()*]/g,''))).join('&');
 return query+'&w_rid='+createHash('md5').update(query+mix).digest('hex');
}
export function normalizeVideo(row){
 if(!/^BV[A-Za-z0-9]{10}$/.test(row?.bvid||''))return null;
 const d=row.duration;const duration=typeof d==='string'&&d.includes(':')?d.split(':').reduce((n,x)=>n*60+Number(x),0):Number(d||0);
 return {bvid:row.bvid,aid:Number(row.aid||row.id)||null,title:clean(row.title),author:clean(row.owner?.name||row.author),category:clean(row.tname||row.typename),description:clean(row.desc||row.description),duration:Number.isFinite(duration)?duration:0,url:'https://www.bilibili.com/video/'+row.bvid};
}
export function createBilibiliSite({vault,fetchFn=fetch,now=Date.now,allowComments=false,allowLikes=false,expectedUid=null}={}){
 const BILIBILI_UID=expectedUid===null?null:String(expectedUid);
 if(BILIBILI_UID!==null&&!/^\d{4,20}$/.test(BILIBILI_UID))throw Error('INVALID_BILIBILI_UID');
 let credential=null,credentialAt=0,signing=null,signingAt=0,signingTask=null;
 const diagnostics={requests:0,commentsSubmitted:0,commentsVerified:0,likesSubmitted:0,blockedUntil:0,lastError:null};
 async function credentials(){if(!BILIBILI_UID)throw Error('BILIBILI_UID_NOT_CONFIGURED');if(credential&&now()-credentialAt<120000)return credential;const c=await vault.get('bilibili');if(c?.uid!==BILIBILI_UID||typeof c.cookies!=='string')throw Error(c?'WRONG_BILIBILI_ACCOUNT':'BILIBILI_LOGIN_REQUIRED');credential=c;credentialAt=now();return c;}
 async function api(path,params={},options={}){
  if(!/^\/x\/[a-zA-Z0-9/_-]+$/.test(path))throw Error('BILIBILI_PATH_DENIED');
  if(now()<diagnostics.blockedUntil)throw Error('BILIBILI_BACKOFF_ACTIVE');
  const c=await credentials(),url=new URL('https://api.bilibili.com'+path);
  if(options.signed){if(!signing||now()-signingAt>600000){if(!signingTask)signingTask=api('/x/web-interface/nav',{}, {...options,signed:false}).then(d=>{signing=d.wbi_img;signingAt=now();}).finally(()=>{signingTask=null;});await signingTask;}url.search=signBilibiliQuery(params,signing,now());}
  else for(const[k,v]of Object.entries(params))url.searchParams.set(k,String(v));
  const headers={'user-agent':UA,referer:'https://www.bilibili.com/',cookie:c.cookies};
  let body;if(options.post){url.search='';const csrf=c.cookies.split(';').map(x=>x.trim()).find(x=>x.startsWith('bili_jct='))?.slice(9);if(!csrf)throw Error('BILIBILI_CSRF_REQUIRED');body=new URLSearchParams({...params,csrf});headers['content-type']='application/x-www-form-urlencoded';}
  diagnostics.requests++;
  const r=await fetchFn(url,{method:body?'POST':'GET',headers,body,redirect:'error',signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
  if([401,403,412,429].includes(r.status)){diagnostics.blockedUntil=now()+1800000;diagnostics.lastError='BILIBILI_PLATFORM_RESTRICTION';throw Error(diagnostics.lastError);}
  if(!r.ok)throw Error('BILIBILI_UNAVAILABLE');const text=await r.text();if(text.length>2*1024*1024)throw Error('BILIBILI_RESPONSE_LIMIT');let d;try{d=JSON.parse(text);}catch{throw Error('BILIBILI_INVALID_RESPONSE');}
  if(d.code!==0){const actionDenied=options.post&&d.code===-403,restricted=[-101,-111,-352,-403,-412,-509,12002,12051,12015].includes(d.code);diagnostics.lastError=actionDenied?'BILIBILI_ACTION_DENIED':restricted?'BILIBILI_VERIFICATION_OR_RATE_LIMIT':'BILIBILI_API_ERROR';diagnostics.lastApiCode=Number(d.code);if(restricted&&!actionDenied)diagnostics.blockedUntil=now()+1800000;throw Object.assign(Error(diagnostics.lastError),{apiCode:Number(d.code)});}
  return d.data;
 }
 async function metadata(bvid,options={}){if(!/^BV[A-Za-z0-9]{10}$/.test(bvid))throw Error('INVALID_VIDEO_ID');const d=await api('/x/web-interface/view',{bvid},options);if(d.bvid!==bvid)throw Error('VIDEO_ID_MISMATCH');return {...normalizeVideo(d),cid:Number(d.cid),duration:Number(d.pages?.[0]?.duration||d.duration),totalDuration:Number(d.duration),pages:(d.pages||[]).map(p=>({cid:Number(p.cid),page:p.page,title:clean(p.part),duration:Number(p.duration)})),description:String(d.desc||'').slice(0,6000)};}
 async function likeStatus(bvid,options={}){if(!/^BV[A-Za-z0-9]{10}$/.test(bvid))throw Error('INVALID_VIDEO_ID');const data=await api('/x/web-interface/archive/has/like',{bvid},options);if(data!==0&&data!==1)throw Error('LIKE_STATUS_INVALID');return {bvid,liked:data===1,verified:true};}
 return {diagnostics,metadata,likeStatus,
  async comments(bvid,options={}){const v=await metadata(bvid,options);const d=await api('/x/v2/reply',{oid:v.aid,type:1,pn:1,ps:8,sort:2},options);return (d.replies||[]).slice(0,8).map(r=>({text:plainHtml(String(r.content?.message||'')).slice(0,600),likes:Number(r.like)||0}));},
  async like(video,options={}){if(!allowLikes)throw Error('BILIBILI_LIKES_NOT_AUTHORIZED');const d=await api('/x/web-interface/nav',{},options);if(!d.isLogin||String(d.mid)!==BILIBILI_UID)throw Error('WRONG_BILIBILI_ACCOUNT');const v=await metadata(video.bvid,options);if(v.aid!==video.aid)throw Error('VIDEO_ID_MISMATCH');if((await likeStatus(v.bvid,options)).liked)return {bvid:v.bvid,aid:v.aid,liked:true,alreadyLiked:true,verified:true};options.signal?.throwIfAborted();await api('/x/web-interface/archive/like',{aid:v.aid,like:1},{...options,post:true});diagnostics.likesSubmitted++;const check=await likeStatus(v.bvid,options);return {...check,aid:v.aid,submitted:true};},
  async check(options={}){const d=await api('/x/web-interface/nav',{},options),c=await credentials();return {connected:d.isLogin===true&&String(d.mid)===BILIBILI_UID,uidMatched:String(d.mid)===BILIBILI_UID,authRevision:Number.isFinite(Date.parse(c.createdAt))?new Date(c.createdAt).toISOString():null};},
  async discover(query,options={}){const d=await api('/x/web-interface/wbi/search/type',{search_type:'video',keyword:publicQuery(query),page:Math.max(1,Math.min(5,Number(options.page)||1)),page_size:10,order:options.order==='pubdate'?'pubdate':'totalrank'}, {...options,signed:true});return (d.result||[]).map(normalizeVideo).filter(Boolean).slice(0,10);},
  async feed(options={}){const d=await api('/x/web-interface/wbi/index/top/feed/rcmd',{ps:8,fresh_type:3,pn:1}, {...options,signed:true});return (d.item||[]).map(normalizeVideo).filter(Boolean).slice(0,8);},
  async related(bvid,options={}){if(!/^BV[A-Za-z0-9]{10}$/.test(bvid))throw Error('INVALID_VIDEO_ID');const d=await api('/x/web-interface/archive/related',{bvid},options);return (d||[]).map(normalizeVideo).filter(Boolean).slice(0,8);},
  async subtitle(video,options={}){const d=await api('/x/player/wbi/v2',{bvid:video.bvid,cid:video.cid},{...options,signed:true});const sub=d.subtitle?.subtitles?.find(x=>/^zh/.test(x.lan))||d.subtitle?.subtitles?.[0];if(!sub?.subtitle_url)return [];
   const u=new URL(sub.subtitle_url.startsWith('//')?'https:'+sub.subtitle_url:sub.subtitle_url);if(u.protocol!=='https:'||!/(^|\.)hdslb\.com$/.test(u.hostname)||u.username||u.password)throw Error('SUBTITLE_ORIGIN_DENIED');
   const r=await fetchFn(u,{redirect:'error',signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});if(!r.ok)throw Error('SUBTITLE_UNAVAILABLE');const text=await r.text();if(text.length>2*1024*1024)throw Error('SUBTITLE_LIMIT');return (JSON.parse(text).body||[]).filter(s=>Number.isFinite(s.from)&&Number.isFinite(s.to)).slice(0,5000).map(s=>({from:s.from,to:s.to,text:String(s.content||'').slice(0,1000)}));},
  async playback(video,options={}){const d=await api('/x/player/wbi/playurl',{bvid:video.bvid,cid:video.cid,qn:32,fnval:1,fnver:0,fourk:0,platform:'html5'},{...options,signed:true});const parts=(d.durl||[]).map(x=>({url:x.url,bytes:Number(x.size)||0,lengthMs:Number(x.length)||0}));if(parts.length!==1)throw Error('VIDEO_STREAM_NOT_SINGLE_FILE');return parts[0];},
  async comment(video,text,options={}){if(!allowComments)throw Error('BILIBILI_COMMENTS_NOT_AUTHORIZED');if(typeof text!=='string')throw Error('COMMENT_CONTENT_DENIED');text=applyExpressionPolicy(text).trim();if(text.length<6||text.length>400||/[\u0000-\u001f]|https?:\/\/|@|加群|私信|关注我/.test(text))throw Error('COMMENT_CONTENT_DENIED');const check=await api('/x/web-interface/nav',{},options);if(!check.isLogin||String(check.mid)!==BILIBILI_UID)throw Error('WRONG_BILIBILI_ACCOUNT');const trusted=await metadata(video.bvid,options);if(trusted.aid!==video.aid)throw Error('VIDEO_ID_MISMATCH');const result=await api('/x/v2/reply/add',{oid:trusted.aid,type:1,message:'AI学习笔记：'+text.trim(),plat:1},{...options,post:true});diagnostics.commentsSubmitted++;const id=String(result?.rpid||result?.reply?.rpid||'');if(!/^\d+$/.test(id))throw Error('COMMENT_RECEIPT_MISSING');return {rpid:id,aid:trusted.aid,bvid:trusted.bvid,submitted:true,verified:false,contentHash:createHash('sha256').update('AI学习笔记：'+text.trim()).digest('hex')};},
  async verifyComment(receipt,options={}){const d=await api('/x/v2/reply/detail',{oid:receipt.aid,type:1,root:receipt.rpid},options);const row=d.root;if(String(row?.rpid)!==receipt.rpid||String(row?.member?.mid)!==BILIBILI_UID||receipt.contentHash&&createHash('sha256').update(String(row?.content?.message||'')).digest('hex')!==receipt.contentHash)return {verified:false};diagnostics.commentsVerified++;return {verified:true,rpid:receipt.rpid};}
 };
}
