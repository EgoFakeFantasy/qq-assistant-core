import {join} from 'node:path';
import {expandScholarSettings} from './scholar-domains.mjs';
import {createScholarSources} from './scholar-sources.mjs';
import {createScholarReader} from './scholar-reader.mjs';
import {createScholarCurator} from './scholar-curator.mjs';
import {ScholarExplorer} from './scholar-explorer.mjs';
export async function createScholarRuntime({runtime,config,transport,onShare,persona='axu',learningMemory=null}){
 const settings={...config.autonomousScholar,...(config.autonomousLearning?.[persona]?.article||{})};if(!settings?.enabled)return null;
 if(settings.targetGroupId!==config.groupId||!config.allowedGroupIds?.includes(config.groupId))throw Error('UNAPPROVED_SCHOLAR_TARGET');
 const sources=createScholarSources(),reader=createScholarReader({sources,pythonPath:runtime.pythonPath,pythonLibraries:runtime.pythonLibraries});
 const curator=createScholarCurator({...runtime,learningPersona:persona,learningMemory,isolatedHome:join(runtime.isolatedHome,'scholar-autonomous')});
 return ScholarExplorer.open({root:join(runtime.runtimeRoot,persona==='hui'?'hui-scholar':'scholar'),sources,reader,curator,transport,onShare,learningMemory,config:{quotaTimeZone:config.quotaTimeZone,...expandScholarSettings(settings)}});
}
