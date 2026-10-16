import {readFile, lstat, realpath, writeFile} from 'node:fs/promises';
import {resolve, join, extname, relative} from 'node:path';
import {createHash} from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const png = Buffer.from([137,80,78,71,13,10,26,10]);
const unkind = /嘲讽|讽刺|鄙视|挑衅|辱骂|狗头|滑稽|小丑|中指|mocking|hostile|insult/i;
const samePath = (a,b) => relative(a,b) === '';

// Only an operator-reviewed, hash-pinned catalog can supply expressive images.
// Group text and model output can select an ID, never supply a filesystem path.
export async function createLocalStickers({root}) {
  const records = new Map();
  const diagnostics = {available:0,rejected:0,catalogPresent:false};
  let directory;
  async function checkedBytes(record) {
    const file = join(directory,record.file);
    const stat = await lstat(file);
    if(!stat.isFile() || stat.isSymbolicLink() || stat.size > 4*1024*1024 || stat.size < 8
      || !samePath(file,await realpath(file))) throw Error('LOCAL_STICKER_FILE_REJECTED');
    const bytes = await readFile(file);
    const isPng = bytes.subarray(0,8).equals(png);
    const isJpeg = bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
    if(hash(bytes)!==record.sha256 || !(extname(file).toLowerCase()==='.png'?isPng:isJpeg))
      throw Error('LOCAL_STICKER_FILE_REJECTED');
    return bytes;
  }
  try {
    const configured = resolve(root);
    const stat = await lstat(configured);
    if(!stat.isDirectory() || stat.isSymbolicLink()) throw Error('LOCAL_STICKER_ROOT_REJECTED');
    directory = await realpath(configured);
    const manifestPath = join(directory,'catalog.json');
    const manifestStat = await lstat(manifestPath);
    if(!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 64*1024)
      throw Error('LOCAL_STICKER_CATALOG_REJECTED');
    const catalog = JSON.parse(await readFile(manifestPath,'utf8'));
    diagnostics.catalogPresent = true;
    if(catalog.version!==1 || !Array.isArray(catalog.stickers) || catalog.stickers.length>64)
      throw Error('LOCAL_STICKER_CATALOG_REJECTED');
    for(const record of catalog.stickers) {
      try {
        if(!record || record.reviewed!==true || record.tone!=='cute'
          || !/^sticker-[a-z0-9][a-z0-9_-]{0,48}$/.test(record.id||'') || records.has(record.id)
          || !/^[a-zA-Z0-9_-]{1,100}\.(?:png|jpg|jpeg)$/i.test(record.file||'')
          || !/^[a-f0-9]{64}$/.test(record.sha256||'')
          || typeof record.title!=='string' || !record.title.trim() || record.title.length>80
          || !Array.isArray(record.tags) || record.tags.length>8
          || record.tags.some(tag=>typeof tag!=='string'||tag.length>24)
          || unkind.test([record.title,...record.tags].join(' '))) throw Error('LOCAL_STICKER_REJECTED');
        await checkedBytes(record);
        records.set(record.id,{...record,tags:[...record.tags]});
      } catch { diagnostics.rejected++; }
    }
  } catch(error) {
    records.clear();
    if(error.code!=='ENOENT') diagnostics.rejected++;
  }
  diagnostics.available = records.size;
  return {
    diagnostics,
    list:()=>[...records.values()].map(({id,title,tags})=>({id,title,tags:[...tags]})),
    async select(id,{workspace}) {
      const record = records.get(id);
      if(!record) throw Error('UNKNOWN_LOCAL_STICKER');
      const bytes = await checkedBytes(record);
      const targetRoot = resolve(workspace);
      const stat = await lstat(targetRoot);
      if(!stat.isDirectory() || stat.isSymbolicLink() || !samePath(targetRoot,await realpath(targetRoot)))
        throw Error('LOCAL_STICKER_WORKSPACE_REJECTED');
      const path = join(targetRoot,record.id+'-'+record.sha256.slice(0,16)+extname(record.file).toLowerCase());
      try { await writeFile(path,bytes,{flag:'wx',mode:0o600}); }
      catch(error) {
        if(error.code!=='EEXIST') throw error;
        const target = await lstat(path);
        if(!target.isFile() || target.isSymbolicLink() || !samePath(path,await realpath(path))
          || hash(await readFile(path))!==record.sha256) throw Error('LOCAL_STICKER_WORKSPACE_REJECTED');
      }
      return {id:record.id,title:record.title,path,kind:'local-sticker'};
    }
  };
}
