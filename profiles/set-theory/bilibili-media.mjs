import {mkdir,writeFile,readFile,realpath,lstat,unlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fetchPublic} from './public-fetch.mjs';
const run=promisify(execFile);
export function bilibiliMediaURL(value){
 const url=new URL(value),official=/(^|\.)(bilivideo\.com|bilivideo\.cn|hdslb\.com)$/.test(url.hostname)||url.hostname==='upos-hz-mirrorakam.akamaized.net';
 if(!official||!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port)throw Error('VIDEO_CDN_DENIED');
 url.protocol='https:';return url;
}
export function sampleTimestamps(duration,count=12){if(!Number.isFinite(duration)||duration<=0)throw Error('INVALID_VIDEO_DURATION');return Array.from({length:count},(_,i)=>Number(((i+0.5)*duration/count).toFixed(2)));}
export function createBilibiliMedia({site,ffmpegPath,whisperPath,whisperModelPath,download=fetchPublic,runProcess=run,maxDuration=1800,maxBytes=160*1024*1024}={}){
 return {async inspect(evidence,times,{signal}={}){
  if(!Array.isArray(times)||times.length>4||times.some(t=>!Number.isFinite(t)||t<0||t>=evidence.video.duration))throw Error('VIDEO_INSPECTION_TIMES_DENIED');const frames=[];
  for(const [i,timestamp] of [...new Set(times)].entries()){const file=join(evidence.workspace,'detail-'+i+'-'+Math.round(timestamp*100)+'.jpg');await runProcess(ffmpegPath,['-nostdin','-hide_banner','-loglevel','error','-y','-ss',String(timestamp),'-i',join(evidence.workspace,'video.mp4'),'-frames:v','1','-vf','scale=1280:-2','-q:v','3',file],{signal,windowsHide:true,timeout:30000,maxBuffer:1024*1024});frames.push({path:file,timestamp,id:'detail-'+i,origin:'bilibili-video-detail',description:evidence.video.title+'；额外查看第'+timestamp+'秒'});}
  return frames;
 },async cleanup(workspace){if(!workspace)return;for(const name of ['video.mp4','audio.wav'])await unlink(join(resolve(workspace),name)).catch(e=>{if(e.code!=='ENOENT')throw e;});},async prepare(bvid,workspace,{signal}={}){
  workspace=resolve(workspace);await mkdir(workspace,{recursive:true});if(resolve(await realpath(workspace))!==workspace)throw Error('LINKED_VIDEO_WORKSPACE');
  const video=await site.metadata(bvid,{signal});if(!video.cid||video.duration<10||video.duration>maxDuration)throw Error('VIDEO_DURATION_OUTSIDE_BROWSE_LIMIT');
  let subtitles=[];try{subtitles=await site.subtitle(video,{signal});}catch(e){if(/VERIFICATION|RESTRICTION|BACKOFF|LOGIN/.test(e.message))throw e;}
  const stream=await site.playback(video,{signal}),url=bilibiliMediaURL(stream.url);if(stream.bytes>maxBytes)throw Error('VIDEO_TOO_LARGE');
  const {bytes}=await download(url,{maxBytes,timeoutMs:120000,redirects:0,signal,headers:{referer:video.url,'user-agent':'Mozilla/5.0'}});
  const path=join(workspace,'video.mp4');await writeFile(path,bytes,{flag:'wx',mode:0o600});const frames=[];
  for(const [index,timestamp] of sampleTimestamps(video.duration).entries()){
   const file=join(workspace,'frame-'+String(index).padStart(2,'0')+'.jpg');
   await runProcess(ffmpegPath,['-nostdin','-hide_banner','-loglevel','error','-y','-ss',String(timestamp),'-i',path,'-frames:v','1','-vf','scale=1280:-2','-q:v','3',file],{signal,windowsHide:true,timeout:30000,maxBuffer:1024*1024});
   if((await lstat(file)).size<100)throw Error('VIDEO_FRAME_EMPTY');frames.push({path:file,timestamp,id:'frame-'+index,origin:'bilibili-video-frame',description:video.title+'；第'+timestamp+'秒'});
  }
  // Decode the complete audio stream, even when a platform transcript is present.
  const wav=join(workspace,'audio.wav');await runProcess(ffmpegPath,['-nostdin','-hide_banner','-loglevel','error','-y','-i',path,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',wav],{signal,windowsHide:true,timeout:120000,maxBuffer:1024*1024});
  let segments=subtitles,transcriptKind='platform-subtitles';
  const subtitleEnd=subtitles.at(-1)?.to||0;
  const instrumental=/纯音乐|无歌词|instrumental/i.test(video.title+' '+video.description);
  if((!subtitles.length||subtitleEnd<video.duration*0.8)&&!instrumental){
   if(!whisperPath||!whisperModelPath)throw Error('LOCAL_ASR_NOT_CONFIGURED');const prefix=join(workspace,'asr');
   await runProcess(whisperPath,['-m',whisperModelPath,'-f',wav,'-l','auto','-t','4','-oj','-of',prefix,'-np'],{signal,windowsHide:true,timeout:900000,maxBuffer:2*1024*1024});
   const data=JSON.parse(await readFile(prefix+'.json','utf8'));segments=(data.transcription||[]).map(s=>({from:Math.min(video.duration,(s.offsets?.from||0)/1000),to:Math.min(video.duration,(s.offsets?.to||0)/1000),text:String(s.text||'').trim()})).filter(s=>s.to>s.from);transcriptKind='local-whisper-asr';
  }
  if(!segments.length)transcriptKind='no-speech-text';
  const transcript=segments.map(s=>'['+s.from.toFixed(1)+'-'+s.to.toFixed(1)+'] '+s.text).join('\n');
  const evidence={video,mediaDownloaded:true,mediaBytes:bytes.length,audioDecoded:true,audioAccess:'transcript-only-not-native-audio',audioDuration:video.duration,transcriptKind,transcriptEnd:segments.at(-1)?.to||0,transcriptTruncated:transcript.length>48000,transcript:transcript.slice(0,48000),frameTimestamps:frames.map(f=>f.timestamp),visualCoverage:'12 sampled frames across first video part',scope:'first-video-part',partCount:video.pages.length,wholeVideoViewed:false};
  await writeFile(join(workspace,'video-evidence.json'),JSON.stringify(evidence,null,2),{flag:'wx',mode:0o600});return {...evidence,frames,workspace};
 }};
}
