import {join} from 'node:path';
import {BilibiliExplorer} from './bilibili-explorer.mjs';
import {createBilibiliSite} from './bilibili-site.mjs';
import {createBilibiliMedia} from './bilibili-media.mjs';
import {createBilibiliCurator} from './bilibili-curator.mjs';
export async function createBilibiliRuntime({runtime,config,vault,transport,onShare}){
 if(!config.autonomousBilibili?.enabled)return null;
 if(config.autonomousBilibili.targetGroupId!==config.groupId||!config.allowedGroupIds?.includes(config.groupId))throw Error('UNAPPROVED_BROWSE_TARGET');
 const video=runtime.videoRuntime;if(!video?.ffmpegPath||!video.whisperPath||!video.whisperModelPath)throw Error('VIDEO_RUNTIME_NOT_INSTALLED');
 const site=createBilibiliSite({vault,expectedUid:runtime.bilibiliUid,allowComments:config.autonomousBilibili.commentsEnabled===true});
 const media=createBilibiliMedia({site,...video});
 const curator=createBilibiliCurator({...runtime,interestScope:config.autonomousBilibili.interestScope,inspectFrames:(evidence,times,options)=>media.inspect(evidence,times,options),isolatedHome:join(runtime.isolatedHome,'bilibili-autonomous')});
 return BilibiliExplorer.open({root:join(runtime.runtimeRoot,'bilibili'),site,media,curator,transport,onShare,config:config.autonomousBilibili});
}
