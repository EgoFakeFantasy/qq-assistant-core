import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
export function createAccountPanel({accounts,token,toQR,port=3791,browseStatus=async()=>({enabled:false}),scholarStatus=async()=>({enabled:false})}){
 if(typeof token!=='string'||token.length<32)throw Error('PANEL_TOKEN_REQUIRED');
 const origin='http://127.0.0.1:'+port;
 const server=createServer(async(req,res)=>{
  const reply=(code,data)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
  if(req.headers.host!=='127.0.0.1:'+port||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){reply(403,{error:'LOCAL_ONLY'});return;}
  if(req.method==='GET'&&req.url==='/'){
   const nonce=randomBytes(18).toString('base64');res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-"+nonce+"'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'referrer-policy':'no-referrer'});
   res.end(html.replace('SCRIPT_NONCE',nonce));return;
  }
  const auth=req.headers.authorization||'',expected='Bearer '+token;
  if(Buffer.byteLength(auth)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(auth),Buffer.from(expected))||(req.headers.origin&&req.headers.origin!==origin)){reply(403,{error:'LOCAL_AUTH_REQUIRED'});return;}
  try{
   if(req.method==='GET'&&req.url==='/api/status'){const account=await accounts.status(),browse=await browseStatus(),scholar=await scholarStatus();reply(200,{...account,autonomousScholar:scholar,readOnly:!browse.commentsEnabled&&!browse.likesEnabled,accountToolsReadOnly:account.readOnly,autonomousBrowsing:browse});return;}
   if(req.method==='GET'&&req.url==='/api/scholar/browse'){reply(200,await scholarStatus());return;}
   if(req.method==='GET'&&req.url==='/api/bilibili/browse'){reply(200,await browseStatus());return;}
   if(req.method!=='POST'||req.headers['content-type']!=='application/json'){reply(405,{error:'POST_JSON_REQUIRED'});return;}
   let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>8192){reply(413,{error:'REQUEST_LIMIT'});req.destroy();return;}}
   const body=JSON.parse(text||'{}');
   if(req.url==='/api/bilibili/start'){const qr=await accounts.startBilibili();reply(200,{qr:await toQR(qr.url),expiresAt:qr.expiresAt});}
   else if(req.url==='/api/bilibili/poll')reply(200,await accounts.pollBilibili());
   else if(req.url==='/api/bilibili/check')reply(200,await accounts.checkBilibili());
   else if(req.url==='/api/zhihu/connect')reply(403,{error:'ZHIHU_DISABLED'});
   else reply(404,{error:'UNKNOWN_OPERATION'});
  }catch(e){reply(400,{error:/^[A-Z_]+$/.test(e.message)?e.message:'ACCOUNT_OPERATION_FAILED'});}
 });
 server.requestTimeout=20000;server.headersTimeout=10000;
 return {server,async listen(){await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);});return origin;},async close(){server.closeAllConnections();if(server.listening)await new Promise(done=>server.close(done));}};
}
const html=String.raw`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>群助手 · 资料账号</title>
<style>body{font:16px system-ui;background:#f3f6fa;color:#1e293b;max-width:760px;margin:48px auto;padding:0 24px}section{background:white;border-radius:16px;padding:24px;margin:20px 0;box-shadow:0 6px 24px #14223a0a}h1{font-size:28px}h2{font-size:21px}button,a{cursor:pointer}button{background:#265ac5;color:white;border:0;border-radius:8px;padding:11px 18px;margin:6px 8px 6px 0}input{padding:12px;width:90%;border:1px solid #cbd5e1;border-radius:8px}small{color:#64748b}#qr{display:none;width:260px;height:260px}#status,#bstate,#zstate{white-space:pre-wrap}a{color:#265ac5}</style>
<h1>群助手 · 资料账号</h1><p>在本机授权资料读取与自主浏览。账号凭据加密保存在当前 Windows 用户下，不发送到 QQ 群或问答模型。</p>
<section><h2>B站</h2><p>目标账号以本机配置为准</p><button id="bstart">显示登录二维码</button><button id="bcheck">检查已保存会话</button><p><img id="qr" alt="B站登录二维码"></p><p id="bstate">扫码后请在 B站手机端确认账号。</p><small>群内即时查询可搜索视频、读取简介和字幕；自主浏览使用实际视频画面、音频文本，再决定是否发表评论并分享到配置的分享群。可按本机设置自主点赞与评论。</small></section>
<section><h2>AI 自主逛 B站</h2><p id="browse">正在读取后台状态…</p><div id="visits"></div><small>兴趣涵盖数学、动画、游戏、音乐和日常。按后台配置连续探索推荐、相关视频和公开搜索；点赞、评论和分享均由它自行判断，可选择不发；群内问答优先。视听分析使用12个采样画面和字幕或本地音频转写，不将抽样说成逐帧完整观看。评论标注“AI学习笔记”。</small></section>
<section><h2>自主阅读论文</h2><p id="scholar">正在读取…</p><div id="papers"></div><small>发现 arXiv 预印本和期刊新作，尽量阅读公开正文；记录具体来源和阅读页段后决定是否推荐。</small></section>
<section><h2>知乎</h2><p>按你的选择，本版本暂未启用知乎。当前只接入 B站。</p></section>
<section><h2>状态</h2><button id="refresh">刷新状态</button><p id="status">正在读取…</p><small>会话被平台撤销或要求验证码时暂停，请在对应平台完成验证。保存成功不等于线上接口已验证。</small></section>
<script nonce="SCRIPT_NONCE">
let token=location.hash.slice(1);if(token.startsWith('token='))token=token.slice(6);if(token){sessionStorage.setItem('accountPanelToken',token);history.replaceState(null,'','/');}else token=sessionStorage.getItem('accountPanelToken')||'';
let poll=null;const el=id=>document.getElementById(id);
async function api(path,body){const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw Error(data.error||'操作失败');return data;}
async function refresh(){try{const s=await api('status');el('status').textContent='B站：'+(s.bilibili.configured?'已保存加密会话':'未登录')+'\n知乎：本版本未启用';renderBrowse(s.autonomousBrowsing);renderScholar(s.autonomousScholar);}catch(e){el('status').textContent=e.message;}}
function renderBrowse(s){
 if(!s?.enabled){el('browse').textContent='自主浏览尚未启动。';return;}
 const phase={ready:'等待下次浏览',discovering:'正在发现视频',watching:'正在解码视频和读取音频',reviewing:'正在分析画面和内容',posting:'正在发表评论',sharing:'正在分享到群',failed:'本次未完成',interrupted:'上次被中断，稍后继续','no-candidate':'暂无新候选','no-interest':'暂未挑到有兴趣的视频','authorization-or-backoff':'账号验证或平台退避中','deferred-for-mentions':'已让位群内问答，稍后继续'};
 el('browse').textContent=(phase[s.phase]||s.phase)+'\n兴趣：'+(s.interests||[]).join('、')+'\n下次检查：'+(s.nextRunAt?new Date(s.nextRunAt).toLocaleString():'稍后')+(s.lastError?'\n状态：'+s.lastError:'')+(Object.keys(s.actionPauses||{}).length?'\n操作暂停：'+Object.keys(s.actionPauses).map(k=>k==='like'?'点赞':k==='comment'?'评论':k).join('、')+'（平台拒绝，请正常验证账号后重新授权）':'');
 el('visits').replaceChildren();for(const v of [...(s.recent||[])].reverse()){const p=document.createElement('p'),a=document.createElement('a');a.textContent=v.title;a.href='https://www.bilibili.com/video/'+v.bvid;a.target='_blank';a.rel='noopener noreferrer';p.append(a,document.createTextNode('\n'+(v.summary||'尚未完成分析')+'\n画面：'+(v.frameCount||0)+' 张，传入模型：'+(v.visualFramesSupplied??'历史轮次未记录')+' 张；音频文本：'+(v.transcriptKind||'待获取')+'；点赞：'+(v.like?.phase||'未操作')+'；评论：'+(v.comment?.phase||'未发送')+'；群分享：'+(v.share?.phase||'未发送')));p.style.whiteSpace='pre-wrap';el('visits').append(p);}
}
function renderScholar(s){el('scholar').textContent=s?.enabled?(s.phase+' · 每轮最多 '+s.maxPapersPerCycle+' 篇 · 每天最多推荐 '+s.maxSharesPerDay+' 篇\n兴趣：'+(s.interests||[]).join('、')+(s.lastError?'\n'+s.lastError:'')):'学术浏览尚未启用';el('papers').replaceChildren();for(const v of [...(s?.recent||[])].reverse()){const p=document.createElement('p'),a=document.createElement('a');a.textContent=v.title;a.href=v.url;a.target='_blank';a.rel='noopener noreferrer';p.append(a,document.createTextNode('\n'+(v.summary||'正在阅读')+'\n'+(v.source||'')+' · '+(v.scope||'待获取')+' · 分享：'+(v.share?.phase||'未请求')));p.style.whiteSpace='pre-wrap';el('papers').append(p);}}
el('refresh').onclick=refresh;
el('bstart').onclick=async()=>{clearInterval(poll);try{const r=await api('bilibili/start',{});el('qr').src=r.qr;el('qr').style.display='block';el('bstate').textContent='请使用目标账号扫码并确认。';const end=r.expiresAt;poll=setInterval(async()=>{if(Date.now()>end){clearInterval(poll);el('bstate').textContent='二维码已过期，请按需重新生成。';return;}try{const s=await api('bilibili/poll',{});el('bstate').textContent={waiting:'等待扫码',scanned:'已扫码，请在手机确认',expired:'二维码已过期',connected:'已登录并加密保存会话'}[s.phase]||s.phase;if(['connected','expired'].includes(s.phase)){clearInterval(poll);if(s.phase==='connected')el('qr').style.display='none';refresh();}}catch(e){clearInterval(poll);el('bstate').textContent=e.message;}},3000);}catch(e){el('bstate').textContent=e.message;}};
el('bcheck').onclick=async()=>{try{const s=await api('bilibili/check',{});el('bstate').textContent=s.connected?'会话有效，账号匹配':'会话尚未有效，请重新授权';}catch(e){el('bstate').textContent=e.message;}};

refresh();setInterval(refresh,30000);
</script></html>`;
