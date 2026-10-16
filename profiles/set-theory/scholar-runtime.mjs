import {join} from 'node:path';
import {createScholarSources} from './scholar-sources.mjs';
import {createScholarReader} from './scholar-reader.mjs';
import {createScholarCurator} from './scholar-curator.mjs';
import {ScholarExplorer} from './scholar-explorer.mjs';
export async function createScholarRuntime({runtime,config,transport,onShare}){
 const settings=config.autonomousScholar;if(!settings?.enabled)return null;
 if(settings.targetGroupId!==config.groupId||!config.allowedGroupIds?.includes(config.groupId))throw Error('UNAPPROVED_SCHOLAR_TARGET');
 const sources=createScholarSources(),reader=createScholarReader({sources,pythonPath:runtime.pythonPath,pythonLibraries:runtime.pythonLibraries});
 const curator=createScholarCurator({...runtime,isolatedHome:join(runtime.isolatedHome,'scholar-autonomous')});
 return ScholarExplorer.open({root:join(runtime.runtimeRoot,'scholar'),sources,reader,curator,transport,onShare,config:settings});
}
